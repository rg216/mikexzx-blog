import type { Nodes, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { normalizeUri } from "micromark-util-sanitize-uri";
import { unified } from "unified";
import { z } from "zod";
import { apiErrorCodeSchema, sourceHashSchema, TRANSLATION_MODEL_MAX_LENGTH } from "./post.ts";

/*
 * 大模型翻译（v5.5）前后端共用的部分：分段、结构校验、生成接口的输入输出。
 *
 * 为什么分段：正文最长 20 万字，一次输出可能超过模型的输出上限，也远超 Vercel 函数的最长执行时间。
 * 所以按 Markdown 块边界把原文切成若干段，浏览器逐段请求，每段一次 API 调用；各段请求共享"整篇原文"的
 * 提示缓存前缀，模型看得到全文（术语前后一致），成本也低。
 * 切分是纯函数、确定性的，放在这里让前后端用同一个函数，算出相同的段数和内容。
 *
 * 解析器和 apps/api、apps/web 一样用 remark-parse + remark-gfm（GFM：表格、脚注、自动链接…）。
 */

// 懒创建：模块顶层不调用任何函数，配合 package.json 的 "sideEffects": false，
// 只用到 locale、post 等 schema 的前台页面打包时会整个丢掉本模块和 remark，不增加前台 JS 体积。
function createProcessor() {
  return unified().use(remarkParse).use(remarkGfm);
}
let processor: ReturnType<typeof createProcessor> | undefined;

function parseMarkdown(markdown: string): Root {
  processor ??= createProcessor();
  return processor.parse(markdown);
}

// ---------- 分段 ----------

/** 每段的目标长度（UTF-16 码元，汉字一个算一个）：一段的译文一次请求能在函数时限内生成完 */
export const TRANSLATION_SEGMENT_MAX_CHARS = 6000;

type Block = { text: string; isHeading: boolean };

/**
 * 把正文切成顶层块（段落、标题、整个列表、整个表格、整个引用块、整个代码块…），每块是原文的一段子串：
 * 第一块从 0 开始（开头的空白归它），每块到下一块的开始为止（块之间的空白归前一块），最后一块到结尾。
 * 所以把所有块拼起来就是原文，一个字符都不多不少。
 */
function topLevelBlocks(markdown: string): Block[] {
  const { children } = parseMarkdown(markdown);
  // micromark 会去掉开头的 BOM，位置从 BOM 之后算起，切原文时要补回来
  const shift = markdown.startsWith("\uFEFF") ? 1 : 0;
  const starts = children.map((node) => {
    const offset = node.position?.start.offset;
    if (offset === undefined) throw new Error("Markdown 解析结果缺少位置信息");
    return offset + shift;
  });
  return children.map((node, i) => ({
    text: markdown.slice(i === 0 ? 0 : starts[i], starts[i + 1] ?? markdown.length),
    isHeading: node.type === "heading",
  }));
}

function joinBlocks(blocks: readonly Block[]): string {
  return blocks.map((block) => block.text).join("");
}

/**
 * 按 Markdown 块边界把正文切成若干段，每段不超过 maxChars；`segments.join("") === markdown`。
 *
 * - 只在顶层块之间切：代码块、表格、列表、引用块永远不会被切开；单个块超长就单独成一段（可以超过 maxChars）。
 * - 贪心装箱：块按顺序放进当前段，放不下就开新段。
 * - 标题不留在段尾：要开新段时，当前段末尾的标题挪到新段，和它下面的内容在一起（新段因此可能略超 maxChars）。
 *   所以超过 maxChars 的段只可能是"若干标题 + 一个块"。
 * - 空正文（没有任何块，包括只有空白）返回 []：没有需要翻译的内容。
 */
export function splitMarkdownForTranslation(markdown: string, maxChars: number = TRANSLATION_SEGMENT_MAX_CHARS): string[] {
  const segments: string[] = [];
  let current: Block[] = [];
  let size = 0;
  for (const block of topLevelBlocks(markdown)) {
    // 当前段只有标题时不开新段：标题总是和它下面的内容在一起
    if (current.some((b) => !b.isHeading) && size + block.text.length > maxChars) {
      const carried: Block[] = [];
      while (current.at(-1)?.isHeading) carried.unshift(current.pop() as Block);
      segments.push(joinBlocks(current));
      current = carried;
      size = joinBlocks(carried).length;
    }
    current.push(block);
    size += block.text.length;
  }
  if (current.length > 0) segments.push(joinBlocks(current));
  return segments;
}

// ---------- 拼接 ----------

/*
 * 首尾空白按下标逐个字符扫描，不用正则：/[ \t\r\n]*$/ 这种不锚定开头的正则会从每个空白字符起各试一遍，
 * 中间夹着一长串空白时是平方复杂度（10 万个空格约 9 秒），而译文来自模型输出，长度不由我们控制。
 * 只认 Markdown 意义上的空白（空格、制表符、换行）；全角空格（U+3000）、NBSP 之类是内容，不能动。
 */
const isBlank = (ch: string) => ch === " " || ch === "\t" || ch === "\r" || ch === "\n";

/** 末尾空白（空格、制表符、换行）开始的位置 */
function trailingBlankStart(text: string): number {
  let end = text.length;
  while (end > 0 && isBlank(text.charAt(end - 1))) end -= 1;
  return end;
}

/** 开头的整行空行（只含空格、制表符，以换行结束）结束的位置；最后一行行首的缩进不算：它可能属于缩进代码块 */
function leadingBlankLinesEnd(text: string): number {
  let end = 0;
  let i = 0;
  for (;;) {
    while (text.charAt(i) === " " || text.charAt(i) === "\t") i += 1;
    if (text.charAt(i) === "\n") i += 1;
    else if (text.charAt(i) === "\r" && text.charAt(i + 1) === "\n") i += 2;
    else return end;
    end = i;
  }
}

/**
 * 让一段译文的首尾空行和原文那一段一致，各段译文直接 join("") 就是完整正文（API 和编辑器共用这一个函数）。
 *
 * 原文段的结尾带着块之间的空行（如 "\n\n"），模型的输出通常没有：直接拼接会让两个块连在一起
 * （段落后面紧跟缩进代码会变成段落的续行）。所以去掉译文末尾的空白、换成原文段末尾的空白；
 * 开头只处理整行的空行——行首的空格可能是缩进代码块的一部分，不能动。
 * 幂等：对已经对齐过的译文再对齐一次，结果不变（API 对齐后编辑器拼接时会再用一次）。
 */
export function fitTranslatedSegment(sourceSegment: string, translated: string): string {
  const sourceLead = sourceSegment.slice(0, leadingBlankLinesEnd(sourceSegment));
  const sourceTrail = sourceSegment.slice(trailingBlankStart(sourceSegment));
  const rest = translated.slice(leadingBlankLinesEnd(translated));
  const core = rest.slice(0, trailingBlankStart(rest));
  return `${sourceLead}${core}${sourceTrail}`;
}

// ---------- 结构校验 ----------

/*
 * 机器译文必须保住原文的"不可翻译部分"。用 mdast 比较原文和译文：
 * - errors：代码、图片地址、链接地址、HTML、脚注被改动——译文不能以机器译文（origin = machine）保存；
 * - warnings：标题、行内代码、表格、列表、段落的数量对不上——可能是漏译或合并了段落；译文把原文里没被识别成链接的网址
 *   变成了链接（link_linkified）。提醒作者看一眼，不阻止保存。
 * 地址和 HTML 按多重集合比较（不管顺序）：译文的语序可以和原文不同，同一个链接出现几次也要对得上。
 * 代码块按顺序逐个比较：代码块是块级的，翻译不会改变它们的先后。
 */

export const structureErrorKinds = [
  "code_block_count",
  "code_block_changed",
  "image_missing",
  "image_extra",
  "link_missing",
  "link_extra",
  "html_missing",
  "html_extra",
  "footnote_missing",
  "footnote_extra",
] as const;

export const structureWarningKinds = [
  "link_linkified",
  "heading_mismatch",
  "inline_code_missing",
  "inline_code_extra",
  "table_count",
  "list_item_count",
  "paragraph_count",
] as const;

export type StructureIssueKind = (typeof structureErrorKinds)[number] | (typeof structureWarningKinds)[number];

export type StructureIssue = {
  kind: StructureIssueKind;
  /** 中文说明，后台显示 */
  message: string;
  /** 具体是哪个地址 / 第几个代码块 / 哪段 HTML */
  detail?: string;
};

export type StructureCheckResult = { errors: StructureIssue[]; warnings: StructureIssue[] };

/** 段落数之差超过 max(这个数, 原文段落数 × 比例) 才提醒：译文合并或拆开一两个段落很正常 */
const PARAGRAPH_DIFF_MIN = 2;
const PARAGRAPH_DIFF_RATIO = 0.2;

/** detail 里的 HTML、代码等最多显示这么多字符 */
const DETAIL_MAX_LENGTH = 80;

/**
 * 一个链接 / 图片地址。key 是比较用的形式（读者浏览器拿到的编码形式，见 normalizeUri）；
 * display 是写在 Markdown 里的样子（原文的裸网址是去掉末尾标点之后的），用在 detail 里给作者看，比一串 %E6… 好认。
 */
type LinkTarget = { key: string; display: string };

/** 原文还是译文：两边取地址的规则不同，见上面"两边的规则不对称" */
type Side = "source" | "translation";

type Structure = {
  codeBlocks: { lang: string | null; value: string }[];
  /** 图片地址（#small 等片段保留） */
  images: LinkTarget[];
  /** 读者拿到的每一个链接的地址，见 collectStructure */
  links: LinkTarget[];
  /** 正文里像网址、GFM 却没有识别成链接的文字（normalizeUri 后），见 unlinkedUrlCandidates */
  unlinkedUrls: Set<string>;
  html: string[];
  /** 脚注引用记作 `[^id]`，定义记作 `[^id]:` */
  footnotes: string[];
  headings: number[];
  inlineCode: string[];
  tables: number;
  listItems: number;
  paragraphs: number;
};

/*
 * 链接怎么比较：目标是译文页面的读者拿到的链接，正好是作者想给的那些。
 * 用 remark-parse + remark-gfm（和前台渲染同一套）解析出的 link 节点：[文字](地址)、<地址>、引用式链接（地址取自定义），
 * 以及 GFM 的字面自动链接（裸网址、www.、邮箱；url 用 GFM 自己算出的，www. 补成 http://，邮箱补成 mailto:），
 * 再加上每个图片的地址。链接文字不比较（它要翻译）；裸网址写成 [文字](同一地址) 或反过来不算改动。
 *
 * 两边的规则不对称：
 * - 原文：只有 GFM 的字面自动链接要还原"作者想要的地址"。GFM 的裸网址对中文不友好：它一直延伸到空白为止，
 *   只去掉末尾的少数 ASCII 标点，"详见“https://a.com/x”。" 解析出的地址是 "https://a.com/x”。"——作者显然想链接
 *   https://a.com/x，所以用 canonicalLinkUrl 去掉末尾的那串标点。显式链接、<自动链接>、引用式链接、图片是作者
 *   亲手写出的地址，原样采用。
 * - 译文：每个链接、图片的地址都按渲染结果原样采用，一个字符都不去掉。译文是给读者看的成品，
 *   "詳しくは https://a.com/x。" 渲染出的链接就是 https://a.com/x%E3%80%82，读者点开是错的地址，必须报错
 *   （让模型在网址后加空格或写成 <地址>）；显式链接、图片的地址末尾多了或少了字符也一样。
 * 如果两边都去掉末尾标点（之前的做法），上面这种译文会被放过；如果两边都不去掉，原文里最常见的
 * "网址。" 写法会让每一篇忠实的译文都报错。
 *
 * 比较的是读者浏览器拿到的编码形式：两边的地址都经过和渲染器（mdast-util-to-hast）同一个 normalizeUri，
 * 所以 <https://a.com/a b> 和 a%20b、汉字 和 %E6%B1%89%E5%AD%97 算同一个地址；简体和繁体、%E4 和 %e4 仍然不同。
 *
 * 译文比原文多出的链接一般是错误。例外：原文正文里有一串像网址的文字，GFM 却没有把它识别成链接
 * （"访问www.example.com，然后"——www 前面紧跟汉字），译文 "Visit www.example.com, then" 里它成了链接。
 * 这是译文更好地表达了作者的意思，只提醒（link_linkified），不拦截。
 * GFM 不再识别的（放进了行内代码、"詳しくはwww.a.comを…" 这种 www 前面紧跟文字的）就是少了一个链接，照样报错。
 */

/** GFM 会从裸网址末尾去掉的 ASCII 标点 */
const TRAILING_ASCII_PUNCTUATION = `?!.,:;*_~'"`;

/** 非 ASCII 的标点、符号、分隔符（全角标点、弯引号、破折号、省略号、NBSP…）；每次只测一个字符，不会回溯 */
const NON_ASCII_TRAILING = /^[\p{P}\p{S}\p{Z}]$/u;

const isAsciiAlpha = (code: number) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);

/**
 * 原文里一个 GFM 裸网址"作者想要的地址"：反复去掉地址末尾的一个字符，只要它是
 * - 非 ASCII 的标点 / 符号 / 分隔符（” ’ 」 】 ） 。 ， 、 —— …… NBSP 等）；
 * - ASCII 的 ?!.,:;*_~'"（GFM 的规则）；以及 GFM 同样当作结尾去掉的具名字符引用（"&nbsp;"）；
 * - 没有配对的 ")" "]"（维基百科式的 Foo_(bar) 保留）。
 * 非 ASCII 的字母、附加符号、数字（\p{L}\p{M}\p{N}）一律保留：路径里的 汉字 和 漢字 是不同的地址，
 * 粘在网址后面的日文助词（https://a.com/xをご覧ください——GFM 把它算进了链接，读者点开是错的地址）也算改动。
 * % 和其他 ASCII 字符原样保留，不做百分号解码。
 * 只用在原文的字面自动链接上（见上面"两边的规则不对称"）；代价是作者真想链接一个以这些标点结尾的地址时，
 * 要写成显式链接或 <地址>（网址末尾本来就很少有这些）。
 * 从尾部按下标往前走一遍，括号先数好、去掉一个减一个：线性时间，一长串 ")" 或标点也不会变慢。
 */
export function canonicalLinkUrl(url: string): string {
  // 右括号比左括号多几个（每种各数一次）
  let parens = 0;
  let brackets = 0;
  for (let i = 0; i < url.length; i += 1) {
    const code = url.charCodeAt(i);
    if (code === 40) parens -= 1;
    else if (code === 41) parens += 1;
    else if (code === 91) brackets -= 1;
    else if (code === 93) brackets += 1;
  }
  let end = url.length;
  while (end > 0) {
    const last = url.charCodeAt(end - 1);
    if (last < 128) {
      const ch = url.charAt(end - 1);
      if (ch === ";") {
        // "&nbsp;" 这样的具名字符引用（& + ASCII 字母 + ;）整个去掉，和 GFM 一样；否则只去掉分号
        let start = end - 1;
        while (start > 0 && isAsciiAlpha(url.charCodeAt(start - 1))) start -= 1;
        end = start < end - 1 && url.charAt(start - 1) === "&" ? start - 1 : end - 1;
      } else if (TRAILING_ASCII_PUNCTUATION.includes(ch)) {
        end -= 1;
      } else if (ch === ")" && parens > 0) {
        parens -= 1;
        end -= 1;
      } else if (ch === "]" && brackets > 0) {
        brackets -= 1;
        end -= 1;
      } else {
        break;
      }
      continue;
    }
    // 最后一个码点可能是代理对（如 emoji 之类的符号）
    const size = last >= 0xdc00 && last <= 0xdfff && end >= 2 && url.charCodeAt(end - 2) >= 0xd800 && url.charCodeAt(end - 2) <= 0xdbff ? 2 : 1;
    if (!NON_ASCII_TRAILING.test(url.slice(end - size, end))) break;
    end -= size;
  }
  return url.slice(0, end);
}

const linkTarget = (url: string): LinkTarget => ({ key: normalizeUri(url), display: url });

/*
 * 找出正文里像网址、GFM 却没有识别成链接的文字，给 link_linkified 用。只需要宁多勿少的近似：
 * 它只决定一个多出来的链接是提醒还是报错，而且要译文的链接地址和它完全一样才算。
 * - 起点：http:// https:// www.（不分大小写），或 @ 两边的邮箱字符；
 * - 终点：到空白为止（和 GFM 一样）、到第一个非 ASCII 的标点 / 符号（"www.example.com/文档，然后" 里的
 *   www.example.com/文档）、到第一个非 ASCII 字符（"www.example.com即可" 里的 www.example.com）各记一个，
 *   都用 canonicalLinkUrl 去掉末尾的标点；www. 补成 http://，邮箱补成 mailto:，再 normalizeUri。
 * 从左到右扫一遍，一串网址处理完从它的结尾继续，邮箱向左找本地部分也不越过上一串的结尾：线性时间。
 */
const isAsciiSpace = (code: number) => code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
const isEmailLocalChar = (code: number) => isAsciiAlpha(code) || (code >= 48 && code <= 57) || code === 46 || code === 43 || code === 45 || code === 95;
const isEmailDomainChar = (code: number) => isAsciiAlpha(code) || (code >= 48 && code <= 57) || code === 46 || code === 45 || code === 95;
const URL_STARTS = ["https://", "http://", "www."];

function unlinkedUrlCandidates(text: string, into: Set<string>): void {
  const add = (prefix: string, run: string) => {
    const url = canonicalLinkUrl(run);
    if (url !== "") into.add(normalizeUri(prefix + url));
  };
  let floor = 0;
  let i = 0;
  while (i < text.length) {
    const first = text.charCodeAt(i) | 0x20; // 转成小写：只有 h、w 开头的才可能是网址
    const start = first === 104 || first === 119 ? URL_STARTS.find((p) => text.slice(i, i + p.length).toLowerCase() === p) : undefined;
    if (start !== undefined) {
      const prefix = start === "www." ? "http://" : "";
      let asciiEnd = i;
      while (asciiEnd < text.length && text.charCodeAt(asciiEnd) < 128 && !isAsciiSpace(text.charCodeAt(asciiEnd))) asciiEnd += 1;
      let punctEnd = asciiEnd;
      while (punctEnd < text.length && !isAsciiSpace(text.charCodeAt(punctEnd)) && !(text.charCodeAt(punctEnd) >= 128 && NON_ASCII_TRAILING.test(text.charAt(punctEnd)))) {
        punctEnd += 1;
      }
      let end = punctEnd;
      // Unicode 空白（NBSP、全角空格…）也算空白：GFM 的网址到这里结束
      while (end < text.length && !isAsciiSpace(text.charCodeAt(end)) && !/\s/u.test(text.charAt(end))) end += 1;
      add(prefix, text.slice(i, asciiEnd));
      // 越过非 ASCII 字符的候选只在网址已经进入路径 / 查询 / 片段（主机名后面出现过 / ? #）时才算：
      // "www.example.com/文档" 的中文是路径的一部分；"www.a.com即可" 的中文紧跟主机名，是粘进来的正文，
      // 译文照抄会得到坏链接，不能降级成提醒
      if (/[/?#]/.test(text.slice(i + start.length, asciiEnd))) {
        add(prefix, text.slice(i, punctEnd));
        // "到空白为止"再要求结尾是 ASCII 或标点：结尾是文字说明标点后面又粘了正文（"/文档，然后"）
        const last = text.charAt(end - 1);
        if (end > punctEnd && (last.charCodeAt(0) < 128 || !/[\p{L}\p{N}\p{M}]/u.test(last))) add(prefix, text.slice(i, end));
      }
      i = Math.max(end, i + 1);
      floor = i;
    } else if (text.charCodeAt(i) === 64) {
      let localStart = i;
      while (localStart > floor && isEmailLocalChar(text.charCodeAt(localStart - 1))) localStart -= 1;
      let domainEnd = i + 1;
      while (domainEnd < text.length && isEmailDomainChar(text.charCodeAt(domainEnd))) domainEnd += 1;
      if (localStart < i && domainEnd > i + 1) add("mailto:", text.slice(localStart, domainEnd));
      i = domainEnd;
      floor = i;
    } else {
      i += 1;
    }
  }
}

function collectStructure(markdown: string, side: Side): Structure {
  const tree = parseMarkdown(markdown);
  // micromark 会去掉开头的 BOM，位置从 BOM 之后算起
  const shift = markdown.startsWith("\uFEFF") ? 1 : 0;
  const s: Structure = {
    codeBlocks: [],
    images: [],
    links: [],
    unlinkedUrls: new Set(),
    html: [],
    footnotes: [],
    headings: [],
    inlineCode: [],
    tables: 0,
    listItems: 0,
    paragraphs: 0,
  };

  // 引用式链接 / 图片（[文字][id]、![alt][id]）的地址在定义里，先收集定义。
  // identifier 是解析器规范化过的（大小写、空白），同一个定义怎么写都对得上；同名定义以第一个为准（和渲染一致）。
  // 定义本身不算链接：没被引用的定义读者看不到；引用它的链接各算一次。
  // 引用指向不存在的定义时解析器不会生成引用节点（退化成普通文字），这里自然就少了一个链接。
  const definitions = new Map<string, string>();
  const collectDefinitions = (node: Nodes): void => {
    if (node.type === "definition" && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
    if ("children" in node) for (const child of node.children) collectDefinitions(child);
  };
  collectDefinitions(tree);

  /**
   * GFM 的字面自动链接（裸网址、www.、邮箱）：节点在原文里的第一个字符不是 "["（显式链接）也不是 "<"（<自动链接>）。
   * 引用式链接是 linkReference 节点，不经过这里。
   * 没有位置信息的链接节点也是字面自动链接：同一段文字前面有没配对的 "[" 时，GFM 走另一条路径（文本二次扫描）生成链接，
   * 那条路径不带 position；显式链接和 <自动链接> 总有位置。
   */
  const isLiteralAutolink = (node: Nodes): boolean => {
    const offset = node.position?.start.offset;
    if (offset === undefined) return true;
    const first = markdown.charAt(offset + shift);
    return first !== "[" && first !== "<";
  };

  const walk = (node: Nodes, inLink: boolean): void => {
    switch (node.type) {
      case "code":
        // 只比较语言和内容；meta（语言后面的其余部分）不比较
        s.codeBlocks.push({ lang: node.lang ?? null, value: node.value });
        break;
      case "image":
        s.images.push(linkTarget(node.url));
        break;
      case "imageReference": {
        const url = definitions.get(node.identifier);
        if (url !== undefined) s.images.push(linkTarget(url));
        break;
      }
      // 普通链接、<自动链接>、GFM 的裸网址和邮箱都是 link 节点。链接文字不比较；
      // 继续往下走是为了链接里的图片（[![图](a.png)](地址)）——链接不能嵌套，不会重复计数
      case "link":
        s.links.push(linkTarget(side === "source" && isLiteralAutolink(node) ? canonicalLinkUrl(node.url) : node.url));
        break;
      case "linkReference": {
        const url = definitions.get(node.identifier);
        if (url !== undefined) s.links.push(linkTarget(url));
        break;
      }
      // 链接以外的正文：只有原文需要找没被识别成链接的网址
      case "text":
        if (side === "source" && !inLink) unlinkedUrlCandidates(node.value, s.unlinkedUrls);
        break;
      case "html":
        s.html.push(node.value);
        break;
      case "footnoteReference":
        s.footnotes.push(`[^${node.identifier}]`);
        break;
      case "footnoteDefinition":
        s.footnotes.push(`[^${node.identifier}]:`);
        break;
      case "heading":
        s.headings.push(node.depth);
        break;
      case "inlineCode":
        s.inlineCode.push(node.value);
        break;
      case "table":
        s.tables += 1;
        break;
      case "listItem":
        s.listItems += 1;
        break;
      case "paragraph":
        s.paragraphs += 1;
        break;
    }
    const childInLink = inLink || node.type === "link" || node.type === "linkReference";
    if ("children" in node) for (const child of node.children) walk(child, childInLink);
  };
  walk(tree, false);
  return s;
}

/** 多重集合的差（按 key 比较）：missing 是 a 比 b 多出来的（按 a 里出现的顺序，重复几次就列几次），extra 反之 */
function multisetDiff<T>(a: readonly T[], b: readonly T[], key: (item: T) => string): { missing: T[]; extra: T[] } {
  const minus = (from: readonly T[], other: readonly T[]): T[] => {
    const remaining = new Map<string, number>();
    for (const item of other) remaining.set(key(item), (remaining.get(key(item)) ?? 0) + 1);
    const result: T[] = [];
    for (const item of from) {
      const count = remaining.get(key(item)) ?? 0;
      if (count > 0) remaining.set(key(item), count - 1);
      else result.push(item);
    }
    return result;
  };
  return { missing: minus(a, b), extra: minus(b, a) };
}

function truncate(text: string): string {
  return text.length > DETAIL_MAX_LENGTH ? `${text.slice(0, DETAIL_MAX_LENGTH)}…` : text;
}

function diffIssues(
  a: readonly string[],
  b: readonly string[],
  missing: { kind: StructureIssueKind; message: string },
  extra: { kind: StructureIssueKind; message: string },
): StructureIssue[] {
  const diff = multisetDiff(a, b, (item) => item);
  return [
    ...diff.missing.map((item) => ({ ...missing, detail: truncate(item) })),
    ...diff.extra.map((item) => ({ ...extra, detail: truncate(item) })),
  ];
}

/** 图片、链接地址的差：按 key 比较，detail 显示 display */
function targetIssues(
  a: readonly LinkTarget[],
  b: readonly LinkTarget[],
  missing: { kind: StructureIssueKind; message: string },
  extra: { kind: StructureIssueKind; message: string },
  /** 多出的地址里哪些不算错误，而是换成 asWarning 这条提醒 */
  downgrade?: { test: (key: string) => boolean; asWarning: { kind: StructureIssueKind; message: string } },
): { errors: StructureIssue[]; warnings: StructureIssue[] } {
  const diff = multisetDiff(a, b, (target) => target.key);
  const extras = diff.extra.map((target) => ({ target, downgraded: downgrade?.test(target.key) ?? false }));
  return {
    errors: [
      ...diff.missing.map((target) => ({ ...missing, detail: truncate(target.display) })),
      ...extras.filter((e) => !e.downgraded).map((e) => ({ ...extra, detail: truncate(e.target.display) })),
    ],
    warnings: downgrade ? extras.filter((e) => e.downgraded).map((e) => ({ ...downgrade.asWarning, detail: truncate(e.target.display) })) : [],
  };
}

function countIssue(kind: StructureIssueKind, label: string, source: number, translation: number): StructureIssue[] {
  return source === translation ? [] : [{ kind, message: `${label}不同（原文 ${source} 个，译文 ${translation} 个）` }];
}

/** 比较原文和译文的 Markdown 结构。errors 非空的译文不能作为机器译文保存。 */
export function checkTranslationStructure(source: string, translation: string): StructureCheckResult {
  const a = collectStructure(source, "source");
  const b = collectStructure(translation, "translation");
  const errors: StructureIssue[] = [];
  const warnings: StructureIssue[] = [];

  // 代码块：数量不同时只报数量（逐个比较会把缺了一个之后的全部报成"被改动"）；数量相同再逐个比较
  if (a.codeBlocks.length !== b.codeBlocks.length) {
    errors.push(...countIssue("code_block_count", "代码块数量", a.codeBlocks.length, b.codeBlocks.length));
  } else {
    a.codeBlocks.forEach((original, i) => {
      const translated = b.codeBlocks[i];
      if (translated === undefined) return;
      const where = `第 ${i + 1} 个代码块${original.lang ? `（${original.lang}）` : ""}`;
      if (original.lang !== translated.lang) {
        errors.push({
          kind: "code_block_changed",
          message: "代码块的语言被改动",
          detail: `${where}：${original.lang ?? "无"} → ${translated.lang ?? "无"}`,
        });
      } else if (original.value !== translated.value) {
        errors.push({ kind: "code_block_changed", message: "代码块的内容被改动（代码必须原样保留）", detail: where });
      }
    });
  }

  const images = targetIssues(a.images, b.images, { kind: "image_missing", message: "译文缺少图片（或图片地址被改动）" }, { kind: "image_extra", message: "译文多出图片地址" });
  const links = targetIssues(
    a.links,
    b.links,
    { kind: "link_missing", message: "译文缺少链接（或链接地址被改动）" },
    { kind: "link_extra", message: "译文多出链接地址" },
    // 多出的链接正好是原文正文里一串没被 GFM 识别成链接的网址：译文只是把它变成了链接，提醒即可
    {
      test: (key) => a.unlinkedUrls.has(key),
      asWarning: { kind: "link_linkified", message: "译文把原文里没有成为链接的网址变成了链接（原文里它紧挨着文字，GFM 没有识别），确认一下" },
    },
  );
  errors.push(
    ...images.errors,
    ...links.errors,
    ...diffIssues(a.html, b.html, { kind: "html_missing", message: "译文缺少 HTML（或 HTML 被改动）" }, { kind: "html_extra", message: "译文多出 HTML" }),
    ...diffIssues(a.footnotes, b.footnotes, { kind: "footnote_missing", message: "译文缺少脚注" }, { kind: "footnote_extra", message: "译文多出脚注" }),
  );

  if (a.headings.join() !== b.headings.join()) {
    const levels = (depths: number[]) => (depths.length > 0 ? depths.map((d) => `h${d}`).join(" ") : "无");
    warnings.push({
      kind: "heading_mismatch",
      message: "标题的数量或层级不同",
      detail: `原文 ${levels(a.headings)}；译文 ${levels(b.headings)}`,
    });
  }
  warnings.push(
    ...links.warnings,
    ...diffIssues(
      a.inlineCode,
      b.inlineCode,
      { kind: "inline_code_missing", message: "译文缺少行内代码（或行内代码被改动）" },
      { kind: "inline_code_extra", message: "译文多出行内代码" },
    ),
    ...countIssue("table_count", "表格数量", a.tables, b.tables),
    ...countIssue("list_item_count", "列表项数量", a.listItems, b.listItems),
  );
  if (Math.abs(a.paragraphs - b.paragraphs) > Math.max(PARAGRAPH_DIFF_MIN, a.paragraphs * PARAGRAPH_DIFF_RATIO)) {
    warnings.push({
      kind: "paragraph_count",
      message: `段落数相差较多（原文 ${a.paragraphs} 段，译文 ${b.paragraphs} 段），可能有漏译`,
    });
  }

  return { errors, warnings };
}

// ---------- 生成接口：POST /admin/posts/:id/translations/:locale/generate ----------

/**
 * 请求生成标题，或正文的第 index 段（段号按 splitMarkdownForTranslation(原文) 计算）。
 * sourceHash 是编辑器加载文章时拿到的原文指纹：原文在此之后改过的话段落对不上，API 返回 409。
 */
export const translationGenerateInputSchema = z.discriminatedUnion("part", [
  z.strictObject({ part: z.literal("title"), sourceHash: sourceHashSchema }),
  z.strictObject({ part: z.literal("body"), index: z.int().nonnegative(), sourceHash: sourceHashSchema }),
]);
export type TranslationGenerateInput = z.infer<typeof translationGenerateInputSchema>;

/**
 * 生成译文暂时不能用的原因：
 *   not_configured            服务器没有设置 ANTHROPIC_API_KEY 或 REDIS_URL
 *   rate_limiter_unavailable  Redis 连不上：翻译的限流是唯一的额度上限，限不了就不放行（fail-closed），生成会 503
 */
export const translationUnavailableReasons = ["not_configured", "rate_limiter_unavailable"] as const;
export type TranslationUnavailableReason = (typeof translationUnavailableReasons)[number];

/**
 * GET /admin/translation/config：现在能不能生成译文、用哪个模型；不能时说明原因。
 * 编辑器据此启用"生成译文"按钮、显示模型名或原因。
 */
export const translationConfigSchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(true), model: z.string().min(1) }),
  z.object({ available: z.literal(false), model: z.string().min(1), reason: z.enum(translationUnavailableReasons) }),
]);
export type TranslationConfig = z.infer<typeof translationConfigSchema>;

/**
 * 模型名收进 TRANSLATION_MODEL_MAX_LENGTH（译文表里记录的上限，见 translationInputSchema.generated）：
 * 正常的模型 ID 远短于此；万一上游返回了超长的名字，截断并以 "…" 结尾，而不是让保存失败。
 */
export function fitModelName(model: string): string {
  const trimmed = model.trim();
  return trimmed.length > TRANSLATION_MODEL_MAX_LENGTH ? `${trimmed.slice(0, TRANSLATION_MODEL_MAX_LENGTH - 1)}…` : trimmed;
}

/**
 * 一篇译文各次请求实际服务的模型（服务端回退时可能不是请求的那个）合成一个字符串：去重后按首次出现的顺序用 ", " 连接。
 * 超出长度上限时只保留放得下的前几个，末尾写 ", …"（表示还有别的模型），保证保存时 generated.model 一定合法。
 * 第一个名字长到连 ", …" 都放不下时截断它（以 "…" 结尾）来腾地方：还有别的模型这件事不能丢。
 */
export function combineModelNames(models: readonly string[]): string {
  const unique = [...new Set(models.map((model) => model.trim()).filter((model) => model !== ""))];
  const joined = unique.join(", ");
  if (joined.length <= TRANSLATION_MODEL_MAX_LENGTH) return joined;
  const [first = ""] = unique;
  // 只有一个模型（它自己超长）：截断即可，没有"别的模型"要标记
  if (unique.length === 1) return fitModelName(first);
  const more = ", …";
  const kept: string[] = [];
  for (const model of unique) {
    if (`${[...kept, model].join(", ")}${more}`.length > TRANSLATION_MODEL_MAX_LENGTH) break;
    kept.push(model);
  }
  if (kept.length > 0) return `${kept.join(", ")}${more}`;
  return `${first.slice(0, TRANSLATION_MODEL_MAX_LENGTH - more.length - 1)}…${more}`;
}

/** 一次生成的 token 用量（SDK 返回 null 的缓存字段由 API 记为 0） */
export const translationUsageSchema = z.object({
  inputTokens: z.int().nonnegative(),
  outputTokens: z.int().nonnegative(),
  cacheReadInputTokens: z.int().nonnegative(),
  cacheCreationInputTokens: z.int().nonnegative(),
});
export type TranslationUsage = z.infer<typeof translationUsageSchema>;

/** 标题请求不流式，直接返回结果。model 是实际服务的模型（服务端回退时可能不是请求的那个） */
export const translationTitleResultSchema = z.object({
  title: z.string().min(1),
  model: z.string().min(1).max(TRANSLATION_MODEL_MAX_LENGTH),
  usage: translationUsageSchema,
});
export type TranslationTitleResult = z.infer<typeof translationTitleResultSchema>;

/** 流里没有别的输出时，API 每隔这么久发一个 ping（毫秒），见 translationStreamEventSchema */
export const TRANSLATION_HEARTBEAT_MS = 10_000;

/**
 * 正文段的流式响应（application/x-ndjson，一行一个 JSON）：若干 delta，最后以 done 或 error 结束。
 * ping 是心跳：模型在第一段译文之前要先思考，可能几十秒没有任何输出；这期间每 TRANSLATION_HEARTBEAT_MS 发一个，
 * 让连接上一直有字节在走（中间的代理不会把它当成空闲连接掐掉），编辑器可以据此显示"模型思考中"。不带内容。
 * done 的 stopReason 原样转发 API 的 stop_reason：只有 "end_turn" 算成功，
 * "refusal"（拒答）、"max_tokens"（截断）等都按失败处理。
 */
export const translationStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({
    type: z.literal("done"),
    /** 这一段的完整译文 */
    text: z.string(),
    stopReason: z.string().min(1),
    model: z.string().min(1).max(TRANSLATION_MODEL_MAX_LENGTH),
    usage: translationUsageSchema,
  }),
  z.object({ type: z.literal("error"), code: apiErrorCodeSchema, message: z.string() }),
]);
export type TranslationStreamEvent = z.infer<typeof translationStreamEventSchema>;
