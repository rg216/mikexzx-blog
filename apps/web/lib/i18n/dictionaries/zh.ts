import type { Locale } from "@blog/shared";

/*
 * 前台界面文案（中文）。这个文件定义字典的结构：Dictionary = typeof zh，
 * en.ts / ja.ts 写成 `const en: Dictionary = {…}`，少一个或多一个 key 都编译报错。
 *
 * 不加 `as const`：否则每个值的类型是字面量（"文章"），其他语言的值就对不上了。
 * 带参数的文案写成函数（单复数、语序在各语言里不同，不适合用字符串拼接）。
 * 后台界面不做多语言，不在这里。
 */
const zh = {
  /** 各语言的名称（用当前界面语言写）。satisfies：locales 里加了语言而这里没加，编译报错 */
  languageNames: { zh: "中文", en: "英文", ja: "日文" } satisfies Record<Locale, string>,

  site: {
    description: "练习 Web 全栈开发的个人博客。",
  },

  nav: {
    label: "主导航",
    skipToContent: "跳到正文",
    posts: "文章",
    about: "关于",
    search: "搜索",
  },

  languageSwitcher: {
    /** 按钮的无障碍名称和提示 */
    label: "语言",
  },

  home: {
    title: "文章",
    empty: "还没有文章。",
    asideLabel: "站点信息",
    about: "关于",
    learnMore: "了解更多",
    tags: "标签",
    /** 标签篇数给读屏的完整读法（视觉上只显示数字） */
    tagCount: (count: number) => `${count} 篇`,
  },

  post: {
    allPosts: "全部文章",
    recent: "最近文章",
    asideLabel: "更多文章",
    tags: "标签",
    views: (_count: number, formatted: string) => `${formatted} 次阅读`,
    notice: {
      /** 该语言没有译文，显示的是原文。original：原文语言的名称 */
      untranslated: (original: string) => `这篇文章还没有中文版本，下面是${original}原文。`,
      machine: (original: string) => `本文由${original}原文机器翻译。`,
      outdated: "原文在翻译之后更新过，译文可能不是最新的。",
      goToOriginal: "前往原文页面",
      readOriginal: "阅读原文",
      /** 句子之间、句子和链接之间的分隔：中日文不加空格 */
      separator: "",
    },
  },

  /** 文章正文里由 Markdown 生成的文字：跟着正文的语言，而不是界面语言 */
  markdown: {
    footnoteLabel: "脚注",
    /** reference：第几处引用（从 1 开始）；rereference：同一脚注的第几次引用（大于 1 时才有意义） */
    footnoteBackLabel: (reference: number, rereference: number) =>
      `回到正文第 ${reference} 处引用${rereference > 1 ? `（第 ${rereference} 次）` : ""}`,
  },

  about: {
    title: "关于",
    paragraphs: [
      "这是一个用来练习 Web 全栈开发的博客。博客是载体，学习是目的。",
      "前端用 Next.js，API 用 Hono + Drizzle + PostgreSQL。评论、鉴权、搜索、阅读计数这些通常会外包给第三方的功能，这里都刻意自己实现。",
    ],
  },

  search: {
    title: "搜索",
    fieldLabel: "搜索文章",
    placeholder: "搜索文章",
    hint: "匹配标题、正文和标签",
    found: (count: number) => `找到 ${count} 篇文章`,
    nothingFound: (query: string) => `没有找到与“${query}”相关的文章`,
    errorTitle: "搜索失败",
    errors: {
      network: "无法连接服务器，请检查网络后重试",
      rateLimited: "搜索太频繁，请稍等片刻再试",
      tooLong: (max: number) => `搜索内容不能超过 ${max} 个字符`,
      unavailable: "搜索暂时不可用，请稍后重试",
    },
  },

  comments: {
    heading: "评论",
    loading: "正在加载评论…",
    loadErrorTitle: "评论加载失败",
    retry: "重试",
    closed: "评论暂未开放。",
    blocked: "你已被禁止评论。",
    empty: "还没有评论。",
    signIn: "用 GitHub 登录后评论",
    signInHint: "只读取你的 GitHub 公开资料（用户名和头像）。",
    deletedPlaceholder: "此评论已被作者删除。",
    replyingTo: (login: string) => `回复 @${login}`,
    edited: "已编辑",
    editedAt: (date: string) => `编辑于 ${date}`,
    pending: "审核中，仅你可见",
    actions: {
      reply: "回复",
      edit: "编辑",
      delete: "删除",
    },
    form: {
      newLabel: "发表评论",
      newPlaceholder: "写下你的想法…",
      newSubmit: "发表评论",
      editLabel: "编辑评论",
      editSubmit: "保存",
      replyLabel: (login: string) => `回复 @${login}`,
      replyPlaceholder: (login: string) => `回复 @${login}…`,
      replySubmit: "回复",
      cancel: "取消",
      hintTrusted: "支持 Markdown。评论会直接显示。",
      hintModerated: "支持 Markdown。审核通过后显示，通过前可以修改。",
      /** "以 @login 的身份"：用户名前后的文字（各语言语序不同） */
      identityBefore: "以 ",
      identityAfter: " 的身份",
      signOut: "退出",
      sendErrorTitle: "发送失败",
    },
    notices: {
      submittedPending: "评论已提交，审核通过后所有人都能看到。",
      edited: "评论已修改。",
      deleted: "评论已删除。",
    },
    deleteDialog: {
      title: "删除这条评论？",
      body: "评论内容会被清除，无法恢复。",
      confirm: "删除",
      cancel: "取消",
    },
    /** GitHub 登录回来时地址上的 ?login=… */
    loginResults: {
      cancelled: "你取消了 GitHub 授权，没有登录。",
      failed: "GitHub 登录没有成功，请重试。",
      unavailable: "评论登录暂未开放。",
    },
    /** 按失败原因显示（不直接显示 API 返回的中文 message） */
    errors: {
      network: "无法连接服务器，请检查网络后重试",
      rateLimited: "评论太频繁，请过几分钟再试",
      invalid: "评论内容无效，请检查后重试",
      unauthorized: "登录已失效，请重新登录",
      forbidden: "没有权限进行这个操作，刷新页面可以看到最新状态",
      notFound: "评论或文章已经不存在，请刷新页面",
      unavailable: "服务暂时不可用，请稍后重试",
      deleteFailed: "删除失败，请稍后重试",
      signOutFailed: "退出失败，请稍后重试",
    },
  },

  notFound: {
    title: "找不到这个页面",
    text: "链接可能写错了，或者文章已经被删除。",
    home: "回到首页",
  },
};

export type Dictionary = typeof zh;
export default zh;
