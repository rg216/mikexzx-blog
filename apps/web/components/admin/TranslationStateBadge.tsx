import { Badge } from "@/components/ui/Badge";
import { type TranslationState, translationStateLabels } from "@/lib/translation-form";
import styles from "./TranslationStateBadge.module.css";

/** 译文状态：尚无译文（灰）/ 已同步（绿）/ 原文已更新（黄） */
export function TranslationStateBadge({ state }: { state: TranslationState }) {
  if (state === "outdated") return <span className={`${styles.badge} ${styles.outdated}`}>{translationStateLabels.outdated}</span>;
  return <Badge tone={state === "synced" ? "success" : "neutral"}>{translationStateLabels[state]}</Badge>;
}
