import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  appendGameText,
  createInitialState,
  normalizeHeroName,
  readStoredGameData,
} from "../dist/state.js";

test("normalizeHeroName trims and validates", () => {
  assert.equal(normalizeHeroName("  ゆうしゃ  "), "ゆうしゃ");
  assert.throws(() => normalizeHeroName("   "));
  assert.throws(() => normalizeHeroName("あ".repeat(25)));
  assert.throws(() => normalizeHeroName("a‮b"));
  assert.throws(() => normalizeHeroName("ゆう\u200bしゃ"));
});

test("appendGameText rejects invisible control text", () => {
  const gameLog = [];
  appendGameText(gameLog, "ふつうの ログ");
  assert.deepEqual(gameLog, ["ふつうの ログ"]);
  assert.throws(() => appendGameText(gameLog, "みえない\u200bログ"));
});

test("readStoredGameData rejects future versions and clears battle state", () => {
  const future = { version: 2 };
  assert.deepEqual(readStoredGameData(future), { ok: false, reason: "future-version" });
  const state = createInitialState();
  state.inBattle = true;
  state.enemy = { name: "ウイルスりゅうし", hp: 8, attack: 3, exp: 8, gold: 10, boss: false };
  const restored = readStoredGameData(state);
  assert.equal(restored.ok, true);
  assert.equal(restored.state.inBattle, false);
  assert.equal(restored.state.enemy, null);
});

test("readStoredGameData preserves trusted battle state when requested", () => {
  const state = createInitialState();
  state.inBattle = true;
  state.enemy = { name: "ウイルスりゅうし", hp: 8, attack: 3, exp: 8, gold: 10, boss: false, rounds: 0 };
  const restored = readStoredGameData(state, { preserveBattle: true });
  assert.equal(restored.ok, true);
  assert.equal(restored.state.inBattle, true);
  assert.equal(restored.state.enemy.name, "ウイルスりゅうし");
});

test("readStoredGameData clamps overflowing exp instead of failing", () => {
  const state = createInitialState();
  const save = JSON.parse(
    JSON.stringify({
      version: 1,
      ...state,
      exp: 1000007,
      gameLog: [],
      savedAt: new Date().toISOString(),
    }),
  );
  const restored = readStoredGameData(save);
  assert.equal(restored.ok, true);
  assert.equal(restored.state.exp, 999999);
});

test("v1 save without fanMode still restores with default", () => {
  const state = createInitialState();
  const save = JSON.parse(
    JSON.stringify({ version: 1, ...state, gameLog: [], savedAt: new Date().toISOString() }),
  );
  delete save.fanMode;
  const restored = readStoredGameData(save);
  assert.equal(restored.ok, true);
  assert.equal(restored.state.fanMode, false);
});

test("initial state is consistent with invariants", () => {
  const state = createInitialState();
  assert.equal(state.maxHp, 30);
  assert.equal(state.weaponAttack, 5);
  assert.equal(state.armor, "ふだんぎ");
  assert.equal(state.armorDefense, 0);
  assert.equal(state.infected, false);
  assert.equal(state.medicineCount, 0);
  assert.equal(state.location, "venue");
});
