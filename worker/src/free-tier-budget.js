const ACCOUNT_KV_WRITE_LIMIT = 72;
const budgetInitialization = new WeakMap();

async function ensureBudgetTable(db) {
  const existing = budgetInitialization.get(db);
  if (existing) return existing;
  const initialization = (async () => {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS account_free_tier_kv_budget (
           id INTEGER PRIMARY KEY CHECK (id = 1),
           usage_date TEXT NOT NULL,
           reserved_writes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_writes >= 0)
         )`,
      )
      .run();
    await db
      .prepare(
        "INSERT OR IGNORE INTO account_free_tier_kv_budget (id, usage_date, reserved_writes) VALUES (1, date('now'), 0)",
      )
      .run();
    return true;
  })().catch(() => false);
  budgetInitialization.set(db, initialization);
  const ready = await initialization;
  if (!ready) budgetInitialization.delete(db);
  return ready;
}

export async function reserveAccountKvWrite(db) {
  if (!db || typeof db.prepare !== "function") return false;
  if (!(await ensureBudgetTable(db))) return false;
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
