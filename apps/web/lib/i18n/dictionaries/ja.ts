import type { Dictionary } from "./zh";

/*
 * 日文界面：です・ます体，按钮等短标签用名词或动词原形（"返信""削除"），与日本常见的博客 / Web 服务一致。
 * 日文里数字和汉字之间习惯不加空格（"3 件"→"3件"）。
 */
const ja: Dictionary = {
  languageNames: { zh: "中国語", en: "英語", ja: "日本語" },

  site: {
    description: "Web のフルスタック開発を練習するための個人ブログです。",
  },

  nav: {
    // 读屏会在后面读出"ナビゲーション"，这里只写区别于其他导航的部分
    label: "メイン",
    skipToContent: "本文へスキップ",
    posts: "記事",
    // 导航栏在手机宽度下要排成一行，用短的写法（日本网站导航里常见）；页面标题仍是「このブログについて」
    about: "About",
    search: "検索",
  },

  languageSwitcher: {
    label: "言語",
  },

  home: {
    title: "記事",
    empty: "まだ記事はありません。",
    asideLabel: "サイト情報",
    about: "このブログについて",
    learnMore: "詳しく見る",
    tags: "タグ",
    tagCount: (count) => `${count}件`,
  },

  post: {
    allPosts: "記事一覧",
    recent: "最近の記事",
    asideLabel: "ほかの記事",
    tags: "タグ",
    views: (_count, formatted) => `閲覧数 ${formatted}`,
    notice: {
      untranslated: (original) => `この記事はまだ日本語に翻訳されていません。${original}の原文を表示しています。`,
      machine: (original) => `この記事は${original}の原文を機械翻訳したものです。`,
      outdated: "翻訳後に原文が更新されています。内容が最新でない可能性があります。",
      goToOriginal: "原文のページへ",
      readOriginal: "原文を読む",
      separator: "",
    },
  },

  markdown: {
    footnoteLabel: "脚注",
    footnoteBackLabel: (reference, rereference) => `本文の参照箇所 ${reference} に戻る${rereference > 1 ? `（${rereference}回目）` : ""}`,
  },

  about: {
    title: "このブログについて",
    paragraphs: [
      "Web のフルスタック開発を練習するためのブログです。ブログはあくまで題材で、目的は学ぶことにあります。",
      "フロントエンドは Next.js、API は Hono + Drizzle + PostgreSQL で作っています。コメント、認証、検索、閲覧数のカウントなど、ふだんは外部サービスに任せがちな機能も、ここではあえてすべて自前で実装しています。",
    ],
  },

  search: {
    title: "検索",
    fieldLabel: "記事を検索",
    placeholder: "記事を検索",
    hint: "タイトル・本文・タグから検索します",
    found: (count) => `${count}件の記事が見つかりました`,
    nothingFound: (query) => `「${query}」に一致する記事は見つかりませんでした`,
    errorTitle: "検索できませんでした",
    errors: {
      network: "サーバーに接続できません。ネットワークを確認して、もう一度お試しください。",
      rateLimited: "検索の回数が多すぎます。少し時間をおいてからお試しください。",
      tooLong: (max) => `検索語は${max}文字以内で入力してください。`,
      unavailable: "現在、検索をご利用いただけません。しばらくしてからもう一度お試しください。",
    },
  },

  comments: {
    heading: "コメント",
    loading: "コメントを読み込んでいます…",
    loadErrorTitle: "コメントを読み込めませんでした",
    retry: "再試行",
    closed: "現在、コメントは受け付けていません。",
    blocked: "このアカウントではコメントできません。",
    empty: "まだコメントはありません。",
    signIn: "GitHub でログインしてコメント",
    signInHint: "取得するのは GitHub の公開プロフィール（ユーザー名とアイコン）のみです。",
    deletedPlaceholder: "このコメントは投稿者によって削除されました。",
    replyingTo: (login) => `@${login} への返信`,
    edited: "編集済み",
    editedAt: (date) => `${date}に編集`,
    pending: "承認待ち（あなたにのみ表示されています）",
    actions: {
      reply: "返信",
      edit: "編集",
      delete: "削除",
    },
    form: {
      newLabel: "コメントを書く",
      newPlaceholder: "ご意見・ご感想をどうぞ…",
      newSubmit: "コメントする",
      editLabel: "コメントを編集",
      editSubmit: "保存",
      replyLabel: (login) => `@${login} に返信`,
      replyPlaceholder: (login) => `@${login} に返信…`,
      replySubmit: "返信する",
      cancel: "キャンセル",
      hintTrusted: "Markdown が使えます。コメントはすぐに表示されます。",
      hintModerated: "Markdown が使えます。承認後に表示され、承認されるまでは編集できます。",
      identityBefore: "",
      identityAfter: " としてログイン中",
      signOut: "ログアウト",
      sendErrorTitle: "送信できませんでした",
    },
    notices: {
      submittedPending: "コメントを送信しました。承認されると公開されます。",
      edited: "コメントを更新しました。",
      deleted: "コメントを削除しました。",
    },
    deleteDialog: {
      title: "このコメントを削除しますか？",
      body: "コメントの内容は消去され、元に戻すことはできません。",
      confirm: "削除",
      cancel: "キャンセル",
    },
    loginResults: {
      cancelled: "GitHub での認証がキャンセルされたため、ログインしていません。",
      failed: "GitHub でのログインに失敗しました。もう一度お試しください。",
      unavailable: "コメント用のログインは現在ご利用いただけません。",
    },
    errors: {
      network: "サーバーに接続できません。ネットワークを確認して、もう一度お試しください。",
      rateLimited: "コメントの投稿が続いています。数分おいてからもう一度お試しください。",
      invalid: "コメントの内容を受け付けられませんでした。確認してもう一度お試しください。",
      unauthorized: "ログインの有効期限が切れました。もう一度ログインしてください。",
      forbidden: "この操作は行えません。ページを再読み込みして最新の状態をご確認ください。",
      notFound: "コメントまたは記事が見つかりません。ページを再読み込みしてください。",
      unavailable: "現在、サービスをご利用いただけません。しばらくしてからもう一度お試しください。",
      deleteFailed: "削除できませんでした。しばらくしてからもう一度お試しください。",
      signOutFailed: "ログアウトできませんでした。しばらくしてからもう一度お試しください。",
    },
  },

  notFound: {
    title: "ページが見つかりません",
    text: "URL が間違っているか、記事が削除された可能性があります。",
    home: "ホームに戻る",
  },
};

export default ja;
