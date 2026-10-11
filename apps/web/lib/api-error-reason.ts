/*
 * 浏览器调用 API 失败的原因。API 返回的 message 是中文的，前台不直接显示它：
 * 客户端代码只判断原因，由组件按当前语言的字典显示文字。
 */
export type ApiErrorReason =
  /** 请求没发出去或没有响应（断网、DNS、CORS 之类） */
  | "network"
  | "rate_limited"
  /** 400：输入不合法 */
  | "invalid"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  /** 5xx、网关错误页、响应格式不对：都是"服务端的问题，稍后再试" */
  | "unavailable";

/** 按 HTTP 状态码归类；status 为 0 表示网络错误 */
export function reasonFromStatus(status: number): ApiErrorReason {
  switch (status) {
    case 0:
      return "network";
    case 400:
      return "invalid";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 429:
      return "rate_limited";
    default:
      return "unavailable";
  }
}
