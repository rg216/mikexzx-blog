"use client";

import { COVER_STYLE_MAX_LENGTH, coverImageModels, coverImageQualities, DEFAULT_COVER_STYLE, translationModels } from "@blog/shared";
import { useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/TextField";
import { imageModelLabel, qualityLabel } from "@/lib/cover-generation";
import page from "./SettingsPage.module.css";
import styles from "./ModelSettings.module.css";
import { claudeModelOptions, OptionGroup, SettingsLoading } from "./ModelSettings";
import { useSiteSettings } from "./useSiteSettings";

const imageModelOptions = coverImageModels.map((model) => ({ id: model.id, name: model.name, summary: model.summary }));
const qualityOptions = coverImageQualities.map((quality) => ({ id: quality.id, name: quality.name, summary: quality.summary }));

/**
 * 设置页的"生成头图"一节：写画面描述的 Claude 模型、出图的 OpenAI 模型和画质（选了就保存），
 * 以及头图风格（一段英文，要按"保存"：边打字边存会把半句话发给图像模型）。
 */
export function CoverSettings() {
  const { state, retry, saving, error, announcement, save } = useSiteSettings();
  // 正在编辑的风格；null 表示没改过，显示已保存的
  const [styleDraft, setStyleDraft] = useState<string | null>(null);

  return (
    <section aria-labelledby="cover-settings-heading">
      <h2 id="cover-settings-heading" className={page.sectionTitle}>
        生成头图
      </h2>
      <p className={page.sectionHint}>
        文章编辑器里“头图”旁的“生成”：先由 Claude 读文章写画面描述，再由 OpenAI GPT Image 出图（需要 API 项目设置 OPENAI_API_KEY）。图像按 token 计费，用量显示在每张图下面，以 OpenAI 的价格页为准。
      </p>
      <p role="status" className="visually-hidden">
        {announcement}
      </p>
      <SettingsLoading state={state} onRetry={retry} />
      {state.kind === "ready" && (
        <div className={styles.purposes}>
          {error && <Banner title="没有保存">{error}</Banner>}
          <OptionGroup
            label="画面描述"
            hint="读文章、想一个视觉比喻，输出很短：Sonnet 5.5 足够，Haiku 5.5 更便宜"
            options={claudeModelOptions}
            value={state.settings.coverPromptModel}
            saving={saving === "coverPromptModel"}
            onChange={(model) => void save("coverPromptModel", model, `画面描述已改用 ${translationModels.find((m) => m.id === model)?.name ?? model}`)}
          />
          <OptionGroup
            label="出图模型"
            hint="两个模型的 token 单价相同"
            options={imageModelOptions}
            value={state.settings.coverImageModel}
            saving={saving === "coverImageModel"}
            onChange={(model) => void save("coverImageModel", model, `出图已改用 ${imageModelLabel(model)}`)}
          />
          <OptionGroup
            label="画质"
            hint="画质越高，token 越多、越慢"
            options={qualityOptions}
            value={state.settings.coverImageQuality}
            saving={saving === "coverImageQuality"}
            onChange={(quality) => void save("coverImageQuality", quality, `画质已改为${qualityLabel(quality)}`)}
          />
          <StyleEditor
            saved={state.settings.coverStyle}
            draft={styleDraft}
            onDraft={setStyleDraft}
            saving={saving === "coverStyle"}
            onSave={async (value) => {
              if (await save("coverStyle", value, "头图风格已保存")) setStyleDraft(null);
            }}
          />
        </div>
      )}
    </section>
  );
}

function StyleEditor({
  saved,
  draft,
  onDraft,
  saving,
  onSave,
}: {
  saved: string;
  draft: string | null;
  onDraft: (value: string | null) => void;
  saving: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  const value = draft ?? saved;
  const dirty = draft !== null && draft.trim() !== saved;
  const isDefault = value.trim() === DEFAULT_COVER_STYLE;
  return (
    <div className={styles.group}>
      <TextArea
        label="头图风格"
        hint="英文。每次出图都放在画面描述前面，Claude 写描述时也照着它。头图三种语言共用，所以默认不放中文、日文"
        rows={10}
        value={value}
        maxLength={COVER_STYLE_MAX_LENGTH}
        onChange={(event) => onDraft(event.target.value)}
      />
      <div className={styles.styleActions}>
        <Button variant="primary" onClick={() => void onSave(value.trim())} disabled={!dirty || value.trim() === ""} busy={saving}>
          保存
        </Button>
        {/* 只填进输入框，按"保存"才生效 */}
        <Button variant="plain" onClick={() => onDraft(DEFAULT_COVER_STYLE)} disabled={isDefault}>
          恢复默认
        </Button>
      </div>
    </div>
  );
}
