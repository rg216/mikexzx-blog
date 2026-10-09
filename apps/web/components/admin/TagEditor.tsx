"use client";

import { type Tag, tagSchema } from "@blog/shared";
import { CircleAlert, Plus, X } from "lucide-react";
import { type KeyboardEvent, type RefObject, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { normalizeSlug, toApiIssues } from "@/lib/post-form";
import styles from "./TagEditor.module.css";

const MAX_TAGS = 20; // 与 postInputFields.tags 的 max(20) 一致

type Props = {
  tags: Tag[];
  onChange: (tags: Tag[]) => void;
  /** 服务端 / 提交前校验返回的错误 */
  error?: string;
  /** 指向"标签名称"输入框，提交出错时用来聚焦 */
  inputRef?: RefObject<HTMLInputElement | null>;
};

/**
 * 标签：已添加的显示成一排可移除的小块，下方一行输入新标签。
 * 每个标签有 name（显示用，可以是中文）和 slug（URL 用）。英文名会自动生成 slug，中文名需要手填。
 */
export function TagEditor({ tags, onChange, error, inputRef }: Props) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [localError, setLocalError] = useState<{ field: "name" | "slug"; message: string }>();
  const ownRef = useRef<HTMLInputElement>(null);
  const nameRef = inputRef ?? ownRef;
  const errorId = useId();
  const [announcement, setAnnouncement] = useState("");

  const suggestedSlug = normalizeSlug(name);

  function add() {
    const candidate = { name: name.trim(), slug: normalizeSlug(slug || name) };
    if (candidate.name && !candidate.slug) {
      setLocalError({ field: "slug", message: "中文名称无法自动生成 slug，请手动填写（如 frontend）" });
      return;
    }
    const parsed = tagSchema.safeParse(candidate);
    if (!parsed.success) {
      const first = toApiIssues(parsed.error.issues)[0];
      setLocalError({ field: first?.path === "slug" ? "slug" : "name", message: first?.message ?? "标签无效" });
      return;
    }
    if (tags.some((tag) => tag.slug === parsed.data.slug)) {
      setLocalError({ field: "slug", message: `已经有 slug 为 "${parsed.data.slug}" 的标签了` });
      return;
    }
    if (tags.length >= MAX_TAGS) {
      setLocalError({ field: "name", message: `最多 ${MAX_TAGS} 个标签` });
      return;
    }
    onChange([...tags, parsed.data]);
    setName("");
    setSlug("");
    setLocalError(undefined);
    setAnnouncement(`已添加标签 ${parsed.data.name}`);
    nameRef.current?.focus();
  }

  function remove(target: Tag) {
    onChange(tags.filter((tag) => tag.slug !== target.slug));
    setAnnouncement(`已移除标签 ${target.name}`);
    // 被点的按钮随标签一起消失了，焦点回到输入框
    nameRef.current?.focus();
  }

  /** 在输入框里按回车 = 添加标签，而不是提交整个表单 */
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      add();
    }
  }

  return (
    <fieldset className={styles.fieldset} aria-describedby={error ? errorId : undefined}>
      <legend className={styles.legend}>标签</legend>

      {tags.length > 0 ? (
        <ul className={styles.tags} aria-label="已添加的标签">
          {tags.map((tag) => (
            <li key={tag.slug} className={styles.tag}>
              <span className={styles.tagName}>{tag.name}</span>
              <span className={styles.tagSlug}>{tag.slug}</span>
              <Button variant="plain" iconOnly className={styles.remove} aria-label={`移除标签 ${tag.name}`} onClick={() => remove(tag)}>
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.none}>还没有标签。</p>
      )}

      <div className={styles.add}>
        <TextField
          ref={nameRef}
          label="标签名称"
          value={name}
          maxLength={50}
          onChange={(event) => {
            setName(event.target.value);
            if (localError?.field === "name") setLocalError(undefined);
          }}
          onKeyDown={onKeyDown}
          error={localError?.field === "name" ? localError.message : undefined}
          enterKeyHint="done"
        />
        <TextField
          label="标签 slug"
          value={slug}
          // 英文名称自动生成的 slug 作为占位提示：留空就用它
          placeholder={suggestedSlug || "如 frontend"}
          maxLength={200}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => {
            setSlug(event.target.value);
            if (localError?.field === "slug") setLocalError(undefined);
          }}
          onBlur={() => setSlug((value) => normalizeSlug(value))}
          onKeyDown={onKeyDown}
          error={localError?.field === "slug" ? localError.message : undefined}
          enterKeyHint="done"
        />
        <Button variant="secondary" className={styles.addButton} onClick={add}>
          <Plus aria-hidden="true" />
          添加
        </Button>
      </div>

      {error && (
        <p id={errorId} className={styles.error}>
          <CircleAlert className={styles.errorIcon} aria-hidden="true" />
          {error}
        </p>
      )}

      <p role="status" className="visually-hidden">
        {announcement}
      </p>
    </fieldset>
  );
}
