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
浏览器访问 API 一律走前端的 `/api/*`（`next.config.ts` 的 rewrites 代理到 API）：保证 session cookie 是第一方的、Passkey 在前端源下完成；服务端渲染取数据直连 `API_URL`。

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
- `apps/api/tsconfig.json` 自包含、不继承 `tsconfig.base.json`（Vercel 构建 API 时读不到 Root Directory 外的文件，会强制 strict=false 误报）；改 base 时同步修改它
- Next.js 16 的 API 与旧版差异大：写 Next 相关代码前先查与安装版本一致的文档 `apps/web/node_modules/next/dist/docs/`

## 常用命令（在仓库根目录执行）
- 首次：`bun install`（isolated linker，见 `bunfig.toml`）；`cp apps/api/.env.example apps/api/.env`，填 `ADMIN_SETUP_TOKEN` 后打开 http://localhost:3000/admin/login 注册第一个 Passkey
- `docker compose up -d`：本地 PostgreSQL 18（开发库 `blog`，测试库 `blog_test`）和 Redis 8.8（开发用 0 号库，测试用 15 号库）
- `bun run db:migrate` / `db:seed`：迁移本地库 / 写入初始文章；改了 `schema.ts` 后 `bun run db:generate` 生成迁移
- `bun run dev`：同时启动 API（:8787）和前端（:3000）
- `bun run build`：构建前端（构建时会请求 API，需要 API 在运行）
- `bun run test` / `lint` / `typecheck`：对所有 workspace 执行（API 测试连 `blog_test` 和 Redis 15 号库，需要 `docker compose up -d`）
- 前端目录：`app/(site)/` 前台（SiteShell：导航 + 页脚）；`app/admin/login` 登录页；`app/admin/(panel)/` 需登录的后台（AdminNav + SessionGate）

## API 约定
- API 用 Node 24 原生 type stripping 直接运行 TS：相对导入写 `.ts` 扩展名，只用可擦除语法（无 enum、参数属性等）
- 部署时先打包：`bun run --filter @blog/api build`（esbuild，`build.ts`）生成 `dist/index.js`，内联 workspace 包、npm 依赖保持 external；Vercel 按 `apps/api/vercel.json` 从 `dist/` 找入口（它的构建器不会改写 `.ts` 导入）
- 公开接口只用 slug 定位文章、只返回已发布内容；管理接口在 `/admin/*`，v1 用 `ADMIN_TOKEN` Bearer 鉴权（v2 换成 session）
- 错误统一为 `{ error: { code, message, issues? } }`（见 `apiErrorSchema`）；列表用游标分页（`{ items, nextCursor }`）
- 业务不变量尽量同时落在数据库约束上（如"已发布必须有发布时间"的 CHECK）
- 测试连真实 Postgres，不 mock 数据库

## Redis：限流与阅读计数（v4a）
- 客户端用官方 `redis`（node-redis），标准协议，本地 Docker / 线上 Upstash / 以后自建通用；关闭离线队列，断线时命令立即失败
- 限流：固定窗口（MULTI 里 INCR + PEXPIRE NX），规则集中在 `lib/rate-limit.ts` 的 `rules`；Redis 不可用时放行（fail-open）；键只存哈希，不存原始 IP
- 阅读计数：访客 = SHA-256(每日随机盐 | IP | UA)，同一访客同一天同一篇只计一次，不用 cookie、不存 IP；爬虫不计数；数字由浏览器单独请求，不进 ISR 页面
- 每天 00:10（北京时间）Vercel Cron 调 `GET /internal/views/flush`（Bearer `CRON_SECRET`），把前两天的计数幂等写入 `post_views`

## 渲染与缓存（v3）
- 前台页面是 ISR：构建时预生成，新 slug 首次访问时生成；数据请求带 `next: { revalidate: 3600, tags }`
- 缓存标签定义在 `@blog/shared` 的 `cacheTags`：列表类 `posts`，单篇 `post:<slug>`
- API 写入文章后（`tagsForChange`：只要写入前后有一边是已发布）调用前端 `POST /hooks/revalidate`（Bearer `REVALIDATE_SECRET`，两个项目共享），前端 `revalidateTag(tag, { expire: 0 })`
- 通知失败只记日志、不影响写入；一小时定时刷新兜底。`/hooks` 不能放在 `/api` 下（`/api/*` 整体代理给 API）

## 设计规范（Apple HIG 的 Web 翻译）
- 样式只引用 design tokens（CSS 变量），不写死颜色、字号、间距
- 字体用系统字体栈：`-apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans", "Noto Sans CJK SC", sans-serif`（Apple 设备上英文即为 San Francisco）；CJK 正文行高 1.6（参考 Newsroom 的约 1.45 与常规 1.7 之间）
- 不得嵌入 SF Pro 网络字体，不得使用 SF Symbols（许可证仅限 Apple 平台 app）；图标用 Lucide
- 页脚 "Created with Claude" 只用纯文字，不用 Claude / Anthropic logo：没有公开授权的徽章，[商标规范](https://www.anthropic.com/legal/trademark-guidelines)要求 logo 使用须事先书面许可
- 界面字号参考 iOS Dynamic Type 默认值，用 rem 表示：Large Title 34 / Title1 28 / Title2 22 / Title3 20 / Headline 17 semibold / Body 17 / Subhead 15 / Footnote 13 / Caption 12
- 文章阅读字号参考 Apple Newsroom：正文 17（桌面试过 19 / 18，偏大）；文章标题 28 → 40 → 48 bold；正文 h2 22 → 24 bold
- 小号灰色文字（日期、标签、图注、侧栏标题）用 semibold 补偿，避免单薄
- 语义色：label / secondary label / background / grouped background / separator / accent；用 `prefers-color-scheme` 支持深色模式；accent 浅色 #007AFF，深色 #0A84FF
- 8pt 间距网格；处理 safe-area inset（`viewport-fit=cover`）
- 版面三层宽度：页面 1200px / 出血图片 864px / 正文 680px；桌面主栏 + 280px 侧栏（侧栏放控件、推荐文章，DOM 顺序在主内容之后）
- 断点用 rem：md 46rem（≈736px）、lg 70rem（≈1120px，出现侧栏、文章标题 48px）
- 图文混排：单独成段的图片渲染为 `<figure>`（title 作图注），桌面比正文宽、手机贴满屏幕两侧
- 毛玻璃（`backdrop-filter`）只用于导航栏和浮层，正文区保持干净
- 动效用 spring 曲线，尊重 `prefers-reduced-motion`
- 可点击区域 ≥ 44×44px，焦点样式可见，语义化 HTML，对比度达标

## 数据模型（初稿）
- `users`（单管理员）、`passkeys`、`sessions`、`auth_challenges`
- `posts`：slug, title, content_md, status (draft | published), published_at
- `tags` + `post_tags`
- `comments`：post_id, user_id, parent_id（楼中楼）, body, status（审核）
- `post_views`

## 安全
- 管理员登录：只用 Passkey（WebAuthn），没有密码；协议验证用 SimpleWebAuthn，其余自己实现
  - session：随机 token，库里只存 SHA-256；cookie `__Host-session`（httpOnly、Secure、SameSite=Lax）；闲置 7 天 / 最长 30 天过期；登录总是签发新 session
  - CSRF：SameSite=Lax + 所有写请求校验 `Origin` 必须等于 `WEB_ORIGIN`
  - challenge 一次性、5 分钟过期（DELETE … RETURNING 原子取出）；要求用户验证（UV）与可发现凭证
  - 首次设置 / 全部设备丢失后的恢复：临时设置 `ADMIN_SETUP_TOKEN` 允许未登录注册 Passkey，用完立即删除；不能删除最后一个 Passkey
  - Passkey 绑定 RP ID（前端域名）：换域名需要重新注册
- 评论者：GitHub OAuth
- 用户提交的 Markdown 渲染前必须 sanitize
- 写接口加限流

## 路线
- [x] v0 前台：tokens、布局、首页列表、文章页，使用本地假数据；部署上线（Vercel，Root Directory `apps/web`，push 到 main 自动部署：https://mikexzx-blog.vercel.app）
- [x] v1 API：Hono + Drizzle + Postgres，posts CRUD，zod 校验，Vitest（API 部署在 Vercel 第二个项目，Root Directory `apps/api`：https://mikexzx-blog-api.vercel.app；数据库 Neon us-east-1，迁移在本地用 `apps/api/.env.neon` 直连执行；前端项目设 `API_URL`）
- [ ] v2 管理后台：登录、编辑器、草稿 / 发布、图片上传
- [x] v3 渲染与缓存：ISR；发布文章时由 API 通知前端 revalidate（两个 Vercel 项目共享 `REVALIDATE_SECRET`）
- [ ] v4 评论（OAuth、楼中楼、审核）、阅读数（Redis）、全文搜索（Postgres tsvector）
- [ ] v5 工程化：Docker 镜像、GitHub Actions、VPS + Caddy 部署、pino 日志、Sentry、Playwright
