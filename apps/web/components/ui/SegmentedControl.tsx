"use client";

import { useId } from "react";
import styles from "./SegmentedControl.module.css";

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  /** 整组的名称（视觉隐藏，读屏会读出） */
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
};

/**
 * iOS 风格的分段控件。底层是一组原生 radio：
 * 方向键切换、Tab 只停一次、读屏读出"第 1 项，共 2 项，已选中"，这些都是浏览器免费给的，
 * 不用自己实现 tablist 的键盘交互。
 */
export function SegmentedControl<T extends string>({ label, options, value, onChange, className }: Props<T>) {
  const name = useId();

  return (
    <fieldset className={[styles.control, className].filter(Boolean).join(" ")}>
      <legend className="visually-hidden">{label}</legend>
      {options.map((option) => (
        <label key={option.value} className={styles.segment}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
            className={styles.input}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
