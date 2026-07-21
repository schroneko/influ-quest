import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  createInitialState,
  decodeJumon,
  encodeJumon,
  normalizeHeroName,
  readStoredGameData,
} from "../dist/state.js";

test("normalizeHeroName trims and validates", () => {
  assert.equal(normalizeHeroName("  ゆうしゃ  "), "ゆうしゃ");
  assert.throws(() => normalizeHeroName("   "));
  assert.throws(() => normalizeHeroName("あ".repeat(25)));
  assert.throws(() => normalizeHeroName("a‮b"));
});

test("jumon round-trips state and log", () => {
  const state = createInitialState();
  state.heroName = "てすとゆうしゃ";
  state.gold = 170;
  state.hostGreeted = true;
  const gameLog = ["いちぎょうめ", "にぎょうめ"];
  const jumon = encodeJumon(state, gameLog);
  const restored = decodeJumon(jumon);
  assert.equal(restored.state.heroName, "てすとゆうしゃ");
  assert.equal(restored.state.gold, 170);
  assert.equal(restored.state.hostGreeted, true);
  assert.deepEqual(restored.gameLog, gameLog);
});

test("jumon rejects tampered payloads", () => {
  assert.throws(() => decodeJumon("not-base64!"));
  const forged = Buffer.from(JSON.stringify({ hero: "x" }), "utf8").toString("base64");
  assert.throws(() => decodeJumon(forged));
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

test("initial state is consistent with invariants", () => {
  const state = createInitialState();
  assert.equal(state.maxHp, 30);
  assert.equal(state.weaponAttack, 6);
  assert.equal(state.location, "venue");
});
