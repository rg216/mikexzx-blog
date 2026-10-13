import {
  fitModelName,
  fitTranslatedSegment,
  localeSchema,
  splitMarkdownForTranslation,
  tagSourceLocale,
  tagTranslateInputSchema,
  type TagTranslateResult,
  tagTranslationLocales,
  type TranslationConfig,
  TRANSLATION_HEARTBEAT_MS,
  type TranslationPlan,
  translationGenerateInputSchema,
  type TranslationStreamEvent,
  type TranslationTitleResult,
} from "@blog/shared";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { HttpError } from "../lib/errors.ts";
import { checkRateLimit, type RateLimiter, rules } from "../lib/rate-limit.ts";
import { sourceHash } from "../lib/source-hash.ts";
import {
  classifyTranslatorError,
  cleanTranslatedTitle,
  parseTagNameOutput,
  type SegmentEvent,
  stopReasonMessage,
  type TranslationJob,
  type TranslationStop,
  type Translator,
} from "../lib/translator.ts";
import { validate } from "../lib/validate.ts";
import { type AuthEnv, sessionOf } from "../middleware/auth.ts";
import { getSettings } from "../services/settings.ts";
import { listAdminTags } from "../services/tags.ts";
import { findPost } from "../services/translations.ts";

/*
 * 大模型翻译的接口（挂在 /admin 下：已登录 + 同源校验 + 写操作限流都由外层负责）。
 *   GET  /translation/config                          → { available, model, tagModel, reason? }：编辑器据此启用按钮、显示模型名或不能用的原因
 *   GET  /posts/:id/translation-plan                   → { sourceHash, segments }：正文分几段（原生 App 用，见 translationPlanSchema）
 *   POST /posts/:id/translations/:locale/generate     → 标题：JSON；正文的一段：NDJSON 流
 *   POST /tags/translate                              → 标签名的各语言译名：JSON
 * 生成的结果只回给编辑器，不入库：作者过目、保存（PUT 译文）后才对读者可见。
 */

const generateParam = z.object({
  id: z.coerce.number().int().positive().max(2_147_483_647),
  locale: localeSchema,
});

type LogEntry = ({ postId: number; locale: string; part: string; index?: number } | { tag: string; part: "tag" }) & TranslationStop;

/** 用量只记日志、不入库（Vercel 的日志里能查到每次调用花了多少 token） */
function logUsage(entry: LogEntry) {
  console.info(`translation ${JSON.stringify(entry)}`);
}

const ndjson = (event: TranslationStreamEvent) => JSON.stringify(event);

const PING = Symbol("ping");

export type TranslationDeps = {
  /** null：没有配置（ANTHROPIC_API_KEY 或 REDIS_URL 没设） */
  translator: Translator | null;
  /** 翻译的限流器（Redis）现在能不能用：它 fail-closed，不能用时生成一定会被拒 */
  limiterHealthy: () => Promise<boolean>;
  /** 流里没有别的输出时多久发一次 ping（毫秒），默认 TRANSLATION_HEARTBEAT_MS；测试里调短 */
  heartbeatMs?: number;
};

/** 浏览器断开（关闭页面、点"停止"）时中止上游请求，不再计费 */
function abortWithRequest(request: Request): AbortController {
  const controller = new AbortController();
  if (request.signal.aborted) controller.abort();
  else request.signal.addEventListener("abort", () => controller.abort(), { once: true });
  return controller;
}

export function translateRoutes(db: Db, { translator, limiterHealthy, heartbeatMs = TRANSLATION_HEARTBEAT_MS }: TranslationDeps, limiter: RateLimiter) {
  return new Hono<AuthEnv>()
    .get("/translation/config", async (c) => {
      // 模型是后台"设置"里选的
      const { translationModel: model, tagTranslationModel: tagModel } = await getSettings(db);
      // 如实反映"现在点生成会不会成功"：配置了但 Redis 连不上时，生成会因为限流 fail-closed 返回 503
      if (!translator) return c.json({ available: false, model, tagModel, reason: "not_configured" } satisfies TranslationConfig);
      if (!(await limiterHealthy())) return c.json({ available: false, model, tagModel, reason: "rate_limiter_unavailable" } satisfies TranslationConfig);
      return c.json({ available: true, model, tagModel } satisfies TranslationConfig);
    })
    /*
     * 标签名的译名：一次调用给出所有需要译名的语言。翻译的是表单里此刻的名称（新建时还没有 id），
     * 结果只回给编辑框，作者确认、保存标签后才生效。和文章翻译共用限流额度。
     */
    .post("/tags/translate", validate("json", tagTranslateInputSchema), async (c) => {
      if (!translator) throw new HttpError(503, "internal_error", "翻译功能未启用（服务器需要设置 ANTHROPIC_API_KEY 和 REDIS_URL）");
      const { name, slug } = c.req.valid("json");
      const refused = await checkRateLimit(c, limiter, rules.translate, `user:${sessionOf(c).user.id}`);
      if (refused) return refused;

      // 已有标签的译名作参考，新译名的风格和它们一致（不含同名的自己）
      const glossary = (await listAdminTags(db))
        .filter((tag) => tag.name !== name && tagTranslationLocales.every((locale) => tag.translations[locale]))
        .map((tag) => ({ name: tag.name, translations: tag.translations }));
      const job = { sourceLocale: tagSourceLocale, targetLocales: tagTranslationLocales, name, slug, glossary };
      const log = { tag: name, part: "tag" as const };
      const { tagTranslationModel: model } = await getSettings(db);

      let outcome;
      try {
        outcome = await translator.translateTagName(job, { signal: abortWithRequest(c.req.raw).signal, model });
      } catch (error) {
        const failure = classifyTranslatorError(error);
        if (!failure.aborted) console.error("tag translation failed", log, error);
        throw new HttpError(failure.status, failure.code, failure.message);
      }
      const { text, ...stop } = outcome;
      logUsage({ ...log, ...stop });
      if (stop.stopReason !== "end_turn") throw new HttpError(502, "internal_error", stopReasonMessage(stop.stopReason, stop.refusalCategory));
      let translations;
      try {
        translations = parseTagNameOutput(text, tagTranslationLocales);
      } catch (error) {
        console.error("tag translation unparsable", log, text);
        throw new HttpError(502, "internal_error", error instanceof Error ? error.message : "模型返回的译名无法解析");
      }
      return c.json({ translations, model: fitModelName(stop.model), usage: stop.usage } satisfies TagTranslateResult);
    })
    .get("/posts/:id/translation-plan", validate("param", generateParam.pick({ id: true })), async (c) => {
      const post = await findPost(db, c.req.valid("param").id);
      return c.json({ sourceHash: sourceHash(post), segments: splitMarkdownForTranslation(post.contentMd).length } satisfies TranslationPlan);
    })
    .post(
      "/posts/:id/translations/:locale/generate",
      validate("param", generateParam),
      validate("json", translationGenerateInputSchema),
      async (c) => {
        if (!translator) throw new HttpError(503, "internal_error", "翻译功能未启用（服务器需要设置 ANTHROPIC_API_KEY 和 REDIS_URL）");
        const { id, locale } = c.req.valid("param");
        const input = c.req.valid("json");

        // 草稿也可以生成：作者可能先翻译好再发布
        const post = await findPost(db, id);
        if (locale === post.sourceLocale) throw new HttpError(400, "validation_error", "不能把文章翻译成它的原文语言");
        // 编辑器按加载时的原文分段；原文之后又改过的话，段号对不上
        if (input.sourceHash !== sourceHash(post)) throw new HttpError(409, "conflict", "原文已更新，请重新加载后再生成");

        const job: TranslationJob = { sourceLocale: post.sourceLocale, targetLocale: locale, title: post.title, contentMd: post.contentMd };
        const log = { postId: id, locale, part: input.part };
        // 编辑器开始生成时定下的模型（整篇同一个，提示缓存才命中）；没带时用设置里的
        const model = input.model ?? (await getSettings(db)).translationModel;

        /*
         * 每次调用都花钱：在通用的写操作限流之外，再按用户限制每小时的次数。
         * 放在所有校验（400 / 404 / 409、段号超出范围）之后、调用模型之前：被拒的请求不调用模型，也不该占用付费调用的额度。
         */
        const limitTranslation = () => checkRateLimit(c, limiter, rules.translate, `user:${sessionOf(c).user.id}`);

        const controller = abortWithRequest(c.req.raw);

        if (input.part === "title") {
          const refused = await limitTranslation();
          if (refused) return refused;
          let outcome;
          try {
            outcome = await translator.translateTitle(job, { signal: controller.signal, model });
          } catch (error) {
            const failure = classifyTranslatorError(error);
            if (!failure.aborted) console.error("translation failed", log, error);
            throw new HttpError(failure.status, failure.code, failure.message);
          }
          const { text, ...stop } = outcome;
          logUsage({ ...log, ...stop });
          if (stop.stopReason !== "end_turn") throw new HttpError(502, "internal_error", stopReasonMessage(stop.stopReason, stop.refusalCategory));
          const title = cleanTranslatedTitle(text, post.title);
          if (!title) throw new HttpError(502, "internal_error", "模型返回了空的标题");
          return c.json({ title, model: fitModelName(stop.model), usage: stop.usage } satisfies TranslationTitleResult);
        }

        const segments = splitMarkdownForTranslation(post.contentMd);
        const segment = segments[input.index];
        if (segment === undefined) {
          throw new HttpError(400, "validation_error", `段号超出范围：正文共 ${segments.length} 段`);
        }
        const refused = await limitTranslation();
        if (refused) return refused;

        const iterator = translator
          .streamSegment(job, { index: input.index, total: segments.length, text: segment }, { signal: controller.signal, model })
          [Symbol.asyncIterator]();
        const segmentLog = { ...log, index: input.index };

        // 先等上游接受请求（第一个事件）再开始流式响应：凭证无效、上游限流这类错误发生在这之前，
        // 能用正常的 HTTP 状态码 + JSON 错误回复；流开始之后的错误只能写成流里的 error 事件
        let first: IteratorResult<SegmentEvent>;
        try {
          first = await iterator.next();
        } catch (error) {
          const failure = classifyTranslatorError(error);
          if (!failure.aborted) console.error("translation failed", segmentLog, error);
          throw new HttpError(failure.status, failure.code, failure.message);
        }

        c.header("Content-Type", "application/x-ndjson; charset=utf-8");
        c.header("Cache-Control", "no-store");
        return stream(c, async (out) => {
          // 浏览器断开时 Hono 会取消响应流
          out.onAbort(() => controller.abort());

          /*
           * 心跳：等下一个事件时，每隔 heartbeatMs 没有任何输出就写一行 ping。模型在第一段译文之前先思考，
           * 可能几十秒一个字节都没有；浏览器经前端的 /api rewrite（Vercel 的外部 rewrite）到这个函数，
           * 中间的代理可能把长时间没有数据的连接当成空闲连接断开。每个事件之后计时重新开始。
           */
          const nextWithHeartbeat = async (): Promise<IteratorResult<SegmentEvent>> => {
            const pending = iterator.next();
            for (;;) {
              let timer: ReturnType<typeof setTimeout> | undefined;
              const tick = new Promise<typeof PING>((resolve) => {
                timer = setTimeout(() => resolve(PING), heartbeatMs);
              });
              try {
                const winner = await Promise.race([pending, tick]);
                if (winner !== PING) return winner;
              } finally {
                clearTimeout(timer);
              }
              // 浏览器已经走了：不再写，等翻译器随中止结束
              if (controller.signal.aborted || out.aborted) return pending;
              await out.writeln(ndjson({ type: "ping" }));
            }
          };

          let finished = false;
          try {
            for (let result = first; !result.done; result = await nextWithHeartbeat()) {
              if (controller.signal.aborted) break;
              const event = result.value;
              if (event.type === "delta") {
                await out.writeln(ndjson({ type: "delta", text: event.text }));
              } else if (event.type === "done") {
                finished = true;
                const { type: _type, text, ...stop } = event;
                logUsage({ ...segmentLog, ...stop });
                const succeeded = stop.stopReason === "end_turn";
                // 成功时对齐首尾空行，编辑器把各段的 done.text 直接拼接就是完整正文；
                // 失败（拒答、截断）时原样转发，编辑器按 stopReason 判断失败、丢弃这段
                const fitted = succeeded ? fitTranslatedSegment(segment, text) : text;
                if (succeeded && fitted.trim() === "") {
                  await out.writeln(ndjson({ type: "error", code: "internal_error", message: "模型返回了空的译文" }));
                } else {
                  // 模型名收进保存时允许的长度（fitModelName），编辑器原样记录、保存不会因此失败
                  await out.writeln(ndjson({ type: "done", text: fitted, stopReason: stop.stopReason, model: fitModelName(stop.model), usage: stop.usage }));
                }
              }
              // start：上游已接受请求，没有要转发的内容
            }
            // 翻译器没给出结束事件就停了：告诉编辑器这段没完成，而不是让它以为流正常结束
            if (!finished && !controller.signal.aborted) {
              console.error("translation ended without a result", segmentLog);
              await out.writeln(ndjson({ type: "error", code: "internal_error", message: "翻译意外中断，请重试" }));
            }
          } catch (error) {
            const failure = classifyTranslatorError(error);
            // 浏览器已经走了：不必再写，也不算错误
            if (failure.aborted || controller.signal.aborted) return;
            console.error("translation failed", segmentLog, error);
            await out.writeln(ndjson({ type: "error", code: failure.code, message: failure.message }));
          } finally {
            // 提前结束（中止）时让翻译器收尾：SDK 的流随之中止
            if (controller.signal.aborted) await iterator.return?.();
          }
        });
      },
    );
}
