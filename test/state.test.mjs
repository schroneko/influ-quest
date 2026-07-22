import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  appendGameText,
  createInitialState,
  decodeJumon,
  encodeJumon,
  JUMON_CHARS,
  normalizeHeroName,
  readStoredGameData,
} from "../dist/state.js";

const legacyJumonVersion = 2;
const legacyNameLimit = 7;
const legacyJumonIndex = new Map([...JUMON_CHARS].map((char, index) => [char, index]));

function writeBits(bits, value, width) {
  for (let index = width - 1; index >= 0; index -= 1) {
    bits.push((value >> index) & 1);
  }
}

function bitsToGroups(bits) {
  const groups = [];
  for (let index = 0; index < bits.length; index += 6) {
    let value = 0;
    for (let offset = 0; offset < 6; offset += 1) {
      value = (value << 1) | (bits[index + offset] ?? 0);
    }
    groups.push(value);
  }
  return groups;
}

function jumonChecksum(groups) {
  let value = 7;
  for (const group of groups) {
    value = (value * 33 + group + 13) & 0xff;
  }
  return value;
}

function groupsToJumon(groups) {
  return groups.map((group) => JUMON_CHARS[group]).join("");
}

function encodeLegacyJumon(state) {
  const bits = [];
  writeBits(bits, legacyJumonVersion, 4);
  writeBits(bits, state.level, 3);
  writeBits(bits, Math.min(state.exp, 131071), 17);
  writeBits(bits, Math.min(state.gold, 131071), 17);
  writeBits(bits, ["たいおんけい", "アルコールスプレー", "じょきんのやり", "でんせつのワクチンソード"].indexOf(state.weapon), 2);
  writeBits(bits, ["ふだんぎ", "ファントムマスク", "N95マスク", "かんせんたいさくスーツ"].indexOf(state.armor), 2);
  writeBits(bits, state.medicineCount, 2);
  writeBits(bits, ["venue", "office", "lair"].indexOf(state.location), 2);
  writeBits(bits, state.lairDepth, 3);
  writeBits(bits, state.tabletFound ? 1 : 0, 1);
  writeBits(bits, state.hostGreeted ? 1 : 0, 1);
  writeBits(bits, state.miniBossDefeated ? 1 : 0, 1);
  writeBits(bits, state.bossDefeated ? 1 : 0, 1);
  writeBits(bits, state.princessCarried ? 1 : 0, 1);
  writeBits(bits, state.cleared ? 1 : 0, 1);
  writeBits(bits, state.cheatCleared ? 1 : 0, 1);
  writeBits(bits, state.fanMode ? 1 : 0, 1);
  writeBits(bits, state.infected ? 1 : 0, 1);
  writeBits(bits, state.startedAtMs > 0 ? 1 : 0, 1);
  writeBits(bits, 0, 20);
  writeBits(bits, Math.min(Math.floor(state.clearMs / 1000), 131071), 17);
  const name =
    state.heroName === "ななしのゆうしゃ" ? "" : state.heroName;
  const nameGroups = [...name].slice(0, legacyNameLimit).map((char) => legacyJumonIndex.get(char));
  writeBits(bits, nameGroups.length, 3);
  for (const group of nameGroups) {
    writeBits(bits, group, 6);
  }
  const payloadGroups = bitsToGroups(bits);
  const checksum = jumonChecksum(payloadGroups);
  return groupsToJumon([
    ...payloadGroups,
    (checksum >> 2) & 63,
    ((checksum & 3) << 4) & 63,
  ]);
}

function rewritePayload(jumon, transform) {
  const groups = [...jumon].map((char) => legacyJumonIndex.get(char));
  const payloadGroups = transform(groups.slice(0, -2));
  const checksum = jumonChecksum(payloadGroups);
  return groupsToJumon([
    ...payloadGroups,
    (checksum >> 2) & 63,
    ((checksum & 3) << 4) & 63,
  ]);
}

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

test("jumon round-trips state as short hiragana", () => {
  const state = createInitialState();
  state.heroName = "てすとゆうしや";
  state.gold = 170;
  state.hostGreeted = true;
  state.weapon = "アルコールスプレー";
  state.weaponAttack = 12;
  state.armor = "N95マスク";
  state.armorDefense = 4;
  state.medicineCount = 2;
  const jumon = encodeJumon(state, []);
  assert.ok([...jumon].length <= 52, `jumon too long: ${[...jumon].length}`);
  assert.match(jumon, /^[ぁ-ゔ]+$/u);
  const restored = decodeJumon(jumon);
  assert.equal(restored.state.heroName, "てすとゆうしや");
  assert.equal(restored.state.gold, 170);
  assert.equal(restored.state.hostGreeted, true);
  assert.equal(restored.state.weapon, "アルコールスプレー");
  assert.equal(restored.state.armor, "N95マスク");
  assert.equal(restored.state.medicineCount, 2);
  assert.deepEqual(restored.gameLog, []);
});

test("jumon v3 preserves hostAsking and long unicode names", () => {
  const state = createInitialState();
  state.heroName = "竜王勇者銀河星雲世界冒険譚光雷炎水風土心夢剣盾";
  state.hostAsking = true;
  state.hostGreeted = true;
  state.gold = 321;
  const jumon = encodeJumon(state, []);
  const restored = decodeJumon(jumon);
  assert.equal(restored.state.heroName, state.heroName);
  assert.equal(restored.state.hostAsking, true);
  assert.equal(restored.state.gold, 321);
});

test("decodeJumon still accepts legacy v2 jumon", () => {
  const state = createInitialState();
  state.heroName = "てすと";
  state.gold = 99;
  state.hostGreeted = true;
  const jumon = encodeLegacyJumon(state);
  const restored = decodeJumon(jumon);
  assert.equal(restored.state.heroName, "てすと");
  assert.equal(restored.state.gold, 99);
  assert.equal(restored.state.hostAsking, false);
});

test("jumon rejects tampered payloads", () => {
  assert.throws(() => decodeJumon("not-base64!"));
  const state = createInitialState();
  state.gold = 500;
  const jumon = encodeJumon(state, []);
  const chars = [...jumon];
  chars[3] = chars[3] === "あ" ? "い" : "あ";
  assert.throws(() => decodeJumon(chars.join("")));
});

test("jumon rejects checksum padding and malformed payload lengths", () => {
  const state = createInitialState();
  state.heroName = "てすと";
  state.hostGreeted = true;
  const jumon = encodeJumon(state, []);
  const groups = [...jumon].map((char) => legacyJumonIndex.get(char));
  const lastGroup = groups[groups.length - 1];
  const paddedGroup = (lastGroup & 0b110000) | 0b000001;
  const tampered = [...jumon];
  tampered[tampered.length - 1] = JUMON_CHARS[paddedGroup];
  assert.throws(() => decodeJumon(tampered.join("")));
  const shortJumon = rewritePayload(jumon, (payloadGroups) => payloadGroups.slice(0, -1));
  assert.throws(() => decodeJumon(shortJumon));
  const extraJumon = rewritePayload(jumon, (payloadGroups) => [...payloadGroups, 0]);
  assert.throws(() => decodeJumon(extraJumon));
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
