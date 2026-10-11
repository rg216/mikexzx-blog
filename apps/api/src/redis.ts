import { createClient } from "redis";

function createRedisClient(url: string) {
  const client = createClient({
    url,
    // 断线时命令立刻失败，而不是攒在离线队列里等重连——否则 Redis 一出问题，请求就全部挂住
    disableOfflineQueue: true,
    socket: { connectTimeout: 3000, reconnectStrategy: (retries) => Math.min(retries * 200, 2000) },
  });
  // 必须监听 error：未处理的 error 事件会让整个 Node 进程崩溃
  client.on("error", (error: Error) => console.error("redis error:", error.message));
  return client;
}

export type Redis = ReturnType<typeof createRedisClient>;

/** 惰性连接的 Redis：第一次用时才连接；连接失败时抛错，由调用方决定降级方式。 */
export type RedisProvider = () => Promise<Redis>;

export function createRedisProvider(url: string): RedisProvider {
  const client = createRedisClient(url);
  let connecting: Promise<Redis> | null = null;

  return async () => {
    if (client.isReady) return client;
    // 并发请求共享同一次连接尝试；失败后清空，下次请求再试
    if (!connecting) {
      connecting = client.connect().then(
        () => client,
        (error: unknown) => {
          connecting = null;
          throw error;
        },
      );
    }
    return connecting;
  };
}

/** Redis 现在能不能用（连得上、PING 有回应）。只读，不改任何数据；给"现在能不能生成译文"这类状态查询用 */
export async function redisReachable(redis: RedisProvider): Promise<boolean> {
  try {
    await (await redis()).ping();
    return true;
  } catch {
    return false;
  }
}
