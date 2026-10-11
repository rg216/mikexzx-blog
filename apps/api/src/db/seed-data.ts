import type { Locale, PostCreateInput } from "@blog/shared";

/*
 * 开发环境的初始数据（原 v0 前端的假数据）：bun run db:seed 写入本地数据库。
 * 写入时仍经过 postCreateInputSchema 校验和服务层，和 API 走同一条路径。
 */
export const seedPosts: PostCreateInput[] = [
  {
    slug: "why-build-a-blog-from-scratch",
    title: "为什么要从零写一个博客",
    status: "published",
    publishedAt: "2026-10-09T10:00:00+08:00",
    tags: [
      { slug: "meta", name: "关于本站" },
      { slug: "fullstack", name: "全栈" },
    ],
    contentMd: `现成的博客系统有很多，用 Hugo、Astro 或者一个 Notion 页面，十分钟就能上线。但这个博客的目的不是“有个博客”，而是**把 Web 全栈完整走一遍**。

## 规则只有一条

能外包的功能，刻意自己实现：

- 评论：自己存储、自己审核，评论者用 GitHub OAuth 登录
- 鉴权：管理员登录用自己实现的 session，而不是接第三方服务
- 搜索：用 Postgres 的 \`tsvector\` 做全文检索
- 计数：阅读数放在 Redis 里

## 路线

整个项目分成六个阶段，每个阶段结束时都必须能部署上线：

1. 前台：design tokens、布局、首页列表、文章页
2. API：Hono + Drizzle + PostgreSQL
3. 管理后台：登录、编辑器、草稿与发布
4. 渲染与缓存：ISR，发布时通知前端 revalidate
5. 评论、阅读数、全文搜索
6. 工程化：Docker、CI、VPS 部署、日志与监控

> 博客是载体，学习是目的。

你现在看到的就是第一阶段的产物：所有文章都还是本地假数据。`,
  },
  {
    slug: "apple-hig-to-design-tokens",
    title: "把 Apple HIG 翻译成 Web 的 design tokens",
    status: "published",
    publishedAt: "2026-10-05T21:30:00+08:00",
    tags: [
      { slug: "design", name: "设计" },
      { slug: "css", name: "CSS" },
    ],
    contentMd: `Apple 的 Human Interface Guidelines 是为原生 app 写的，但其中的很多原则——层级清晰、内容优先、尊重用户的系统设置——在 Web 上一样成立。难点在于把 pt、Dynamic Type、语义色这些概念翻译成 CSS。

## 字号：Dynamic Type → rem

iOS 的默认字号以 pt 为单位，在 Web 上直接除以 16 换算成 rem：

| 样式 | iOS (pt) | Web (rem) |
| --- | ---: | ---: |
| Large Title | 34 | 2.125 |
| Title 1 | 28 | 1.75 |
| Title 2 | 22 | 1.375 |
| Body | 17 | 1.0625 |
| Footnote | 13 | 0.8125 |

用 rem 而不是 px 的好处是：用户在浏览器里调大默认字号时，整个站点会等比放大。这差不多就是 Web 版的 Dynamic Type。

![iOS Dynamic Type 字号阶梯](/images/posts/type-scale.svg "iOS Dynamic Type 的九级默认字号，以及换算后的 rem 值。")

## 语义色

组件里不写 \`#000\`，而是写 \`var(--color-label)\`。深色模式只需要在一个地方重新定义变量：

\`\`\`css
:root {
  --color-label: #000000;
  --color-background: #ffffff;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-label: #ffffff;
    --color-background: #000000;
  }
}
\`\`\`

### 一个和 HIG 冲突的地方

iOS 的 \`secondaryLabel\` 在白底上的对比度只有 3.4:1 左右，达不到 WCAG AA 要求的 4.5:1。原生 app 可以靠系统的“增强对比度”选项兜底，网页没有这个开关，所以这里把它的透明度从 0.6 提到了 0.75。

同理，\`#007AFF\` 作为正文链接颜色也只有约 4.0:1，链接文字单独用了更深一点的 \`#0066CC\`。

## 动效：弹簧曲线

CSS 的 \`linear()\` 函数可以用一串采样点描述任意曲线，于是可以把真实的阻尼弹簧方程采样后写进 CSS，而不是用 \`cubic-bezier\` 去近似。

![弹簧曲线与 ease-out 曲线对比](/images/posts/spring-curve.svg "阻尼比约 0.8 的弹簧会略微越过终点再回落，ease-out 则平滑地停住。")

弹簧在终点附近有约 1.4% 的回弹，幅度很小，但正是这一点让按压反馈显得“有弹性”。`,
  },
  {
    slug: "choosing-a-package-manager",
    title: "pnpm、Bun 还是 npm：为一个 monorepo 选包管理器",
    status: "published",
    publishedAt: "2026-09-28T19:00:00+08:00",
    tags: [
      { slug: "tooling", name: "工具链" },
      { slug: "fullstack", name: "全栈" },
    ],
    contentMd: `这个项目是一个 monorepo：前端、API 和共享的 schema 包放在一起。最开始的计划是 pnpm workspace，最后换成了 Bun。

## 包管理器 ≠ 运行时

Bun 同时是三样东西：包管理器、脚本运行器、JavaScript 运行时。它们可以分开选：

- **包管理器**：用 Bun。安装快，原生支持 workspaces，lockfile 是文本格式
- **运行时**：仍然用 Node。Next.js 以 Node 为主要目标，出问题时更容易判断是谁的锅

\`bun run dev\` 执行的脚本里调用的是 \`next\`，而 \`next\` 的 shebang 是 \`#!/usr/bin/env node\`，所以实际跑在 Node 上。

## 隔离安装

pnpm 有一个很重要的特性：每个包只能 import 自己声明过的依赖。Bun 的 isolated linker 提供同样的保证：

\`\`\`toml
[install]
linker = "isolated"
\`\`\`

没有这个限制时，A 包碰巧能 import 到 B 包的依赖，本地一切正常，部署时才发现漏写了依赖。`,
  },
  {
    slug: "cjk-typography-notes",
    title: "中文网页排版的几个细节",
    status: "published",
    publishedAt: "2026-09-20T14:00:00+08:00",
    tags: [
      { slug: "design", name: "设计" },
      { slug: "typography", name: "排版" },
    ],
    contentMd: `中文和英文混排时，有几个细节值得单独处理。

## 行高

拉丁字母有升部和降部，视觉上自带留白；汉字是方块字，每个字都把格子填满。所以中文正文需要更大的行高，**1.7 左右**读起来比较舒服，而英文网页常见的 1.4–1.5 对中文来说太挤了。

## 行宽

一行太长，眼睛换行时容易找错位置；太短又会频繁换行。17px 的正文配 680px 左右的内容宽度，大约是每行 40 个汉字。

## 字体

不嵌入网络字体，直接用系统字体栈：苹方、Hiragino、Noto Sans CJK。中文字体文件动辄几 MB，嵌入的代价远大于收益[^font]。

[^font]: 子集化可以缓解，但对一个文章内容不断变化的博客来说，维护成本不低。

## 其他

- [x] 正文**不用** \`text-wrap: pretty\`：它在英文里能避免末行孤字，在中文段落里却会让行尾参差不齐
- [x] 标题用 \`text-wrap: balance\`，让多行标题长度更均匀
- [ ] 中英文之间的间距（还在考虑要不要用 \`text-autospace\`）`,
  },
  {
    slug: "why-sanitize-markdown",
    title: "Markdown 渲染为什么必须 sanitize",
    status: "published",
    publishedAt: "2026-09-12T22:15:00+08:00",
    tags: [
      { slug: "security", name: "安全" },
      { slug: "fullstack", name: "全栈" },
    ],
    contentMd: `Markdown 允许内嵌 HTML，这意味着“渲染用户提交的 Markdown”本质上等于“渲染用户提交的 HTML”。

## 一个最简单的例子

下面这段 Markdown 如果原样转成 HTML 插入页面，就会执行脚本：

\`\`\`markdown
看起来是一条普通评论。

<img src="x" onerror="alert(document.cookie)">

[点我](javascript:alert(1))
\`\`\`

## 两层防护

1. Markdown 转 HTML 时**丢弃原始 HTML**，不让它进入输出
2. 生成 HTML 之后再按**白名单**清洗：只保留已知安全的标签和属性，链接只允许 \`http\`、\`https\`、\`mailto\` 等协议

第二层是兜底：即使第一层的配置以后被人改了，危险内容也到不了浏览器。

> 不要用黑名单。你永远列不全所有危险的东西，但可以列全所有你需要的东西。`,
  },
  {
    slug: "v1-api-plan",
    title: "v1 计划：Hono + Drizzle + PostgreSQL",
    status: "draft",
    publishedAt: null,
    tags: [{ slug: "fullstack", name: "全栈" }],
    contentMd: "草稿：这篇不应该出现在任何公开页面上。",
  },
];

/**
 * 开发环境的示例译文（v4.5）：让本地的 /en、/ja 有内容可看。作为人工译文写入，依据的是上面的原文。
 * 只翻译第一篇：其他文章在英文、日文列表里不出现，直接访问时显示原文 + 提示——两种情况本地都能看到。
 */
export const seedTranslations: { slug: string; locale: Locale; title: string; contentMd: string }[] = [
  {
    slug: "why-build-a-blog-from-scratch",
    locale: "en",
    title: "Why build a blog from scratch",
    contentMd: `There are plenty of ready-made blog systems: with Hugo, Astro or a Notion page you can be online in ten minutes. But the point of this blog isn't "having a blog" — it's **walking through the whole web stack, end to end**.

## Just one rule

Anything that could be outsourced is deliberately built by hand:

- Comments: stored and moderated here, commenters sign in with GitHub OAuth
- Auth: the admin signs in with a home-made session instead of a third-party service
- Search: full-text search with Postgres \`tsvector\`
- Counting: view counts live in Redis

## Roadmap

The project is split into six stages, and every stage must end in something deployable:

1. Front end: design tokens, layout, home page list, post page
2. API: Hono + Drizzle + PostgreSQL
3. Admin: sign-in, editor, drafts and publishing
4. Rendering and caching: ISR, revalidating the front end on publish
5. Comments, view counts, full-text search
6. Engineering: Docker, CI, VPS deployment, logging and monitoring

> The blog is the vehicle; learning is the goal.

What you're looking at is the output of the first stage: every post is still local mock data.`,
  },
  {
    slug: "why-build-a-blog-from-scratch",
    locale: "ja",
    title: "なぜブログをゼロから作るのか",
    contentMd: `既製のブログシステムはたくさんあります。Hugo や Astro、あるいは Notion のページを使えば、十分で公開できます。しかしこのブログの目的は「ブログを持つこと」ではなく、**Web のフルスタックを一通り経験すること**です。

## ルールはひとつだけ

外部サービスに任せられる機能は、あえて自分で実装します：

- コメント：自前で保存・承認し、コメント投稿者は GitHub OAuth でログイン
- 認証：管理者のログインはサードパーティではなく自作のセッションで
- 検索：Postgres の \`tsvector\` で全文検索
- カウント：閲覧数は Redis に保存

## ロードマップ

プロジェクトは六つの段階に分かれ、各段階の終わりには必ずデプロイできる状態にします：

1. フロントエンド：デザイントークン、レイアウト、トップページの一覧、記事ページ
2. API：Hono + Drizzle + PostgreSQL
3. 管理画面：ログイン、エディタ、下書きと公開
4. レンダリングとキャッシュ：ISR、公開時にフロントエンドへ revalidate を通知
5. コメント、閲覧数、全文検索
6. エンジニアリング：Docker、CI、VPS へのデプロイ、ログと監視

> ブログは手段であり、目的は学ぶことです。

いまご覧になっているのは第一段階の成果物です。記事はすべてまだローカルのダミーデータです。`,
  },
];
