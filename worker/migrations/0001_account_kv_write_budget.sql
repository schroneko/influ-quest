CREATE TABLE IF NOT EXISTS account_free_tier_kv_budget (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  usage_date TEXT NOT NULL,
  reserved_writes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_writes >= 0)
);

INSERT OR IGNORE INTO account_free_tier_kv_budget (id, usage_date, reserved_writes)
VALUES (1, date('now'), 0);
