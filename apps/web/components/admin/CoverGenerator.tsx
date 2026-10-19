"use client";

import { COVER_DIRECTION_MAX_LENGTH, COVER_PROMPT_MAX_LENGTH, type CoverConfig, type CoverImageResult, type PostCover, translationModelInfo } from "@blog/shared";
import { ImageIcon, Sparkles, Square } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/Spinner";
import { TextArea, TextField } from "@/components/ui/TextField";
import { AdminApiError, adminApi } from "@/lib/admin-api";
import {
  base64ToBlob,
  briefUnavailableNotes,
  coverFileName,
  dataUrl,
  formatImageUsage,
  imageModelLabel,
  imageUnavailableNotes,
  qualityLabel,
} from "@/lib/cover-generation";
import { uploadImage } from "@/lib/image-upload";
import { coverFromImage } from "@/lib/post-form";
import styles from "./CoverGenerator.module.css";

/** 表单里此刻的内容：新文章还没保存也能生成 */
export type CoverSource = { title: string; slug: string; tags: string[]; contentMd: string };

type Props = {
  open: boolean;
  onClose: () => void;
  source: CoverSource;
  onPick: (cover: PostCover) => void;
};

type Candidate = CoverImageResult & { n: number };
type Step = { kind: "idle" } | { kind: "running" } | { kind: "error"; message: string };
type ImageStep = { kind: "idle" } | { kind: "running"; preview: string | null; seconds: number } | { kind: "error"; message: string };

const describe = (error: unknown) => (error instanceof AdminApiError ? error.message : error instanceof Error ? error.message : "网络错误，请稍后再试");
const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

/**
 * 生成头图的对话框。两步都由作者点按钮触发，都可以停止：
 *   1. 画面描述：让 Claude 按文章写（可以先给个方向），或者自己写；描述可以随便改。
 *   2. 出图：按设置里的模型、画质和头图风格出一张 16:9 的图，生成中显示预览。可以连出几张，挑一张"设为头图"。
 * 选中的那张这时才上传进媒体库（和手动上传同一条路：缩放、尺寸版本、去元数据），没选的不进存储。
 * 关掉对话框不会丢掉已经生成的图（组件一直挂着），重新打开还在；离开编辑页才丢。
 */
export function CoverGenerator({ open, onClose, source, onPick }: Props) {
  const [config, setConfig] = useState<CoverConfig | "error" | null>(null);
  const [reloadConfig, setReloadConfig] = useState(0);
  const [direction, setDirection] = useState("");
  const [prompt, setPrompt] = useState("");
  const [alt, setAlt] = useState("");
  const [brief, setBrief] = useState<Step>({ kind: "idle" });
  const [image, setImage] = useState<ImageStep>({ kind: "idle" });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [saving, setSaving] = useState<Step>({ kind: "idle" });
  const [announcement, setAnnouncement] = useState("");
  const briefAbort = useRef<AbortController | null>(null);
  const imageAbort = useRef<AbortController | null>(null);
  const resultsName = useId();

  // 第一次打开时读配置（之后每次打开也重读：设置可能刚改过）
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    adminApi.getCoverConfig().then(
      (value) => !cancelled && setConfig(value),
      () => !cancelled && setConfig("error"),
    );
    return () => {
      cancelled = true;
    };
  }, [open, reloadConfig]);

  // 卸载（离开编辑页）时停掉还在进行的请求
  useEffect(
    () => () => {
      briefAbort.current?.abort();
      imageAbort.current?.abort();
    },
    [],
  );

  // 出图时显示已用时间：一张图可能要一两分钟，没有进度条的话看起来像卡住了
  const running = image.kind === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setImage((prev) => (prev.kind === "running" ? { ...prev, seconds: prev.seconds + 1 } : prev)), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const ready = config !== null && config !== "error" ? config : null;

  async function writeBrief() {
    if (brief.kind === "running") {
      briefAbort.current?.abort();
      return;
    }
    const controller = new AbortController();
    briefAbort.current = controller;
    setBrief({ kind: "running" });
    try {
      const result = await adminApi.writeCoverBrief(
        { title: source.title, tags: source.tags, contentMd: source.contentMd, ...(direction.trim() ? { direction: direction.trim() } : {}) },
        controller.signal,
      );
      setPrompt(result.prompt);
      setAlt(result.alt);
      setBrief({ kind: "idle" });
      setAnnouncement("画面描述已写好，可以修改后生成图片");
    } catch (error) {
      setBrief(isAbort(error) ? { kind: "idle" } : { kind: "error", message: describe(error) });
    }
  }

  async function generate() {
    if (image.kind === "running") {
      imageAbort.current?.abort();
      return;
    }
    const controller = new AbortController();
    imageAbort.current = controller;
    setImage({ kind: "running", preview: null, seconds: 0 });
    setAnnouncement("开始生成图片");
    try {
      const result = await adminApi.generateCoverImage(
        { prompt },
        {
          signal: controller.signal,
          onPartial: (partial) => setImage((prev) => (prev.kind === "running" ? { ...prev, preview: dataUrl(partial.image, partial.contentType) } : prev)),
        },
      );
      const n = (candidates.at(-1)?.n ?? 0) + 1;
      setCandidates((prev) => [...prev, { ...result, n }]);
      setSelected(n);
      setImage({ kind: "idle" });
      setAnnouncement(`第 ${n} 张图片已生成`);
    } catch (error) {
      setImage(isAbort(error) ? { kind: "idle" } : { kind: "error", message: describe(error) });
    }
  }

  async function applySelected() {
    const candidate = candidates.find((c) => c.n === selected);
    if (!candidate || saving.kind === "running") return;
    setSaving({ kind: "running" });
    try {
      const file = new File([base64ToBlob(candidate.image, candidate.contentType)], coverFileName(source.slug, candidate.n, candidate.contentType), { type: candidate.contentType });
      let uploaded = await uploadImage(file);
      const description = alt.trim();
      if (description) uploaded = await adminApi.updateImage(uploaded.id, { description });
      onPick(coverFromImage(uploaded));
      setSaving({ kind: "idle" });
      onClose();
    } catch (error) {
      setSaving({ kind: "error", message: describe(error) });
    }
  }

  const briefModel = ready ? translationModelInfo(ready.brief.model).name : "Claude";
  const imageModel = ready ? imageModelLabel(ready.image.model) : "GPT Image";

  return (
    <Dialog
      open={open}
      title="生成头图"
      onClose={onClose}
      size="wide"
      footer={
        <div className={styles.footer}>
          {saving.kind === "error" && <p className={styles.error}>{saving.message}</p>}
          <div className={styles.footerButtons}>
            <Button onClick={onClose}>关闭</Button>
            <Button variant="primary" onClick={() => void applySelected()} busy={saving.kind === "running"} disabled={selected === null}>
              设为头图
            </Button>
          </div>
        </div>
      }
    >
      <p role="status" className="visually-hidden">
        {announcement}
      </p>

      {config === null && (
        <div className={styles.placeholder} role="status">
          <Spinner />
          <span>正在加载…</span>
        </div>
      )}
      {config === "error" && (
        <Banner title="读不到生成头图的配置" action={<Button onClick={() => setReloadConfig((n) => n + 1)}>重试</Button>}>
          请检查网络后重试。
        </Banner>
      )}

      {ready && (
        <div className={styles.layout}>
          <section className={styles.step} aria-labelledby="cover-brief-heading">
            <h3 id="cover-brief-heading" className={styles.stepTitle}>
              1. 画面描述
            </h3>
            <TextField
              label="方向（可选）"
              hint="比如“用钥匙比喻缓存”“暖色调”；不写就让 Claude 自己想"
              value={direction}
              maxLength={COVER_DIRECTION_MAX_LENGTH}
              onChange={(event) => setDirection(event.target.value)}
              accessory={
                <Button
                  onClick={() => void writeBrief()}
                  disabled={!ready.brief.available || (brief.kind !== "running" && source.title.trim() === "")}
                  title={source.title.trim() === "" ? "先写标题" : undefined}
                >
                  {brief.kind === "running" ? <Square aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                  {brief.kind === "running" ? "停止" : `用 ${briefModel} 写描述`}
                </Button>
              }
            />
            {!ready.brief.available && <p className={styles.note}>{briefUnavailableNotes[ready.brief.reason]}</p>}
            {brief.kind === "running" && (
              <p className={styles.progress}>
                <Spinner /> {briefModel} 正在读文章…
              </p>
            )}
            {brief.kind === "error" && <Banner title="没有写成">{brief.message}</Banner>}

            <TextArea
              label="画面描述"
              hint="英文，和设置里的“头图风格”一起发给图像模型。可以直接改，或者自己写"
              rows={5}
              value={prompt}
              maxLength={COVER_PROMPT_MAX_LENGTH}
              readOnly={brief.kind === "running"}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <TextField
              label="图片描述"
              hint="读屏软件读给看不见图片的读者：写进媒体库，所有用到这张图的地方共用"
              value={alt}
              maxLength={500}
              onChange={(event) => setAlt(event.target.value)}
            />
          </section>

          <section className={styles.step} aria-labelledby="cover-image-heading">
            <h3 id="cover-image-heading" className={styles.stepTitle}>
              2. 图片
            </h3>
            <div className={styles.imageRow}>
              <Button variant="secondary" onClick={() => void generate()} disabled={!ready.image.available || (image.kind !== "running" && prompt.trim() === "")}>
                {image.kind === "running" ? <Square aria-hidden="true" /> : <ImageIcon aria-hidden="true" />}
                {image.kind === "running" ? "停止" : candidates.length > 0 ? "再生成一张" : `用 ${imageModel} 生成`}
              </Button>
              <span className={styles.meta}>画质：{qualityLabel(ready.image.quality)}（在设置里改）</span>
            </div>
            {!ready.image.available && <p className={styles.note}>{imageUnavailableNotes[ready.image.reason]}</p>}
            {image.kind === "error" && <Banner title="没有生成">{image.message}</Banner>}

            {image.kind === "running" && (
              <figure className={styles.pending} aria-busy="true">
                {image.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 后台预览：base64 数据，不经过 next/image
                  <img className={styles.previewImage} src={image.preview} alt="" />
                ) : (
                  <div className={styles.previewBlank} />
                )}
                <figcaption className={styles.progress}>
                  <Spinner /> 正在生成{image.preview ? "（预览）" : ""}… 已用 {image.seconds} 秒，通常要半分钟到两分钟
                </figcaption>
              </figure>
            )}

            {candidates.length > 0 && (
              <fieldset className={styles.results}>
                <legend className={styles.resultsLegend}>选一张作为头图</legend>
                <div className={styles.grid}>
                  {[...candidates].reverse().map((candidate) => (
                    <label key={candidate.n} className={styles.candidate}>
                      <input type="radio" name={resultsName} className={styles.radio} checked={selected === candidate.n} onChange={() => setSelected(candidate.n)} />
                      {/* eslint-disable-next-line @next/next/no-img-element -- 后台预览：base64 数据 */}
                      <img className={styles.candidateImage} src={dataUrl(candidate.image, candidate.contentType)} alt={`第 ${candidate.n} 张`} />
                      <span className={styles.candidateMeta}>
                        第 {candidate.n} 张 · {qualityLabel(candidate.quality)} · {formatImageUsage(candidate.usage)}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}
