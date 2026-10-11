/*
 * NDJSON（一行一个 JSON）的读取：把 fetch 响应体的字节流切成一行一行的文本。
 *
 * 网络分块和行没有任何关系：一块里可能有好几行，也可能只有半行，甚至把一个汉字的 3 个 UTF-8 字节拆在两块里。
 * 所以要做两件事：
 *   1. 用 TextDecoder 的流模式（stream: true）解码：不完整的多字节字符留在解码器里，等下一块补齐，不会解出乱码 �
 *   2. 把解码出来的文本攒在缓冲区里，遇到换行才交出一整行；最后一行可能没有换行，流结束时再交出
 *
 * 切行和解析 JSON 分开：这里只管"字节 → 行"，每行用什么 schema 校验由调用方决定（见 admin-api.ts）。
 */

/** 字节不是合法的 UTF-8：服务器返回的东西不对，不是网络问题 */
export class LineDecodeError extends Error {
  constructor(options?: ErrorOptions) {
    super("响应不是合法的 UTF-8 文本", options);
    this.name = "LineDecodeError";
  }
}

export type LineDecoder = {
  /** 送入一块字节，返回这一块里凑齐的完整行（不含换行符，跳过空行） */
  push(chunk: Uint8Array): string[];
  /** 流结束：冲出解码器里剩下的字节和缓冲区里最后一行（没有换行结尾的话） */
  end(): string[];
};

/** 把一段文本按 \n 切开：最后一段不完整，留作缓冲；行尾的 \r 去掉（容忍 CRLF） */
function takeLines(text: string): { lines: string[]; rest: string } {
  const parts = text.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((line) => line.replace(/\r$/, "")).filter((line) => line.trim() !== ""), rest };
}

export function createLineDecoder(): LineDecoder {
  // fatal: 不合法的 UTF-8 直接报错，而不是悄悄替换成 �——译文里混进乱码比失败更糟（内容准确优先）
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  function decode(chunk?: Uint8Array): string {
    try {
      // 不带参数的 decode() 结束流式解码：还有半个字符没补齐也算不合法
      return chunk === undefined ? decoder.decode() : decoder.decode(chunk, { stream: true });
    } catch (error) {
      throw new LineDecodeError({ cause: error });
    }
  }
  return {
    push(chunk) {
      const { lines, rest } = takeLines(buffer + decode(chunk));
      buffer = rest;
      return lines;
    },
    end() {
      const { lines, rest } = takeLines(buffer + decode());
      buffer = "";
      return rest.trim() === "" ? lines : [...lines, rest.replace(/\r$/, "")];
    },
  };
}

/** 逐行读取字节流。调用方提前 break / return 时取消底层的流（不再接收后面的数据） */
export async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string, void, undefined> {
  const reader = stream.getReader();
  const decoder = createLineDecoder();
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* decoder.push(value);
    }
    finished = true;
    yield* decoder.end();
  } finally {
    // 没读完就退出（调用方 break、出错）：取消流，让 fetch 断开连接；读完了只需要释放锁
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
