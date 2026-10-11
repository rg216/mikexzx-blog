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
- `docker compose up -d`：本地 PostgreSQL 18（开发库 `blog`，测试库 `blog_test`）、Redis 8.8（开发用 0 号库，测试用 15 号库）、RustFS 对象存储（:9000，存储桶 `blog-images` / `blog-images-test`，由 `storage-init` 自动创建并开放匿名读）
- `bun run db:migrate` / `db:seed`：迁移本地库 / 写入初始文章；改了 `schema.ts` 后 `bun run db:generate` 生成迁移
- `bun run dev`：同时启动 API（:8787）和前端（:3000）
- `bun run build`：构建前端（构建时会请求 API，需要 API 在运行）
  - macOS 上本地 `next start` 不要请求大小写混用的网址（`/eN/about`）：Next 把 ISR 结果按网址路径存成文件，APFS 不区分大小写，`/eN/about` 的 404 会覆盖 `/en/about` 的缓存，重启也不恢复。出现了就 `rm -rf apps/web/.next/server/route-cache` 或重新构建；端到端测试放在 Linux（CI / Docker）上跑。线上（Vercel、以后的 VPS）是 Linux，不受影响
- `bun run test` / `lint` / `typecheck`：对所有 workspace 执行（API 测试连 `blog_test`、Redis 15 号库和 RustFS 测试桶，需要 `docker compose up -d`）
- 前端目录：没有 `app/layout.tsx`，两个根布局——`app/[lang]/layout.tsx` 前台（`<html lang>` 随语言变；SiteShell：导航 + 页脚），`app/admin/layout.tsx` 后台（固定 zh-CN）；共用的 metadata / viewport 在 `lib/root-metadata.ts`。`app/admin/login` 登录页；`app/admin/(panel)/` 需登录的后台（AdminNav + SessionGate）

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
- 客户端 IP 取 `X-Forwarded-For` 第一项：经前端 `/api` rewrite 转发时 API 看到的仍是访客真实 IP，客户端伪造该头无效（Vercel 边缘会覆写；2026-10 线上验证）。换成 VPS + Caddy 时要让 Caddy 覆写这个头
- 阅读计数：访客 = SHA-256(每日随机盐 | IP | UA)，同一访客同一天同一篇只计一次，不用 cookie、不存 IP；爬虫不计数；数字由浏览器单独请求，不进 ISR 页面
- 每天 00:10（北京时间）Vercel Cron 调 `GET /internal/views/flush`（Bearer `CRON_SECRET`），把前两天的计数幂等写入 `post_views`

## 媒体库与图片（v2c）
- 集中管理：图片可以被多篇文章重复引用，不属于任何一篇；后台 `/admin/media`（一层文件夹、搜索、只看未被引用、批量移动 / 删除），编辑器"插入图片"打开媒体选择器，粘贴 / 拖入仍直接上传
- 引用关系从正文推导：保存文章或译文（含删除译文）时，按原文 + 所有译文正文里图片 key 的并集重建 `post_images`（`syncPostImages(db, postId)` 自己读库）；只被译文引用的图片同样算被引用。`db:migrate` 后全部重建一遍。按 key（`images/YYYY/MM/<16 位随机串>.<ext>`）而不是整个地址识别，以后换图片域名旧文章照样认得；删除仍被引用的图片要 `force`，界面上会列出受影响的文章
- 上传流程（浏览器直传对象存储，文件不经过 API——Vercel 函数请求体上限 4.5MB）：
  1. 浏览器缩放（长边 ≤ 2560）并重新编码 JPEG/PNG/WebP，去掉 EXIF（GPS 位置），同时生成比原图窄的 640 / 1280 / 1920 版本（`<随机串>-640w.jpg`）；GIF、AVIF 原样上传、不生成版本
  2. `POST /admin/images`：API 记一笔待确认的图片，为原图和每个版本各签发预签名 PUT URL（5 分钟），content-type、content-length、cache-control 都签进去
  3. `POST /admin/images/:id/confirm`：HEAD 核对每个文件，再用 Range 请求读原图前 128KB、从文件头解析宽高（`lib/image-dimensions.ts`，不信任浏览器报的尺寸）
  4. 每天 00:20（北京时间）Cron `GET /internal/images/cleanup`：删除超过一天没确认的图片（含各版本），并补全旧图片的宽高
- 显示尺寸写在地址的 #片段里（`@blog/shared` 的 media.ts）：`#small`（340px）/ `#medium`（正文宽 680）/ `#large`（默认，出血 864，手机贴边）/ `#w=320`（40–2000）。`rehype-images` 读取后去掉片段，媒体库图片加 width/height、srcset、sizes 和 `--image-max` / `--image-ratio`；宽度由一条 `min()` 算出：不放大、不超过显示尺寸和栏宽、竖图高度不超过 80svh
- 只收 JPEG / PNG / WebP / AVIF / GIF，≤ 10MB；不收 SVG（可内嵌脚本）。文件内容不变，缓存一年
- S3 协议客户端自己实现（`lib/sigv4.ts` 用 AWS 文档的测试向量验证，`storage.ts`），不用 AWS SDK；一律路径风格地址
- 本地 RustFS（MinIO 社区版已停止维护、镜像下架）；线上 Cloudflare R2：region `auto`，存储桶需配置 CORS（允许前端源 PUT，AllowedHeaders 含 content-type、cache-control），公开访问用 r2.dev 地址（有速率限制，以后有自己的域名后改绑自定义域名）
- 环境变量 `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_PUBLIC_URL`，要么全设要么全不设

## 评论（v4c）
- 评论者用 GitHub 登录（GitHub App，不申请任何权限，只读公开资料；一个 App 配本地和线上两个回调地址），与管理员的 Passkey 体系完全分开：
  - 独立的表（`commenters`、`commenter_sessions`）和 cookie（`__Host-commenter`）；评论者 session 访问不了 `/admin/*`
  - OAuth 授权码 + PKCE（S256）；state 存在 `oauth_states`（一次性、10 分钟）并同时放进 `__Host-oauth` cookie（SameSite=Lax，从 GitHub 跳回是跨站导航），回调时两者必须一致，防登录 CSRF
  - 授权页总带 `prompt=select_account`：否则 GitHub 已登录且授权过时会静默登录回同一个账号，本站退出后换不了账号
  - access token 用完即弃；登录后跳回的地址只接受本站路径（`lib/safe-path.ts`），失败时带 `?login=cancelled|failed` 回原页面
- 审核规则是白名单制：`trust` 为 trusted 的直接显示，default 的每条都待审核，blocked 的不能评论。加入白名单会通过其所有待审核评论，拉黑会拒绝它们；可以按 GitHub 用户名预先加入（API 查 GitHub 公开资料）
- 楼中楼两层：`root_id` 指向顶层评论，`parent_id` 指向直接回复的那条（"回复 @谁"）；只能回复同一篇文章里已显示的评论；顶层评论不可见时整楼不显示，删除顶层评论连同整楼删除
- 作者可以删除自己的评论（被拉黑的也可以）：清空正文、记下 `deleted_at`，不删行；删掉的回复不显示，删掉的楼主有回复时留"此评论已被作者删除"占位。编辑规则见 `canEditComment`（shared）：白名单随时可改，其他人只能在审核通过前改（防止过审后改成广告），显示"已编辑"
- 评论由浏览器请求（`GET /posts/:slug/comments`，`Cache-Control: private, no-store`），不进 ISR 页面；自己待审核的评论自己可见。滚动到评论区附近才加载，Markdown 渲染器按需加载
- 评论 Markdown 用比文章更严的白名单（`lib/comment-markdown.ts`）：不允许图片（追踪像素）和标题，链接加 `rel="nofollow ugc"`
- 发评论按评论者限流（10 分钟 10 条）；后台 `/admin/comments` 审核，导航栏显示待审核数

## 全文搜索（v4b）
- Postgres tsvector，分词在应用里做（`apps/api/src/lib/search-text.ts`，索引和查询共用）：Neon 没有中文分词扩展，内置分词器又不切中文
  - 中日韩文字切成单字 + 二元组，查询时二元组之间 AND（不用短语查询 `<->`：位置上限 16383，长文后半部分会悄悄搜不到）；其他文字按词切、前缀匹配；先 NFKC + 小写
  - 直接生成 tsvector / tsquery 字面量再 `::tsvector`，不用 `to_tsvector()`（避免本地和 Neon 的 locale 不同导致切词不一致）；用户输入只能变成带引号的词条，改变不了查询结构
- 每种语言一套索引：原文是这种语言的文章用 `posts.search_vector`（标题 A、标签 B、正文 D），其他文章用这种语言的译文 `post_translations.search_vector`（译文标题 A、不翻译的标签名 B、译文正文 D）。写入时生成，正文只索引前 3 万字（防止超过 tsvector 的 1MB 上限），各自有 GIN 部分索引；文章换标签、标签改名时一并重建用到它的原文和译文的索引（不改 `updated_at` / `translated_at`）
- `search_vector` 为 NULL 表示待生成（两张表都是）：`db:migrate` 跑完迁移后自动补齐。改了分词规则就用 `drizzle-kit generate --custom` 写一个迁移，**两张表都要清空**：`UPDATE posts SET search_vector = NULL; UPDATE post_translations SET search_vector = NULL;`（只清 posts 的话，译文仍按旧规则切词，而查询按新规则，其他语言的搜索会悄悄失效）
- `GET /search?q=&locale=`：locale 默认 zh，不在 `locales` 里的返回 400。原文和译文两路查询（各自走自己的 GIN 索引、各取前 20），在内存里按 `ts_rank`、发布时间、id 合并后取 20 条，不分页；返回高亮区间（UTF-16 下标），不返回 HTML；按 IP 限流
- 结果片段和列表摘要一样按语言取长度（`localeInfo.excerptLength`），截断不切开西文单词（`lib/word-boundary.ts`，摘要和片段共用；片段开头最多前进到第一处匹配、结尾不退到匹配之前）
- 前端 `/search` 是静态页，浏览器经 `/api/search` 请求（服务端渲染的话 API 看到的是 Vercel 函数的 IP，所有读者共用限流额度）；输入防抖 250ms，查询词同步到 `?q=`

## 渲染与缓存（v3）
- 前台页面是 ISR：构建时预生成，新 slug 首次访问时生成；数据请求带 `next: { revalidate: 3600, tags }`
- 缓存标签定义在 `@blog/shared` 的 `cacheTags`，按语言区分：列表类 `posts:<locale>`，单篇 `post:<slug>:<locale>`
- API 写入文章后（`tagsForChange`：只要写入前后有一边是已发布，所有语言都失效；保存 / 删除译文用 `tagsForTranslationChange`：只失效该语言，译文从无到有 / 从有到无时再加其他语言的文章页）调用前端 `POST /hooks/revalidate`（Bearer `REVALIDATE_SECRET`，两个项目共享），前端 `revalidateTag(tag, { expire: 0 })`
- 通知失败只记日志、不影响写入；一小时定时刷新兜底。`/hooks` 不能放在 `/api` 下（`/api/*` 整体代理给 API）

## 多语言（v4.5 框架；v5.5 大模型翻译）
- 落地方式（v4.5）：
  - 中文网址不加前缀：`next.config.ts` 的 rewrites（afterFiles）把不以 en / ja / admin / api / hooks / _next 开头的路径重写到 `/zh/…`（正则由 `lib/locale-routing.ts` 按 `locales` 生成）；访客直接请求的 `/zh`、`/zh/…` 由 redirects 308 到不带前缀的网址，中文只有一套网址（不能指望重写成 `/zh/zh/…` 后 404：Vercel 把预渲染页面当静态文件，在 rewrites 之前就匹配了，2026-10 线上实测 `/zh/about` 返回 200）。不用 proxy：rewrites 静态匹配，ISR 照常命中缓存
  - `[lang]` 不设 `dynamicParams = false`：Next 要求路径上每一段都允许按需生成，设了会让新 slug 也 404；不支持的语言由各页面的 `requireLocale()` 返回 404
  - 网址工具 `lib/i18n/paths.ts`（`localePath` / `stripLocale` / `switchLocalePath`）；`usePathname()` 服务端是 `/zh/about`、浏览器是 `/about`，两种都要认
  - 界面字典 `lib/i18n/dictionaries/{zh,en,ja}.ts`；客户端组件经 `LocaleProvider` + `useDictionary()` 取（函数不能作为 props 传给客户端组件）。前台不显示 API 返回的中文 message，错误按原因代码查字典
  - hreflang / canonical 是绝对网址，域名取前端环境变量 `SITE_URL`（默认 https://mikexzx-blog.vercel.app）；文章页只列真实存在的语言，x-default 指向原文；显示原文回退时 canonical 指向原文
  - 已知限制（Next 16.4）：`notFound()` 的 404 响应状态和 noindex 正确，但 HTML 是 Next 的恢复壳（`__next_error__`），本地化的 404 页面要等 JS 运行后才显示
  - 页面里夹着的另一种语言要标 `lang`（`lib/i18n/content-lang.ts`）：回退显示的原文标题和正文、不翻译的标签名（en / ja 页面里标 zh-CN，标在每个标签名上，不标在带界面文案的容器上）
  - og:locale 用 `localeInfo[…].ogLocale`（zh_CN / en_US / ja_JP），不由 BCP 47 标签推导；文章页的 openGraph 会整个替换布局的，要展开 `ogBase()` 保留 site_name
  - 后台：`/admin/posts/[id]/translations/[locale]` 手工编辑译文（PUT 整体保存：新建 201、替换 200；保存时带加载时的原文指纹）。后台的语言名用中文（英语 / 日语，`adminLocaleName`），语言自称只在前台的切换菜单里用
  - 译文没有草稿状态，所以保存前拦下"还是原文"的内容（`checkUntranslated`）：标题和正文都和原文相同（复制原文后顺手按了 ⌘S）拒绝保存；只有一项相同时要确认（产品名之类的标题可能本来就相同）。原文在编辑页打开后又被改过时，提示"载入最新原文"再对照保存
- 语言：中文（`zh`，原文，根路径不加前缀）、英文（`/en`）、日文（`/ja`）。语言列表集中定义在 `@blog/shared`（代码用 BCP 47 标签），加一种语言 = 在列表里加一项 + 补齐界面字典 + 必要时调整字体和分词，其余代码不写死具体语言
- 现有中文网址一个都不变；不按 Accept-Language 自动跳转（常猜错、干扰搜索引擎）。v4.5 只在导航栏提供切换语言菜单（`components/LanguageSwitcher.tsx`：Popover API，普通 `<a>` 整页跳转以切换 `<html lang>` 和字体；搜索页的 `?q=` 跟着带过去，其他查询参数不带）；按 Accept-Language 显示切换提示条以后再做
- 界面文案：自己实现的 TS 字典，类型保证每种语言的 key 齐全（缺翻译编译报错）；日期、数字用 `Intl` 按语言格式化
- `<html lang>` 必须随语言变化：中日共用汉字（Han unification），浏览器靠 lang 选字形；字体栈按语言调整顺序（ja 优先 Hiragino Sans / Noto Sans CJK JP，zh 优先 PingFang SC）
- 文章译文：`post_translations`（post_id, locale, title, content_md, excerpt, `source_hash` 生成时原文的指纹, `origin` machine | human, model, translated_at）；`posts` 本身就是原文，预留 `source_locale`（默认 zh）以便以后用别的语言写原文
  - 每种语言是独立的 ISR 页面（`/en/posts/<slug>`，slug 各语言相同），互相用 hreflang 标注；没有译文的文章不出现在该语言的列表里（避免重复内容），直接访问时显示原文并提示
  - 搜索按语言分别建索引（日文的假名、汉字已按中日韩二元组切分，英文按词）；缓存标签需要区分语言
  - 评论不分语言，所有语言版本共用同一组评论
- 原则：**内容准确优先于翻译完整**。宁可某种语言少一篇文章（不进列表、直接访问显示原文 + 提示），也不给读者看可能错误的译文：
  - 没有译文就显示原文，不做读者触发的即时翻译；结构校验不通过的机器译文不发布
  - 原文改过之后，译文页明确标注"原文已更新"并链接原文；后台标出过时的译文
- 自动翻译（v5.5）：在文章编辑页由作者手动点击"生成译文"调用 Claude API（发布时可以顺手生成，但不自动、不阻塞发布）
  - 只由作者的操作触发，读者和爬虫触发不了 LLM 调用，成本可控；不做 X 那种读者点了才翻译（会被刷额度、搜索引擎收录不到）
  - 生成结果先进编辑器给作者过目，保存后才对读者可见（与手工译文同一条保存路径，origin 记为 machine、记录 model）
  - 原文指纹变了：后台提示"原文已更新"，作者点"重新生成"；人工改过的译文不会被覆盖（重新生成前确认）
  - 保护 Markdown 结构：代码块、链接地址、图片地址不得改动，生成后校验（数量和地址与原文一致），不通过就不采用这次结果
  - 译文页标注"机器翻译"并链接原文；以后评论可做按需翻译（仅登录用户、限流）

## 设计规范（Apple HIG 的 Web 翻译）
- 样式只引用 design tokens（CSS 变量），不写死颜色、字号、间距
- 字体用系统字体栈：`-apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans", "Noto Sans CJK SC", sans-serif`（Apple 设备上英文即为 San Francisco）；`:lang(ja)` 换成日文优先的栈（Hiragino Sans、Hiragino Kaku Gothic ProN、Noto Sans CJK JP …），带 `lang` 属性的元素重新解析 `--font-family-text`（回退显示原文时正文用中文字形）；日文正文 `line-break: strict`、标题 `word-break: auto-phrase`。CJK 正文行高 1.6（参考 Newsroom 的约 1.45 与常规 1.7 之间）
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
- `posts`：slug, title, content_md, excerpt, status (draft | published), published_at, search_vector, source_locale（默认 zh）
- `post_translations`：(post_id, locale) 主键，title, content_md, excerpt, source_hash, origin（machine | human）, model, translated_at, search_vector；locale 只有格式 CHECK（加语言不需要迁移）；`db:migrate` 同样补齐 search_vector 为 NULL 的译文
- `tags` + `post_tags`
- `commenters`（GitHub 用户，trust：default | trusted | blocked）、`commenter_sessions`、`oauth_states`
- `comments`：post_id, commenter_id, root_id / parent_id（楼中楼）, body, status（pending | approved | rejected）
- `post_views`
- `images`：key, content_type, size, filename, width / height, variants, folder_id, description, confirmed_at（NULL 为待确认）；`media_folders`；`post_images`（由原文 + 所有译文的正文推导）

## 安全
- 管理员登录：只用 Passkey（WebAuthn），没有密码；协议验证用 SimpleWebAuthn，其余自己实现
  - session：随机 token，库里只存 SHA-256；cookie `__Host-session`（httpOnly、Secure、SameSite=Lax）；闲置 7 天 / 最长 30 天过期；登录总是签发新 session
  - CSRF：SameSite=Lax + 所有写请求校验 `Origin` 必须等于 `WEB_ORIGIN`
  - challenge 一次性、5 分钟过期（DELETE … RETURNING 原子取出）；要求用户验证（UV）与可发现凭证
  - 首次设置 / 全部设备丢失后的恢复：临时设置 `ADMIN_SETUP_TOKEN` 允许未登录注册 Passkey，用完立即删除；不能删除最后一个 Passkey
  - Passkey 绑定 RP ID（前端域名）：换域名需要重新注册
- 评论者：GitHub 登录（见"评论（v4c）"）
- 用户提交的 Markdown 渲染前必须 sanitize
- 写接口加限流

## 路线
- [x] v0 前台：tokens、布局、首页列表、文章页，使用本地假数据；部署上线（Vercel，Root Directory `apps/web`，push 到 main 自动部署：https://mikexzx-blog.vercel.app）
- [x] v1 API：Hono + Drizzle + Postgres，posts CRUD，zod 校验，Vitest（API 部署在 Vercel 第二个项目，Root Directory `apps/api`：https://mikexzx-blog-api.vercel.app；数据库 Neon us-east-1，迁移在本地用 `apps/api/.env.neon` 直连执行；前端项目设 `API_URL`）
- [x] v2 管理后台：登录、编辑器、草稿 / 发布、图片上传（图片存 Cloudflare R2）
- [x] v3 渲染与缓存：ISR；发布文章时由 API 通知前端 revalidate（两个 Vercel 项目共享 `REVALIDATE_SECRET`）
- [x] v4 评论（OAuth、楼中楼、审核）、阅读数（Redis）、全文搜索（Postgres tsvector）
  - [x] v4a 限流与阅读数（线上 Redis 用 Vercel Storage 里的 Upstash，API 项目设 `REDIS_URL`（rediss://）和 `CRON_SECRET`）
  - [x] v4b 全文搜索
  - [x] v4c 评论（API 项目设 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`）
- [x] v4.5 多语言框架（见"多语言"）：中英日，`/en` `/ja` 前缀、界面字典、hreflang、`<html lang>`、译文数据结构、后台手工编辑译文（上线前：前端项目设 `SITE_URL`）
  - 上线顺序（缓存标签改成按语言区分、前端的 schema 要求 API 返回 `locale` 等新字段，两个项目不能同时部署）：① Neon 执行迁移 0008（API 读 `posts.source_locale`，先部署 API 会全部报错）② 部署 API，确认 `GET /posts?locale=en` 的每项都带 `locale` ③ 再部署（或重新部署）前端——它构建时请求 API；如果前端的自动部署抢先跑了、预渲染时报 zod / bad response 错误，API 上线后重新部署即可。前后交替的一小时内旧前端的页面不会被新标签失效，靠一小时的定时刷新兜底
- [ ] v5 工程化：Docker 镜像、GitHub Actions、VPS + Caddy 部署、pino 日志、Sentry、Playwright（端到端测试一开始就覆盖多语言）
- [ ] v5.5 自动翻译：文章编辑页手动点击"生成译文"调用 Claude API（发布时可一并生成），作者过目后保存；结构校验，原文变更后提示重新生成
- [ ] v6 收款：**暂缓，方案待定**。Stripe 不可用：Stripe 日本不允许以个人名义接受捐赠。需要先确定收款场景（打赏 / 付费文章 / 订阅）和收款主体，再选服务；无论用哪家，支付本身交给托管支付页，订单状态、webhook 签名校验、幂等、对账自己实现
