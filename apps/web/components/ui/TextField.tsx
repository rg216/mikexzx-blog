import { CircleAlert } from "lucide-react";
import { type ComponentProps, type ReactNode, useId } from "react";
import styles from "./TextField.module.css";

/*
 * 表单控件：label + 控件 + 说明 + 错误。
 *   - label 永远存在（hideLabel 只是视觉隐藏，读屏仍能读到）——placeholder 不能代替 label
 *   - 说明和错误都用 aria-describedby 关联到控件，聚焦时读屏会一起读出
 *   - 有错误时 aria-invalid，边框变红，并配图标——不只靠颜色区分
 */

type FieldProps = {
  label: ReactNode;
  /** 视觉上隐藏 label（上下文已经很清楚时，比如编辑器正文区） */
  hideLabel?: boolean;
  /** 常驻的说明文字 */
  hint?: ReactNode;
  error?: string;
  /** 控件右侧的附加操作（比如"根据标题生成"按钮） */
  accessory?: ReactNode;
  /** 外层容器的 class */
  className?: string;
};

type FieldShellProps = FieldProps & {
  controlId: string;
  children: ReactNode;
  hintId: string;
  errorId: string;
};

function FieldShell({ label, hideLabel, hint, error, accessory, className, controlId, hintId, errorId, children }: FieldShellProps) {
  return (
    <div className={[styles.field, className].filter(Boolean).join(" ")}>
      <label htmlFor={controlId} className={hideLabel ? "visually-hidden" : styles.label}>
        {label}
      </label>
      {accessory ? (
        <div className={styles.row}>
          {children}
          {accessory}
        </div>
      ) : (
        children
      )}
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={styles.error}>
          <CircleAlert className={styles.errorIcon} aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

/** 生成控件 id 和 aria-describedby（合并调用方自己传入的 describedby）。 */
function useFieldIds(id: string | undefined, props: FieldProps, describedBy: string | undefined) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const ariaDescribedBy =
    [describedBy, props.hint ? hintId : undefined, props.error ? errorId : undefined].filter(Boolean).join(" ") || undefined;
  return { controlId, hintId, errorId, ariaDescribedBy };
}

type TextFieldProps = FieldProps & Omit<ComponentProps<"input">, "className"> & { inputClassName?: string };

export function TextField({ label, hideLabel, hint, error, accessory, className, inputClassName, id, ...inputProps }: TextFieldProps) {
  const fieldProps = { label, hideLabel, hint, error, accessory, className };
  const ids = useFieldIds(id, fieldProps, inputProps["aria-describedby"]);

  return (
    <FieldShell {...fieldProps} {...ids}>
      <input
        type="text"
        {...inputProps}
        id={ids.controlId}
        className={[styles.control, inputClassName].filter(Boolean).join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.ariaDescribedBy}
      />
    </FieldShell>
  );
}

type TextAreaProps = FieldProps & Omit<ComponentProps<"textarea">, "className"> & { inputClassName?: string };

export function TextArea({ label, hideLabel, hint, error, accessory, className, inputClassName, id, ...textareaProps }: TextAreaProps) {
  const fieldProps = { label, hideLabel, hint, error, accessory, className };
  const ids = useFieldIds(id, fieldProps, textareaProps["aria-describedby"]);

  return (
    <FieldShell {...fieldProps} {...ids}>
      <textarea
        {...textareaProps}
        id={ids.controlId}
        className={[styles.control, styles.textarea, inputClassName].filter(Boolean).join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.ariaDescribedBy}
      />
    </FieldShell>
  );
}
