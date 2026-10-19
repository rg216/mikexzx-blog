const PING = Symbol("ping");

/**
 * 等迭代器的下一个结果；每隔 intervalMs 还没等到，就调用一次 onIdle（写一行 ping），然后继续等同一个结果。
 * 用在流式响应里：上游（模型思考、出图）可能几十秒一个字节都没有，浏览器经前端的 /api rewrite（Vercel 的外部 rewrite）
 * 到 API 函数，中间的代理可能把长时间没有数据的连接当成空闲连接断开。每次调用重新计时，所以"每个事件之后计时重新开始"。
 * onIdle 返回 false 时（浏览器已经走了）不再写，直接等结果（上游随中止结束）。
 */
export async function nextWithHeartbeat<T>(iterator: AsyncIterator<T>, intervalMs: number, onIdle: () => Promise<boolean>): Promise<IteratorResult<T>> {
  const pending = iterator.next();
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = new Promise<typeof PING>((resolve) => {
      timer = setTimeout(() => resolve(PING), intervalMs);
    });
    try {
      const winner = await Promise.race([pending, tick]);
      if (winner !== PING) return winner;
    } finally {
      clearTimeout(timer);
    }
    if (!(await onIdle())) return pending;
  }
}
