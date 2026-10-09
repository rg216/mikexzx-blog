# 个人博客

## 目标
练习完整的 Web 全栈开发。博客是载体，学习是目的：能外包的功能（评论、鉴权、搜索、计数）刻意自己实现。
做非显而易见的设计决策时，简要说明理由和权衡，不要只给结果。

## 架构
Bun workspace monorepo（Bun 只做包管理器和脚本运行器；运行时统一用 Node 24 LTS，版本见 `.node-version`）：
- `apps/web`：Next.js (App Router) + React + TypeScript，包含前台和管理后台
- `apps/api`：Hono（Node 运行时）+ Drizzle ORM + PostgreSQL
- `packages/shared`：zod schema 与类型，前后端共用；API 的输入输出一律以此为准

前后端通过 HTTP 显式通信。前端不用 Server Actions 直连数据库，页面数据通过调用 `apps/api` 获取。

基础设施：PostgreSQL、Redis（阅读计数、限流）、S3 兼容对象存储（图片，预签名 URL 上传）。本地全部用 Docker Compose 运行。

## 约定
- TypeScript strict，禁止 `any`（确实需要时注释原因）
- 所有外部输入用 zod 校验
- 数据库变更只通过 Drizzle migration
- 测试：Vitest（单元 / 接口），Playwright（端到端）
- 使用各依赖的当前稳定版本；引入新依赖前先确认它仍在维护
- 每个阶段结束时项目都必须可部署
- 工具链版本锁定（升级前先查对应插件的 `peerDependencies`）：
  - TypeScript 锁 6.0.x：typescript-eslint 只支持 `<6.1`，TS 7（Go 重写版）暂不可用
  - ESLint 锁 9.x：eslint-plugin-react / import / jsx-a11y 尚未支持 ESLint 10
  - `@types/node` 跟随运行时大版本（24），不跟 npm 最新版
- `packages/shared` 直接导出 TS 源码，无构建步骤；`apps/web` 通过 `transpilePackages` 转译

## 常用命令（在仓库根目录执行）
- `bun install`：安装依赖（isolated linker，见 `bunfig.toml`）
- `bun run dev` / `build` / `start`：前端开发 / 构建 / 启动
- `bun run test` / `lint` / `typecheck`：对所有 workspace 执行

## 设计规范（Apple HIG 的 Web 翻译）
- 样式只引用 design tokens（CSS 变量），不写死颜色、字号、间距
- 字体用系统字体栈：`-apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans", "Noto Sans CJK SC", sans-serif`；CJK 正文行高约 1.7
- 不得嵌入 SF Pro 网络字体，不得使用 SF Symbols（许可证仅限 Apple 平台 app）；图标用 Lucide
- 字号参考 iOS Dynamic Type 默认值，用 rem 表示：Large Title 34 / Title1 28 / Title2 22 / Title3 20 / Headline 17 semibold / Body 17 / Subhead 15 / Footnote 13 / Caption 12
- 语义色：label / secondary label / background / grouped background / separator / accent；用 `prefers-color-scheme` 支持深色模式；accent 浅色 #007AFF，深色 #0A84FF
- 8pt 间距网格；正文宽度约 680px；处理 safe-area inset（`viewport-fit=cover`）
- 毛玻璃（`backdrop-filter`）只用于导航栏和浮层，正文区保持干净
- 动效用 spring 曲线，尊重 `prefers-reduced-motion`
- 可点击区域 ≥ 44×44px，焦点样式可见，语义化 HTML，对比度达标

## 数据模型（初稿）
- `users`
- `posts`：slug, title, content_md, status (draft | published), published_at
- `tags` + `post_tags`
- `comments`：post_id, user_id, parent_id（楼中楼）, body, status（审核）
- `post_views`

## 安全
- 管理员登录：自己实现 session（argon2 哈希、httpOnly + SameSite cookie、CSRF 防护、过期机制）
- 评论者：GitHub OAuth
- 用户提交的 Markdown 渲染前必须 sanitize
- 写接口加限流

## 路线
- [ ] v0 前台：tokens、布局、首页列表、文章页，使用本地假数据；部署上线
- [ ] v1 API：Hono + Drizzle + Postgres，posts CRUD，zod 校验，Vitest
- [ ] v2 管理后台：登录、编辑器、草稿 / 发布、图片上传
- [ ] v3 渲染与缓存：ISR；发布文章时由 API 通知前端 revalidate
- [ ] v4 评论（OAuth、楼中楼、审核）、阅读数（Redis）、全文搜索（Postgres tsvector）
- [ ] v5 工程化：Docker 镜像、GitHub Actions、VPS + Caddy 部署、pino 日志、Sentry、Playwright
