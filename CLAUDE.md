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
- 限流：固定窗口（MULTI 里 INCR + PEXPIRE NX），规则集中在 `lib/rate-limit.ts` 的 `rules`；Redis 不可用时放行（fail-open），例外是 `failClosed` 的规则（大模型翻译：每放过一次都花钱，限流是唯一的额度上限）拒绝并回 503；键只存哈希，不存原始 IP
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

## 标签
- 集中管理：后台 `/admin/posts/tags`（"文章"栏目下的二级页面，不占顶部导航）新建、改名（名称 / slug）、合并、删除；编辑文章时只能从已有标签里选，不能顺手新建——避免意思重复的标签越积越多
- 文章的输入里 `tags` 是 slug 数组，引用不存在的标签返回 400（`tags.N` 路径），不会自动创建；取标签时 `FOR SHARE` 锁住，防止并发删除撞外键
- 名称不分大小写唯一（`lower(name)` 唯一索引），slug 唯一；唯一约束冲突按约束名给出具体提示（`lib/errors.ts` 的 `uniqueViolationMessages`）
- 标签所有语言共用（同一组 `post_tags`），名称按语言显示：`tags.name` 是原文语言（`tagSourceLocale`，即 zh）的名称，其他语言的译名在 `tag_translations`（每种语言一个，同一语言内不分大小写唯一）
  - 新建、编辑标签时每种语言的译名都必填（`tagTranslationsInputSchema`）；旧标签缺译名时前台显示原文名称，后台列表标出"缺英语、日语名称"，编辑时补上
  - 前台、各语言的搜索索引都用该语言的名称（`tagsByPostId(db, ids, locale)` / `localizedTagName`）；后台用原文名称
  - 编辑框里"用 <模型> 翻译"（模型是设置里的"标签翻译"，见"设置与状态页"）：`POST /admin/tags/translate`（`{ name, slug }`，翻译表单里此刻的名称，新建时也能用），一次调用给出所有语言的译名，只填进输入框、保存后才生效；站上已有的完整译名作参考，保持风格一致。结构化输出（`output_config.format` JSON Schema，effort low），**不用服务端回退**（文档没确认回退模型支持结构化输出；标签名几乎不会触发拒答）；结果仍用 zod 校验（截断、拒答时输出可能不符合 schema）。和文章翻译共用 `rules.translate` 限流额度
- 标签名在原文和译文的搜索索引里，也显示在每种语言的文章页上：改名、改译名、合并、删除后重建用到它的文章及其译文的索引（不改 `updated_at` / `translated_at`），并刷新这些已发布文章在每种语言下的页面和列表；缓存标签多于 50 个（`REVALIDATE_MAX_TAGS`）时 revalidate 分批发送
- 合并：用到 A 的文章改用 B（保持原位置），同时有 A、B 的只去掉 A，然后删除 A

## 内容浏览（v4.6）
- 标签页 `/tags/<slug>`（各语言 `/en/tags/<slug>`，slug 相同）和总览 `/tags`：ISR，数据与首页侧栏的标签统计同一份（`listTags`），缓存一起失效。某语言下这个标签没有可见文章时 404、也不出现在该语言的标签列表里（和"没有译文的文章不进该语言列表"一致）；hreflang 只列有文章的语言。文章页、侧栏的标签是链接，列表卡片里的不是（整张卡片已是链接，不嵌套交互元素）
- 列表翻页用"加载更多"（`PostFeed`，`GET /posts` 的游标），不做 `/page/2` 页码网址：页码内容随新文章整体错位，对读者和搜索引擎都不稳定；搜索引擎靠归档页和各标签页发现全部文章。第一页进 ISR 页面，之后由浏览器经 `/api/posts` 加载；加载后焦点移到第一篇新文章
- 归档 `/archive`：`GET /archive?locale=` 一次返回该语言全部文章的标题和发布时间，按年、月分组（站点时区）
- 筛选：`GET /posts` 和 `GET /search` 都接受 `tags`（逗号分隔，文章须同时带有全部标签，≤ 10 个）、`from` / `to`（`YYYY-MM`，两端都含，按站点时区 `SITE_TIME_ZONE` 算月份边界，`postFilterCondition`）。搜索页：有关键词时走搜索（相关度前 20），只有筛选条件时走列表（按时间、可加载更多）；条件同步到网址。组合条件只出现在不被收录的搜索页里，不生成可收录的组合网址。月份下拉框只列有文章的月份（从归档接口推出），不用 `<input type="month">`（Safari、Firefox 桌面版不支持）
- 头图：`posts.cover_image` 存媒体库图片的地址（和正文图片一样按 key 识别，只收媒体库图片），各语言共用，算作图片引用（`post_images`，删除要 force）。公开接口返回 `cover`（地址、媒体库里的描述作 alt、宽高、尺寸版本；图片被强制删除后为 null）。显示在文章页顶部（沿用正文"大"图的规则：出血 864、手机贴边，LCP 所以 `fetchpriority=high`）、列表卡片右侧缩略图（4:3 裁切，装饰性 alt 为空）、`og:image`（≥ 1200 的最小版本）+ `twitter:card=summary_large_image`。编辑器的"头图"用媒体选择器的只选图模式
- 改标签 slug 时，标签管理里提示旧的标签页网址会失效；不做跳转

## 设置与状态页
- 密钥、连接地址只放环境变量，不做进后台：数据库会进备份和导出，后台被攻破（XSS、session 泄露）时也能读出来；加密存库的话主密钥还得放环境变量；数据库地址这类本来就进不了数据库。后台只放不涉密、改了要马上生效的设置
- 运行时设置：`settings` 表（一个键一行，值是 jsonb），格式由 shared 的 `siteSettingsSchema` 逐键校验，读到不合法的值（比如模型下架了）用默认值（`settingsFromRows`）。`GET / PATCH /admin/settings`，每次请求读一次，不缓存
  - 翻译模型：`translationModels`（shared，2026-10 按官方文档核对：Haiku 5.5 / Sonnet 5.5 / Opus 5.5 / Fable 5.1，接受同一套请求参数，只有 Haiku 没有服务端回退）。文章翻译、标签翻译各选一个（`translationModel` / `tagTranslationModel`），默认都是 Sonnet 5.5（和加设置之前一样）。设置页选了就保存
  - 生成头图（见"生成头图"）：写画面描述的 Claude 模型、出图模型和画质（选了就保存）、头图风格（文本，按"保存"才存；没改过时用代码里的默认值，以后调整默认值自动跟上）
- 状态页 `/admin/settings/status`（`GET /admin/status`）：只报告"配了没有、能不能用"，不返回任何配置值；每项检查独立、5 秒超时，一项挂住不影响其他项
  - 数据库（`select 1`）、迁移（打包进来的 `drizzle/meta/_journal.json` 和库里 `drizzle.__drizzle_migrations` 比较，指出没执行的迁移）、Redis（PING）、图片存储（HEAD 一个不存在的对象：凭证对是 404）、Claude API（`GET /v1/models/{id}`，不花钱，检查设置里选的模型）、OpenAI（同样 `GET /v1/models/{id}`；列表里有模型不代表能出图，组织验证这类问题要第一次出图才知道）、GitHub（只看配置）、缓存失效通知（向前端 `/hooks/revalidate` 发空的标签列表，检查两边的 `REVALIDATE_SECRET` 是否一致）、CRON_SECRET
  - 定时任务：每次运行的结果记在 `job_runs`（每个任务一行，覆盖写，`recordJobRun`；失败时保留上次成功的时间），超过 26 小时没成功提示"注意"
  - 部署版本：前端（构建时的 `VERCEL_GIT_COMMIT_SHA`）和 API 的 `/health` 版本比较，不一致说明有一边还在部署或部署失败
  - 不自动轮询：每次检查都会连各个服务（包括 Anthropic）

## 生成头图
- 文章编辑器"头图"旁的"生成"（`CoverGenerator` 对话框），两步都由作者点按钮触发、可停止，结果只回给编辑器：
  1. 画面描述：Claude 读表单里此刻的标题、标签、正文（前 1.2 万字，`COVER_SOURCE_MAX_CHARS`）和作者可选的"方向"，按头图风格写一段英文画面描述 + 一句原文语言的图片描述（alt）。`POST /admin/covers/brief`，结构化输出、effort medium、不用服务端回退（同标签名），算在 `rules.translate` 的额度里。作者可以改描述，也可以不用 Claude 自己写
  2. 出图：OpenAI GPT Image（`openai` SDK，Image API）按"头图风格 + 画面描述"出一张 1536×864（16:9）的 WebP。`POST /admin/covers/generate` 返回 NDJSON 流：先等上游接受请求再开始流（内容审核拦下提示词 → 400，凭证 / 组织验证 → 502，上游限流 → 429，都还是普通 JSON 错误），之后 `partial`（`partial_images: 2` 的预览）、心跳 `ping`（`COVER_HEARTBEAT_MS`，和翻译共用 `nextWithHeartbeat`）、`done`（base64 图片 + 用量）或 `error`。出图可能一两分钟（文档），不流式的话代理等首字节可能超时
- 为什么不在 Claude 里出图：Claude 只输出文字（可以写 SVG，但只适合几何图形）；为什么还要 Claude 这一步：图像模型擅长"画出描述的东西"，不擅长读长文想视觉比喻，而且作者先看到要画什么，不满意时不花出图的钱
- 选中的那张由**浏览器**上传进媒体库（`uploadImage`，和手动上传同一条路：缩放、640 / 1280 版本、去元数据、预签名直传），alt 写进媒体库的描述，再设为头图（仍要保存文章才生效）。没选中的不进存储；API 不处理图片字节，也不用在服务端生成尺寸版本
- 头图风格（设置，英文）：默认参考 YouTube 缩略图——一个大而清楚的主体、强对比、构图简单、重要内容在中间 3/4（列表卡片按 4:3 裁切）、图形化而非照片。**文字默认不放**，最多 1–3 个各语言都一样的短词（产品名、代码关键字、数字），绝不放中文、日文：头图三种语言共用（英文、日文页面和分享卡片是同一张图），而且图像模型仍会写错汉字
- 模型：`coverImageModels`（shared 的 `cover-options.ts`，2026-10 按 OpenAI 文档和 SDK 类型核对：GPT Image 2.5 Flare（默认）/ Sunburst，token 单价相同：图像输出每百万 $30）；画质 low / medium（默认）/ high。每张图的 token 数没有公开表格，用量每次记日志、也显示在结果下面
- 限流 `rules.coverImage`：按用户每小时 30 张，fail-closed；校验通过后、调用 OpenAI 前才计数。SDK 最多重试 1 次（一次出图就要一两分钟，默认 2 次可能超过函数时长）
- 环境变量 `OPENAI_API_KEY`（API 项目，可选），同样需要 `REDIS_URL`；缺了 `GET /admin/covers/config` 报 `not_configured`、生成接口 503。两步互不依赖（只有 Anthropic 时可以写描述、只有 OpenAI 时可以自己写描述出图）。测试经 `createApp({ coverBriefWriter, coverImager })` 注入假实现，绝不调用真 API
- 中止：OpenAI 的 SDK 把中止当成流正常结束（不抛错，和 Anthropic 的 SDK 不同），路由按 signal 判断是中止、不写 error

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
- Next 的 fetch 数据缓存在部署之间是保留的：API 响应加了必填字段后，新部署会读到旧形状的缓存而校验失败。所以 `apiGet` 的请求头带 `x-cache-version`（Vercel 的部署编号），成为缓存键的一部分，每次部署从干净的缓存开始；本地每次启动换一个
- 两个 Vercel 项目由同一次推送同时触发：前端构建若早于新 API 上线，会按新 schema 预渲染旧 API 而失败（重新部署前端即可）。API 的 `/health` 返回部署的提交号（`version`），可以确认线上 API 已更新。根治要按顺序部署（先 API 后前端），放在 v5

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
- 大模型翻译（v5.5）：译文编辑页由作者手动点击"用 <模型> 生成译文"调用 Claude API，结果先进编辑器给作者过目，**保存后才对读者可见**（与手工译文同一条 PUT 保存路径）
  - 只由作者的操作触发，读者和爬虫触发不了 LLM 调用，成本可控；不做 X 那种读者点了才翻译（会被刷额度、搜索引擎收录不到）。不在发布时自动生成
  - 模型在后台"设置"里选（文章、标签各一个，默认都是 Sonnet 5.5，见"设置与状态页"）；官方 SDK `@anthropic-ai/sdk`，`client.beta.messages.stream`：自适应思考、effort high（准确优先，标题和正文同一个值，否则缓存失效；各模型默认值不同，所以显式写出）、不发采样参数；有服务端回退的模型开启回退（`fallbacks: "default"`，Haiku 5.5 没有、不发），记录的 `model` 是实际服务的模型；SDK 默认重试 2 次
  - 编辑器在开始生成时定下模型（页面打开时读到的配置），标题和每一段的请求都带同一个 `model`：提示缓存按模型分开，生成中途有人改了设置也不换
  - 环境变量 `ANTHROPIC_API_KEY`（API 项目，可选），且必须同时有 `REDIS_URL`：缺任何一个时 `GET /admin/translation/config` 返回 `available: false, reason: "not_configured"`、生成接口 503；配置齐了但 Redis 此刻连不上（PING 失败）时返回 `reason: "rate_limiter_unavailable"`（生成会因限流 fail-closed 而 503）。config 的形状是 shared 的 `translationConfigSchema`（按 available 区分的联合类型），编辑器按 reason 显示说明（`unavailableReasonNotes`），按钮禁用，其他功能照常（没有 Redis 就限不了流，`createApp` 不启用翻译并在启动时警告）。测试经 `createApp({ translator })` 注入假实现（同时要 `withRedis`），绝不调用真 API
  - **分段**：正文最长 20 万字，一次输出可能超过输出上限，也远超函数的最长执行时间。所以按 Markdown 顶层块切成 ≤ 6000 字的段（`splitMarkdownForTranslation`，`@blog/shared`，前后端同一个纯函数、段数一致；不切开代码块 / 表格 / 列表 / 引用，单块超长单独成段，段不以标题结尾，`join("")` 等于原文），**浏览器逐段请求**，每段一次 API 调用、一次函数调用。标题单独一次非流式请求（`max_tokens` 4000：思考也计入），正文段流式（`max_tokens` 64000）
  - **提示缓存**：每个请求的前缀都是"稳定的系统提示（只依赖语言对，不含日期、id）+ 整篇原文"，`cache_control` 打在整篇原文那个块上，"翻译第 i 段"的指令在它后面——标题先写缓存，各段读缓存，模型看得到全文、术语前后一致。编辑器一次只发一个请求（并行会全部错过缓存）
  - 原生 App 不自己切分（没有 remark，换个解析器块边界可能不同、段号悄悄错位）：`GET /admin/posts/:id/translation-plan` 返回 `{ sourceHash, segments }`，按段数逐段请求
  - 接口 `POST /admin/posts/:id/translations/:locale/generate`（body `{ part: "title" | "body", index?, sourceHash }`）：原文指纹对不上 409（段号会错位）、段号越界 400、原文语言 400；草稿也能生成。标题返回 JSON；正文返回 NDJSON 流（`delta` … 以 `done` 或 `error` 结束，事件 schema 在 shared；`done.model` 和标题的 `model` 经 `fitModelName` 收进 100 字，编辑器合并多个模型用 `combineModelNames`，超长时保留放得下的几个再加 ", …"（第一个名字就放不下时截断它腾出位置，"还有别的模型"的标记不丢），保证保存时 `generated.model` 合法）。先等上游接受请求再开始流：凭证无效（→ 502，不泄露上游信息）、上游限流（→ 429）仍是普通 JSON 错误；流开始后的错误写成 `error` 事件（SDK 在流中途抛的 APIError 没有 status，按 `error.type` 分类：overloaded / api_error → "暂时不可用"）。`done.text` 已对齐首尾空行（`fitTranslatedSegment`，shared，编辑器拼接时用同一个函数、幂等；只认空格 / 制表符 / 换行，全角空格是内容），各段直接拼接即正文；只有 `stopReason = end_turn` 算成功（拒答、截断都是失败）。浏览器断开或点"停止"时中止上游请求
  - 限流：通用写操作限流之外加 `rules.translate`（按用户每小时 120 次，标题和每段各算一次），**fail-closed**：Redis 出故障时翻译请求 503，其他写操作照常。它在处理函数里、所有校验（400 / 404 / 409、段号越界）通过之后、调用模型之前才计数（`checkRateLimit`）：被拒的请求不占付费调用的额度。上线前另在 Anthropic Console 设每月花费上限兜底
  - 用量（文章、语言、段、模型、token、是否回退）每次调用记一行日志，不入库。服务端回退时顶层 usage 只是最后那次尝试的，拒答前已输出的部分也计费，所以按 `usage.iterations` 里的 message / fallback_message 逐项相加（`usageFrom`）
  - **心跳**：模型在第一段译文之前先思考，可能几十秒没有字节。流里没有别的输出时每 10 秒（`TRANSLATION_HEARTBEAT_MS`）写一行 `{"type":"ping"}`，每个事件后重新计时；编辑器不把它当内容，当前段还没收到文字时据此显示"（模型思考中…）"。只有心跳、没有 `done` 的流仍按"连接中断"处理。标题是非流式 JSON，没有心跳（输出很短）
  - 函数时长与代理（2026-10 查证；Vercel 文档搜索工具只返回了配置示例，没有返回时限表格；下面除了标明"本地已确认"的，都来自既有知识，**未在文档里核实**）：
    - `apps/api/vercel.json` **不设** `functions` / `maxDuration`：`functions` 里的模式匹配不到任何函数时构建直接失败（API 的入口由构建产物决定，写错就部署不了），而且假设开启 Fluid compute 时默认时长已经是计划允许的上限（Hobby 300 秒）——这一点**未核实**，首次部署后在函数详情里确认 Max Duration
    - 每段 ≤ 约 6000 字的切分就是按这个时长定的：一段的译文（含思考）预计远在时限内生成完；真不够时调小 `TRANSLATION_SEGMENT_MAX_CHARS`（shared），而不是加长时限
    - 浏览器经前端项目的 `/api` rewrite 访问 API：Next 的外部 rewrite 在 Vercel 上由边缘代理转发，响应按流转发（不缓冲整个响应），我们的响应带 `Cache-Control: no-store`，外部 rewrite 的缓存（需 `CDN-Cache-Control` / `x-vercel-enable-rewrite-caching`）不会生效。代理等上游首字节和空闲连接都有时限（印象中首字节约 120 秒，未核实）：生成接口先等上游接受请求再开始响应（几秒内出首字节），之后有心跳（覆盖模型思考期间代理等字节的时限），不会长时间静默。每段的总时长受 API 函数的默认最长时长约束（见上）
  - **结构校验**（`checkTranslationStructure`，shared）：errors——代码块（数量、顺序、语言、内容）、图片地址（含 `#small` 片段）、链接地址、HTML、脚注标识符必须与原文一致；warnings——标题数量 / 层级、行内代码、表格数、列表项数、段落数相差较大、译文把原文里没被识别的网址变成了链接，只提醒不拦截。生成完成后编辑器显示结果和 token 用量（含缓存命中）
    - 链接的目标：**译文页面的读者拿到的链接，正好是作者想给的那些**。比较 remark-parse + remark-gfm（和前台同一套）解析出的每个 `link` 节点——`[文字](地址)`、`<地址>`、引用式链接（地址取自定义；没被引用的定义不算）、GFM 的字面自动链接（裸网址、www.、邮箱，用 GFM 自己算出的 url）——加上每个图片的地址，按多重集合比较。链接文字不比较（要翻译）；裸网址改写成指向同一地址的显式链接不算改动；放进行内代码、或 GFM 不再识别（"詳しくはwww.a.comを…"）就是少了一个链接，报错
    - **两边的规则不对称**：
      - 原文：只有 GFM 的字面自动链接（节点在原文里的第一个字符不是 `[` 也不是 `<`；没有位置信息的链接节点也算——前面有没配对的 "[" 时 GFM 走文本二次扫描生成链接，不带 position）用 `canonicalLinkUrl` 还原作者想要的地址。GFM 的裸网址一直延伸到空白，"详见“https://a.b/c”。" 解析出 `https://a.b/c”。`，作者显然想链接 `https://a.b/c`：反复去掉末尾的非 ASCII 标点 / 符号 / 分隔符（” 」 ） 。 、 —— …… NBSP…）、ASCII 的 ?!.,:;*_~'" 和具名字符引用（`&nbsp;`）、不配对的 ) ]；非 ASCII 的字母 / 数字 / 附加符号保留（路径里 汉字 和 漢字 不同）。从尾部按下标扫描，线性时间。显式链接、`<地址>`、引用式链接、图片是作者亲手写的地址，原样采用
      - 译文：每个链接、图片的地址都**按渲染结果原样采用**，一个字符都不去掉。"詳しくは https://a.b/c。" 渲染出的是 `https://a.b/c%E3%80%82`，读者点开是错的地址，报错；"See https://a.b/c”." 、显式链接 / 图片地址末尾多了或少了字符同样报错
      - 理由：两边都去掉末尾标点（之前的做法）会放过上面这种给读者坏链接的译文；两边都不去掉，原文里最常见的"网址。"写法会让每篇忠实的译文都报错。代价：作者真想链接以这些标点结尾的地址时，要在原文里写成显式链接或 `<地址>`；原文里标点后面紧跟文字时（"https://a.b/c。后面"）GFM 把文字也算进链接，去不掉、和译文对不上而报错——这在原文里本来就是个坏链接，在网址后加空格或写成 `<地址>` 即可。系统提示相应要求模型原样抄写网址，裸网址后面紧跟标点或文字时写成 `<地址>` 或在后面加空格
    - 比较的是读者浏览器拿到的**编码形式**：两边的地址都经过渲染器（mdast-util-to-hast）用的同一个 `normalizeUri`（`micromark-util-sanitize-uri`，shared 的依赖），所以 `<https://a.b/a b>` 和 `a%20b`、`汉字` 和 `%E6%B1%89%E5%AD%97` 相同（`%e6` 和 `%E6` 仍算不同）；detail 里显示 Markdown 里写的样子，不显示一串 %E6…
    - 译文多出的链接是错误，例外：原文正文（链接文字、行内代码之外）里有一串像网址、GFM 却没识别成链接的文字（"访问www.example.com，然后"——www 前面紧跟汉字），译文 "Visit www.example.com, then" 把它变成了链接，只给 warning（`link_linkified`）。候选地址从 http:// https:// www. 或邮箱起，截到第一个非 ASCII 字符为止；只有主机名后面已经出现过 / ? #（进入了路径）时，才再加上截到第一个非 ASCII 标点、截到空白为止（后者还要求结尾是 ASCII 或标点）的候选——"www.a.com即可" 里的"即可"是粘进来的正文，译文照抄会得到坏链接，必须报错而不是提醒。去掉末尾标点；一遍扫描，线性时间
    - 已知的库限制：micromark 的 GFM 扩展在某些病态输入上是超线性的（连续的 `]` 最糟：5 万个约 4.7 秒、网址后面跟 20 万个约 110 秒；网址后面跟 20 万个 `_` 约 35 秒；约平方增长，不开 GFM 只要几毫秒）。前台渲染和保存时的结构校验都用这套解析器，都会受影响；因为正文只有作者能写，不做额外防护（评论也走 GFM，但上限 5000 字，最坏约 80 毫秒）
  - **origin 判定**：编辑器记下生成完成时的标题、正文和模型；保存时两者与之完全相同才带 `generated: { model }` → 存 `origin = machine`，服务端再跑一次结构校验，有 errors 就 400 不保存（"结构校验不通过的机器译文不发布"）；改过任何一个字 → 不带 → `human`、model 为空，不拦截。机器译文的 `sourceHash` 必须是当前原文的（否则 409，编辑器提示载入最新原文后重新生成：对着新原文校验旧原文的译文会冤枉它）；人工译文按旧原文保存照常（显示为过时）。编辑器加载的原文换了版本，旧的生成结果也不再算机器译文
  - 编辑器（`TranslationGenerator` + `useTranslationGeneration`，流程在 `lib/translation-generation.ts`）：生成期间表单值不变，标题 / 正文框只读显示进度，全部成功才替换（停止或失败无需恢复，半篇译文存不进去）；生成中禁止保存 / ⌘S / 删除 / 复制原文 / 载入原文 / 插入图片，离开页面要确认并中止；已有内容时先确认（人工译文特别提示）；失败后重试从失败的段继续（同一版原文），重试和生成走同一道关口（`decideGenerateStart`：图片上传中不开始，失败后编辑器内容改过就再确认）；生成 / 停止是同一个按钮，开始后 500ms 内的"停止"忽略（防双击），离开页面的中止不受此限；生成结果超出保存长度上限（`TRANSLATION_*_MAX_LENGTH`，shared）时在结果里列出
  - 原文指纹变了：后台提示"原文已更新"，作者重新生成；人工译文不会被自动覆盖
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
- 按钮（`components/ui/Button`）"平但有质感"：纯色填充、圆角 8、一层紧贴的接触阴影（`--shadow-button`），不用渐变和大阴影；次按钮白底 + 浅灰描边；悬停只把底色调深，按下去掉阴影；焦点环用 outline（box-shadow 会顶掉阴影）；深色模式改用稍亮的表面色 + 淡白描边 + 顶部淡高光。按钮组和上方内容之间 12–16（容器有统一 gap 时跟随 gap，不再给按钮额外加 margin）
- 圆角用 G2 连续曲线：`globals.css` 在 `@supports (corner-shape: squircle)` 里给所有元素 `corner-shape: squircle`，并把圆角 token 放大 1.8 倍（`--corner-scale`，超椭圆同样半径看起来更尖）；不支持的浏览器（2026-10：Safari、Firefox 只在预览版）照旧画圆弧。正圆（头像）、胶囊写 `corner-shape: round` 覆盖
- 动效用 spring 曲线，尊重 `prefers-reduced-motion`
- 可点击区域 ≥ 44×44px，焦点样式可见，语义化 HTML，对比度达标

## 数据模型（初稿）
- `users`（单管理员）、`passkeys`、`sessions`、`auth_challenges`、`app_auth_codes`（原生 App 登录的一次性授权码）
- `posts`：slug, title, content_md, excerpt, status (draft | published), published_at, search_vector, source_locale（默认 zh）, cover_image（头图地址）
- `post_translations`：(post_id, locale) 主键，title, content_md, excerpt, source_hash, origin（machine | human）, model, translated_at, search_vector；locale 只有格式 CHECK（加语言不需要迁移）；`db:migrate` 同样补齐 search_vector 为 NULL 的译文
- `tags`（slug、name 均唯一，name 不分大小写）+ `tag_translations`（(tag_id, locale) 主键，name；同一语言内 name 不分大小写唯一）+ `post_tags`（position 为文章内顺序）
- `commenters`（GitHub 用户，trust：default | trusted | blocked）、`commenter_sessions`、`oauth_states`
- `comments`：post_id, commenter_id, root_id / parent_id（楼中楼）, body, status（pending | approved | rejected）
- `post_views`
- `settings`（key, value jsonb：后台的运行时设置）、`job_runs`（每个定时任务最近一次的结果）
- `images`：key, content_type, size, filename, width / height, variants, folder_id, description, confirmed_at（NULL 为待确认）；`media_folders`；`post_images`（由原文 + 所有译文的正文推导）

## 安全
- 管理员登录：只用 Passkey（WebAuthn），没有密码；协议验证用 SimpleWebAuthn，其余自己实现
  - session：随机 token，库里只存 SHA-256；cookie `__Host-session`（httpOnly、Secure、SameSite=Lax）；闲置 7 天 / 最长 30 天过期；登录总是签发新 session
  - CSRF：SameSite=Lax + 所有写请求校验 `Origin` 必须等于 `WEB_ORIGIN`
  - challenge 一次性、5 分钟过期（DELETE … RETURNING 原子取出）；要求用户验证（UV）与可发现凭证
  - 首次设置 / 全部设备丢失后的恢复：临时设置 `ADMIN_SETUP_TOKEN` 允许未登录注册 Passkey，用完立即删除；不能删除最后一个 Passkey
  - Passkey 绑定 RP ID（前端域名）：换域名需要重新注册
- 原生 App（`mikexxz-blog-apple` 仓库）登录后台：RFC 8252 的浏览器授权，不在 App 里直接用 Passkey（那要配 Associated Domains：网站放 apple-app-site-association、App 带开发者团队签名）
  - App 生成 PKCE verifier，在 ASWebAuthenticationSession 里打开 `/admin/authorize-app?challenge&state&device&redirect_uri`（在 (panel) 里，没登录先走 Passkey 登录）；管理员点"允许"才 `POST /auth/app/codes` 发一次性授权码（库里只存哈希，2 分钟，`app_auth_codes`），跳回 `mikexxz-blog://auth/callback`（`APP_AUTH_REDIRECT_URI`，只接受这一个）
  - 不能打开就自动发码：授权网址谁都能构造，别人在自己设备上注册同名网址协议、把网址发给你，你一点开授权码就到了他手里
  - App 用授权码 + verifier 换 token（`POST /auth/app/token`，猜错一次授权码就作废），token 就是一个普通 session（同样的闲置 7 天 / 最长 30 天），放在 `Authorization: Bearer` 里；带了 Bearer 头就只认它，不看 cookie。退出用 `/auth/logout`
  - CSRF：只带 Bearer、不带 cookie 的请求，以及换 token 的请求，不检查 Origin（不靠 cookie 就没有 CSRF；浏览器跨站发不出 Authorization 头）。带 cookie 的请求照常检查
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
- [x] CI（v5 里最小的一块，提前做）：GitHub Actions 在每次推送 main 和每个 PR 上跑 lint、类型检查、全部测试（`.github/workflows/ci.yml`，服务用和本地相同的 docker compose 起）
- [x] v4.6 内容浏览（见"内容浏览（v4.6）"）：
  - 标签页 `/tags/<slug>`（各语言版本、hreflang；某语言下没有可见文章时 404，也不出现在该语言的标签列表里）与 `/tags` 总览；文章页、侧栏的标签改成链接
  - 头图：文章可选一张媒体库图片，用于文章页顶部、列表卡片、`og:image`
  - 归档页 `/archive`：按年、月分组的全部文章
  - 搜索页筛选：多个标签、时间范围，可以不输入关键词只按条件浏览（组合条件只放在不被收录的搜索页里，不生成可收录的组合网址）
  - 分页：列表类页面（首页、标签页）翻页
  - 改标签 slug 时提示"旧网址会失效"，不做跳转
  - 做完先停下讨论，再做 v5 的其余部分
- [x] 设置与状态页（见"设置与状态页"）：后台选择翻译模型（文章、标签各一个），系统状态页（上线前：Neon 执行迁移 0012，再部署 API）
- [x] 生成头图（见"生成头图"）：Claude 写画面描述，OpenAI GPT Image 出图，作者挑一张进媒体库（不需要迁移：新设置是 settings 表里的新键。上线前：API 项目设 `OPENAI_API_KEY`；OpenAI 后台设每月花费上限，GPT Image 可能要求先完成组织验证；状态页多了 `openai` 一项，原生 App 若严格解码检查 id 要跟着加）
- [ ] v5 工程化：Docker 镜像、VPS + Caddy 部署、pino 日志、Sentry、Playwright（端到端测试一开始就覆盖多语言）、按顺序部署（先 API、迁移，后前端）
- [x] v5.5 大模型翻译（见"多语言"）：译文编辑页手动点击生成（Sonnet 5.5，分段流式、提示缓存），作者过目后保存；结构校验，未修改的机器译文记为 machine（上线前：API 项目设 `ANTHROPIC_API_KEY`（还要有 `REDIS_URL`），没设之前生成按钮是禁用的；Anthropic Console 设每月花费上限；首次部署后在函数详情里确认默认 Max Duration 是 300 秒（未核实的假设，见"函数时长与代理"）、长段落经 `/api` 代理不被掐断）
- [x] 原生 App（独立仓库 `mikexxz-blog-apple`，SwiftUI，iPhone / iPad / Mac）：前台阅读 + 后台管理。后台登录走浏览器授权（见"安全"）。上线前：Neon 执行迁移 0013（`app_auth_codes`），先部署 API（`/auth/app/*`、Bearer、`translation-plan`），再部署前端（`/admin/authorize-app`）
- [ ] v6 收款：**暂缓，方案待定**。Stripe 不可用：Stripe 日本不允许以个人名义接受捐赠。需要先确定收款场景（打赏 / 付费文章 / 订阅）和收款主体，再选服务；无论用哪家，支付本身交给托管支付页，订单状态、webhook 签名校验、幂等、对账自己实现
