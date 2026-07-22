import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createDashboardReporter } from "../dist/reporting.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test("dashboard reporter retries an unchanged snapshot after a failed retry cycle", async () => {
  let calls = 0;
  const reporter = createDashboardReporter({
    url: "https://example.com",
    token: "test-token",
    loadPlayerId: () => "9b2e67f1-f52f-4fc8-b7da-59fd4d9344a7",
    cooldownMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: calls < 3 ? 503 : 204 });
    },
  });
  const snapshot = { name: "テスト", level: 1, hp: 20, maxHp: 20, gold: 0 };
  reporter.report(snapshot);
  await settle();
  assert.equal(calls, 2);
  reporter.report(snapshot);
  await settle();
  assert.equal(calls, 3);
  reporter.dispose();
});
