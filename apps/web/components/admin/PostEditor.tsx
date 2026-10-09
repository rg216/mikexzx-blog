"use client";

import type { AdminPost } from "@blog/shared";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { adminApi, AdminApiError } from "@/lib/admin-api";
import styles from "./PostEditor.module.css";
import { PostEditorForm } from "./PostEditorForm";

type LoadState = { kind: "loading" } | { kind: "error"; message: string; notFound: boolean } | { kind: "ready"; post: AdminPost };

/** 编辑器入口：没有 postId 是新建；有 postId 先加载文章，再交给表单。 */
export function PostEditor({ postId }: { postId?: number }) {
  if (postId === undefined) return <PostEditorForm initialPost={null} />;
  return <ExistingPostEditor postId={postId} />;
}

function ExistingPostEditor({ postId }: { postId: number }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  // 每次 +1 触发重新加载（"重试"按钮）
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    adminApi.getPost(postId).then(
      (post) => {
        if (!ignore) setState({ kind: "ready", post });
      },
      (error: unknown) => {
        if (ignore) return;
        const notFound = error instanceof AdminApiError && error.code === "not_found";
        const message = error instanceof AdminApiError ? error.message : "出现了意外错误，请稍后重试";
        setState({ kind: "error", message, notFound });
      },
    );
    return () => {
      ignore = true;
    };
  }, [postId, reloadKey]);

  if (state.kind === "ready") return <PostEditorForm initialPost={state.post} />;

  return (
    <div className={styles.status}>
      <h1 className={state.kind === "error" && state.notFound ? styles.title : "visually-hidden"}>
        {state.kind === "error" && state.notFound ? "找不到这篇文章" : "编辑文章"}
      </h1>

      {state.kind === "loading" && (
        <p className={styles.loading}>
          <Spinner />
          正在加载文章…
        </p>
      )}

      {state.kind === "error" && state.notFound && <p className={styles.text}>它可能已经被删除了。</p>}

      {state.kind === "error" && !state.notFound && (
        <Banner
          title="文章加载失败"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setState({ kind: "loading" });
                setReloadKey((key) => key + 1);
              }}
            >
              重试
            </Button>
          }
        >
          {state.message}
        </Banner>
      )}

      {state.kind === "error" && (
        <Link href="/admin/posts" className={styles.back}>
          <ChevronLeft aria-hidden="true" className={styles.backIcon} />
          返回文章列表
        </Link>
      )}
    </div>
  );
}
