import {
  COVER_HEARTBEAT_MS,
  coverBriefInputSchema,
  type CoverBriefResult,
  type CoverConfig,
  coverImageInputSchema,
  type CoverImageStreamEvent,
  defaultLocale,
} from "@blog/shared";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { sha256Hex } from "../auth/tokens.ts";
import type { Db } from "../db/client.ts";
import { type CoverBriefWriter, parseCoverBriefOutput } from "../lib/cover-brief.ts";
import { classifyImagerError, type CoverImageEvent, type CoverImager } from "../lib/cover-imager.ts";
import { HttpError } from "../lib/errors.ts";
import { nextWithHeartbeat } from "../lib/heartbeat.ts";
import { checkRateLimit, type RateLimiter, rules } from "../lib/rate-limit.ts";
import { classifyTranslatorError, stopReasonMessage } from "../lib/translator.ts";
import { validate } from "../lib/validate.ts";
import { type AuthEnv, sessionOf } from "../middleware/auth.ts";
import { getSettings } from "../services/settings.ts";
import { abortWithRequest } from "./translate.ts";

/*
 * 生成头图（挂在 /admin 下：已登录 + 同源校验 + 写操作限流都由外层负责）。
 *   GET  /covers/config    → 两步各自能不能用、用哪个模型
 *   POST /covers/brief     → Claude 写的画面描述和图片描述：JSON
 *   POST /covers/generate  → OpenAI 出图：NDJSON 流（ping / partial … 以 done 或 error 结束）
 * 结果只回给编辑器，不入库：作者选中的那张由浏览器上传进媒体库（和手动上传同一条路），再设为头图。
 */

export type CoverDeps = {
  /** null：没有 ANTHROPIC_API_KEY（或没有 Redis） */
  briefWriter: CoverBriefWriter | null;
  /** null：没有 OPENAI_API_KEY（或没有 Redis） */
  imager: CoverImager | null;
  /** 限流器（Redis）现在能不能用：两步都 fail-closed，不能用时一定会被拒 */
  limiterHealthy: () => Promise<boolean>;
  /** 流里没有别的输出时多久发一次 ping（毫秒），默认 COVER_HEARTBEAT_MS；测试里调短 */
  heartbeatMs?: number;
};

const ndjson = (event: CoverImageStreamEvent) => JSON.stringify(event);

/** 用量只记日志、不入库（Vercel 的日志里能查到每次调用的 token） */
function logUsage(entry: { part: "brief" | "image" } & Record<string, unknown>) {
  console.info(`cover ${JSON.stringify(entry)}`);
}

const BRIEF_SERVICE = "写画面描述的 Claude 服务";

export function coverRoutes(db: Db, { briefWriter, imager, limiterHealthy, heartbeatMs = COVER_HEARTBEAT_MS }: CoverDeps, limiter: RateLimiter) {
  const userKey = (c: Parameters<typeof sessionOf>[0]) => `user:${sessionOf(c).user.id}`;

  return new Hono<AuthEnv>()
    .get("/config", async (c) => {
      const settings = await getSettings(db);
      // 两步共用一个限流器：只在至少有一步配置了时才去 PING
      const healthy = briefWriter || imager ? await limiterHealthy() : false;
      const reasonOf = (configured: boolean) => (!configured ? "not_configured" : !healthy ? "rate_limiter_unavailable" : null);
      const briefReason = reasonOf(briefWriter !== null);
      const imageReason = reasonOf(imager !== null);
      const brief = { model: settings.coverPromptModel };
      const image = { model: settings.coverImageModel, quality: settings.coverImageQuality };
      return c.json({
        brief: briefReason ? { available: false, ...brief, reason: briefReason } : { available: true, ...brief },
        image: imageReason ? { available: false, ...image, reason: imageReason } : { available: true, ...image },
      } satisfies CoverConfig);
    })
    /*
     * 画面描述：读表单里此刻的标题、标签、正文（新文章还没保存也能用）。算在翻译的额度里（同一个 Claude 账号的钱）。
     */
    .post("/brief", validate("json", coverBriefInputSchema), async (c) => {
      if (!briefWriter) throw new HttpError(503, "internal_error", "写画面描述的功能未启用（服务器需要设置 ANTHROPIC_API_KEY 和 REDIS_URL）");
      const input = c.req.valid("json");
      const refused = await checkRateLimit(c, limiter, rules.translate, userKey(c));
      if (refused) return refused;

      const settings = await getSettings(db);
      const job = {
        // 后台写文章用原文语言（目前都是 zh）；以后支持别的原文语言时由表单带上
        sourceLocale: defaultLocale,
        title: input.title,
        tags: input.tags,
        contentMd: input.contentMd,
        direction: input.direction ?? "",
        style: settings.coverStyle,
      };
      const log = { part: "brief" as const, title: input.title };

      let outcome;
      try {
        outcome = await briefWriter.writeBrief(job, { signal: abortWithRequest(c.req.raw).signal, model: settings.coverPromptModel });
      } catch (error) {
        const failure = classifyTranslatorError(error, BRIEF_SERVICE);
        if (!failure.aborted) console.error("cover brief failed", log, error);
        throw new HttpError(failure.status, failure.code, failure.message);
      }
      const { text, ...stop } = outcome;
      logUsage({ ...log, ...stop });
      if (stop.stopReason !== "end_turn") {
        const message = stop.stopReason === "refusal" ? `模型拒绝为这篇文章写画面描述${stop.refusalCategory ? `（类别：${stop.refusalCategory}）` : ""}` : stopReasonMessage(stop.stopReason, stop.refusalCategory);
        throw new HttpError(502, "internal_error", message);
      }
      let brief;
      try {
        brief = parseCoverBriefOutput(text);
      } catch (error) {
        console.error("cover brief unparsable", log, text);
        throw new HttpError(502, "internal_error", error instanceof Error ? error.message : "模型返回的画面描述无法解析");
      }
      return c.json({ ...brief, model: stop.model, usage: stop.usage } satisfies CoverBriefResult);
    })
    .post("/generate", validate("json", coverImageInputSchema), async (c) => {
      if (!imager) throw new HttpError(503, "internal_error", "出图功能未启用（服务器需要设置 OPENAI_API_KEY 和 REDIS_URL）");
      const { prompt } = c.req.valid("json");
      // 校验通过之后、调用 OpenAI 之前才计数：被拒的请求不占付费调用的额度
      const refused = await checkRateLimit(c, limiter, rules.coverImage, userKey(c));
      if (refused) return refused;

      const settings = await getSettings(db);
      const request = {
        prompt,
        style: settings.coverStyle,
        model: settings.coverImageModel,
        quality: settings.coverImageQuality,
        // OpenAI 建议带一个稳定的用户标识做滥用监测；哈希过，不暴露用户 id
        safetyIdentifier: sha256Hex(`blog-admin:${sessionOf(c).user.id}`).slice(0, 32),
      };
      const log = { part: "image" as const, model: request.model, quality: request.quality };
      const controller = abortWithRequest(c.req.raw);
      const iterator = imager.generate(request, { signal: controller.signal })[Symbol.asyncIterator]();

      // 先等上游接受请求（start）再开始流式响应：凭证无效、内容审核拒绝提示词、上游限流都还能用正常的状态码 + JSON 错误回复
      let first: IteratorResult<CoverImageEvent>;
      try {
        first = await iterator.next();
      } catch (error) {
        const failure = classifyImagerError(error);
        if (!failure.aborted) console.error("cover image failed", log, error);
        throw new HttpError(failure.status, failure.code, failure.message);
      }

      c.header("Content-Type", "application/x-ndjson; charset=utf-8");
      c.header("Cache-Control", "no-store");
      return stream(c, async (out) => {
        out.onAbort(() => controller.abort());
        // 心跳：出图可能一两分钟，预览之间也可能隔几十秒（见 nextWithHeartbeat）
        const next = () =>
          nextWithHeartbeat(iterator, heartbeatMs, async () => {
            if (controller.signal.aborted || out.aborted) return false;
            await out.writeln(ndjson({ type: "ping" }));
            return true;
          });

        let finished = false;
        try {
          for (let result = first; !result.done; result = await next()) {
            if (controller.signal.aborted) break;
            const event = result.value;
            if (event.type === "partial") {
              await out.writeln(ndjson({ type: "partial", index: event.index, contentType: event.contentType, image: event.image }));
            } else if (event.type === "done") {
              finished = true;
              logUsage({ ...log, usage: event.usage });
              await out.writeln(ndjson(event));
              break;
            }
            // start：上游已接受请求，没有要转发的内容
          }
          if (!finished && !controller.signal.aborted) {
            console.error("cover image ended without a result", log);
            await out.writeln(ndjson({ type: "error", code: "internal_error", message: "出图意外中断，请重试" }));
          }
        } catch (error) {
          const failure = classifyImagerError(error);
          if (failure.aborted || controller.signal.aborted) return;
          console.error("cover image failed", log, error);
          await out.writeln(ndjson({ type: "error", code: failure.code, message: failure.message }));
        } finally {
          // 提前结束（中止、拿到结果后 break）时让出图器收尾：SDK 的流随之中止
          await iterator.return?.();
        }
      });
    });
}
