const ACCOUNT_KV_WRITE_LIMIT = 72;

export async function reserveAccountKvWrite(db) {
  if (!db || typeof db.prepare !== "function") return false;
  try {
    const result = await db
      .prepare(
        `UPDATE account_free_tier_kv_budget
         SET usage_date = date('now'),
             reserved_writes = CASE
               WHEN usage_date = date('now') THEN reserved_writes + 1
               ELSE 1
             END
         WHERE id = 1
           AND (
             usage_date != date('now')
             OR reserved_writes + 1 <= ${ACCOUNT_KV_WRITE_LIMIT}
           )
         RETURNING reserved_writes`,
      )
      .first();
    return result !== null;
  } catch {
    return false;
  }
}
