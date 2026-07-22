import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadPlayerId } from "../dist/storage.js";

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test("loadPlayerId atomically replaces invalid ids with uuid v4", () => {
  const dir = mkdtempSync(join(tmpdir(), "influ-quest-storage-"));
  const playerIdPath = join(dir, "player-id");
  writeFileSync(playerIdPath, "not-a-uuid", "utf8");
  const playerId = loadPlayerId(playerIdPath);
  assert.match(playerId, UUID_V4_PATTERN);
  assert.equal(readFileSync(playerIdPath, "utf8"), playerId);
});

test("loadPlayerId preserves valid uuid v4 values", () => {
  const dir = mkdtempSync(join(tmpdir(), "influ-quest-storage-"));
  const playerIdPath = join(dir, "player-id");
  const existing = "89d73a1c-76d6-4ef6-a1e9-7fe7b6aaeb5e";
  writeFileSync(playerIdPath, existing, "utf8");
  const playerId = loadPlayerId(playerIdPath);
  assert.equal(playerId, existing);
  assert.equal(readFileSync(playerIdPath, "utf8"), existing);
});
