import type { Passkey } from "@blog/shared";
import { and, asc, count, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { passkeys, users } from "../db/schema.ts";

type PasskeyRow = typeof passkeys.$inferSelect;
type NewPasskey = typeof passkeys.$inferInsert;

export function toPasskey(row: PasskeyRow): Passkey {
  return {
    id: row.id,
    name: row.name,
    deviceType: row.deviceType,
    backedUp: row.backedUp,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

/** 这是单管理员博客：只有一个用户，首次设置时创建。 */
export async function getAdminUser(db: Db) {
  const [user] = await db.select().from(users).orderBy(asc(users.id)).limit(1);
  return user ?? null;
}

export async function getUserById(db: Db, id: number) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user ?? null;
}

export async function countPasskeys(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(passkeys);
  return row?.n ?? 0;
}

export async function listPasskeys(db: Db, userId: number): Promise<PasskeyRow[]> {
  return db.select().from(passkeys).where(eq(passkeys.userId, userId)).orderBy(asc(passkeys.createdAt));
}

export async function findPasskey(db: Db, id: string): Promise<PasskeyRow | null> {
  const [row] = await db.select().from(passkeys).where(eq(passkeys.id, id));
  return row ?? null;
}

/** 注册成功：用户不存在就创建（首次设置），然后保存凭证。 */
export async function saveNewPasskey(
  db: Db,
  { userId, webauthnUserId, passkey }: { userId: number | null; webauthnUserId: string; passkey: Omit<NewPasskey, "userId"> },
): Promise<{ userId: number; passkey: PasskeyRow }> {
  return db.transaction(async (tx) => {
    let ownerId = userId;
    if (ownerId === null) {
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.webauthnUserId, webauthnUserId));
      ownerId =
        existing?.id ??
        (await tx.insert(users).values({ displayName: "管理员", webauthnUserId }).returning({ id: users.id }))[0]?.id ??
        null;
      if (ownerId === null) throw new Error("failed to create user");
    }
    const [row] = await tx
      .insert(passkeys)
      .values({ ...passkey, userId: ownerId })
      .returning();
    if (!row) throw new Error("insert returned no row");
    return { userId: ownerId, passkey: row };
  });
}

/** 登录成功后记录新的签名计数、备份状态和使用时间。 */
export async function markPasskeyUsed(db: Db, id: string, data: { counter: number; backedUp: boolean }): Promise<void> {
  await db
    .update(passkeys)
    .set({ counter: data.counter, backedUp: data.backedUp, lastUsedAt: new Date() })
    .where(eq(passkeys.id, id));
}

export async function renamePasskey(db: Db, userId: number, id: string, name: string): Promise<PasskeyRow | null> {
  const [row] = await db
    .update(passkeys)
    .set({ name })
    .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
    .returning();
  return row ?? null;
}

/**
 * 删除 Passkey。不允许删除最后一个：只有 Passkey 一种登录方式，删光就把自己锁在门外了。
 * 返回 "deleted" / "not_found" / "last_passkey"。
 */
export async function deletePasskey(db: Db, userId: number, id: string): Promise<"deleted" | "not_found" | "last_passkey"> {
  return db.transaction(async (tx) => {
    // 锁住该用户的所有 Passkey 行，防止两个并发请求各删一个、最后一个也没了
    const owned = await tx.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.userId, userId)).for("update");
    if (!owned.some((p) => p.id === id)) return "not_found";
    if (owned.length <= 1) return "last_passkey";
    await tx.delete(passkeys).where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)));
    return "deleted";
  });
}
