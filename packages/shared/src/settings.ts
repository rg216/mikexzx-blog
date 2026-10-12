import { z } from "zod";

/*
 * 后台"设置"里可以改的运行时设置（GET / PATCH /admin/settings，存在 API 的 settings 表里）。
 * 只放不涉密的东西：密钥、连接地址一律在环境变量里（见 CLAUDE.md"设置与状态页"）。
 */

// ---------- 翻译用的模型 ----------

/**
 * 可选的模型（2026-10 按官方文档核对：https://platform.claude.com/docs/en/models/overview 、/about-claude/pricing）。
 * 这几个模型接受同一套请求参数：自适应思考、output_config.effort（low … max）、结构化输出、提示缓存（最少 512 token），
 * 采样参数一律不发。唯一的差别是服务端回退：Haiku 5.5 没有（"default" 被接受但不起作用），请求里就不带。
 * 价格是每百万 token 的美元数（输入 / 输出），只用来在设置页上比较；以官方价格页为准。
 */
export const translationModels = [
  {
    id: "claude-haiku-5-5",
    name: "Haiku 5.5",
    summary: "最快、最便宜。适合标签名这类短文本；长文的准确度不如 Sonnet",
    price: { input: 0.1, output: 0.5 },
    /** 提示超过 10 万 token 时的单价（只有 Haiku 5.5 按提示长度分档；长文 + 缓存可能超过） */
    longPromptPrice: { input: 0.5, output: 2.5 },
    serverFallback: false,
  },
  {
    id: "claude-sonnet-5-5",
    name: "Sonnet 5.5",
    summary: "速度和质量的平衡，默认选择",
    price: { input: 2, output: 10 },
    longPromptPrice: null,
    serverFallback: true,
  },
  {
    id: "claude-opus-5-5",
    name: "Opus 5.5",
    summary: "更强的理解和表达，价格是 Sonnet 的 2 倍",
    price: { input: 4, output: 20 },
    longPromptPrice: null,
    serverFallback: true,
  },
  {
    id: "claude-fable-5-1",
    name: "Fable 5.1",
    summary: "最强的推理，最慢，价格是 Opus 的 2.5 倍；翻译一般用不到",
    price: { input: 10, output: 50 },
    longPromptPrice: null,
    serverFallback: true,
  },
] as const;

export type TranslationModel = (typeof translationModels)[number];
export type TranslationModelId = TranslationModel["id"];

const modelIds = translationModels.map((model) => model.id) as [TranslationModelId, ...TranslationModelId[]];
export const translationModelIdSchema = z.enum(modelIds);

export function translationModelInfo(id: TranslationModelId): TranslationModel {
  const model = translationModels.find((m) => m.id === id);
  if (!model) throw new Error(`unknown model ${id}`);
  return model;
}

/** 部署后、没在设置页改过时的模型：和加入这个设置之前一样，文章、标签都用 Sonnet 5.5 */
export const DEFAULT_TRANSLATION_MODEL: TranslationModelId = "claude-sonnet-5-5";

// ---------- 设置 ----------

export const siteSettingsSchema = z.object({
  /** 文章（标题和正文）翻译用的模型 */
  translationModel: translationModelIdSchema,
  /** 标签名翻译用的模型 */
  tagTranslationModel: translationModelIdSchema,
});
export type SiteSettings = z.infer<typeof siteSettingsSchema>;
export type SiteSettingKey = keyof SiteSettings;

export const defaultSiteSettings: SiteSettings = {
  translationModel: DEFAULT_TRANSLATION_MODEL,
  tagTranslationModel: DEFAULT_TRANSLATION_MODEL,
};

/** PATCH /admin/settings：只改给出的键 */
export const siteSettingsUpdateSchema = siteSettingsSchema
  .partial()
  .strict()
  .refine((input) => Object.keys(input).length > 0, "至少需要更新一项设置");
export type SiteSettingsUpdate = z.input<typeof siteSettingsUpdateSchema>;

/**
 * 从 settings 表的行拼出完整设置：每个键单独校验，缺的、认不出的、不合法的（比如某个模型已经从列表里下架）都用默认值，
 * 一行坏数据不会让整个设置读不出来。表里多出来的键（旧版本留下的）忽略。
 */
export function settingsFromRows(rows: readonly { key: string; value: unknown }[]): SiteSettings {
  const settings: SiteSettings = { ...defaultSiteSettings };
  const shape = siteSettingsSchema.shape;
  for (const { key, value } of rows) {
    if (!Object.hasOwn(shape, key)) continue;
    const k = key as SiteSettingKey;
    const parsed = shape[k].safeParse(value);
    if (parsed.success) settings[k] = parsed.data;
  }
  return settings;
}
