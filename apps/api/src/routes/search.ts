import { searchQuerySchema, type SearchResult } from "@blog/shared";
import { Hono } from "hono";
import type { Db } from "../db/client.ts";
import { clientIp } from "../lib/client-ip.ts";
import { type RateLimiter, rateLimit, rules } from "../lib/rate-limit.ts";
import { validate } from "../lib/validate.ts";
import { searchPosts } from "../services/search.ts";

export function searchRoutes(db: Db, limiter: RateLimiter) {
  return new Hono().get(
    "/search",
    rateLimit(limiter, rules.search, (c) => clientIp(c)),
    validate("query", searchQuerySchema),
    async (c) => {
      const { q } = c.req.valid("query");
      return c.json({ items: await searchPosts(db, q) } satisfies SearchResult);
    },
  );
}
