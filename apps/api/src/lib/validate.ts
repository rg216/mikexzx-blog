import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";
import { errorBody } from "./errors.ts";

/** zValidator + 统一的 400 错误格式（字段路径 + 原因）。 */
export function validate<Target extends keyof ValidationTargets, Schema extends ZodType>(target: Target, schema: Schema) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const issues = result.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      }));
      return c.json(errorBody("validation_error", "请求参数无效", issues), 400);
    }
  });
}
