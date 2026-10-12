"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
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

/** 滑块的位置和大小：选中那一段相对控件内边距边缘的 offset 值 */
type Thumb = { x: number; y: number; width: number; height: number };

/**
 * iOS 风格的分段控件。底层是一组原生 radio：
 * 方向键切换、Tab 只停一次、读屏读出"第 1 项，共 2 项，已选中"，这些都是浏览器免费给的，
 * 不用自己实现 tablist 的键盘交互。
 *
 * 选中的白色底块是一个单独的滑块，切换时从旧的一段滑到新的一段（弹簧曲线）。
 * 各段宽度随文字不同，所以位置靠测量：选中项变了、任何一段或整个控件的尺寸变了（字体加载、选中后文字加粗、
 * 标签里的数字变化）都重新测。测到之前（服务端渲染、首帧）由选中的那一段自己画底色，样子一样，只是不会动。
 */
export function SegmentedControl<T extends string>({ label, options, value, onChange, className }: Props<T>) {
  const name = useId();
  const controlRef = useRef<HTMLFieldSetElement>(null);
  const [thumb, setThumb] = useState<Thumb | null>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);

  useLayoutEffect(() => {
    const control = controlRef.current;
    if (!control) return;
    const segments = [...control.querySelectorAll<HTMLElement>(`.${styles.segment}`)];
    const measure = () => {
      const segment = segments[selectedIndex];
      setThumb(segment ? { x: segment.offsetLeft, y: segment.offsetTop, width: segment.offsetWidth, height: segment.offsetHeight } : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(control);
    for (const segment of segments) observer.observe(segment);
    return () => observer.disconnect();
  }, [selectedIndex, options.length]);

  return (
    <fieldset ref={controlRef} className={[styles.control, className].filter(Boolean).join(" ")} data-thumb={thumb ? "" : undefined}>
      <legend className="visually-hidden">{label}</legend>
      {/* 首次测到位置时才挂载：元素第一次计算样式不触发过渡，不会从左上角滑进来 */}
      {thumb && (
        <span
          aria-hidden="true"
          className={styles.thumb}
          style={{ width: thumb.width, height: thumb.height, transform: `translate(${thumb.x}px, ${thumb.y}px)` }}
        />
      )}
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
