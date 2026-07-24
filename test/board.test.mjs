import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  createBoard,
  findSecondTiedPlayers,
  formatClearTimeParts,
  isHeroNameTaken,
  writePlayerSnapshot,
} from "../worker/src/board.js";

function createPlayersKv() {
  const puts = [];
  const records = new Map();
  return {
    puts,
    records,
    async put(key, value, options = {}) {
      puts.push({ key, value, options });
      records.set(key, { value, metadata: options.metadata });
    },
    async list({ prefix }) {
      const keys = [];
      for (const [key, record] of records.entries()) {
        if (!prefix || key.startsWith(prefix)) {
          keys.push({ name: key, metadata: record.metadata });
        }
      }
      return { keys, list_complete: true };
    },
  };
}

function boardEnv(overrides = {}) {
  return {
    PLAYERS: createPlayersKv(),
    EVENT_TOKEN: "secret-token",
    EVENT_ID: "shared-event",
    ...overrides,
  };
}

function makeRequest(path, options = {}) {
  return new Request(`https://example.com${path}`, options);
}

test("formatClearTimeParts separates compact seconds from milliseconds", () => {
  assert.deepEqual(formatClearTimeParts(70), { text: "0ふん 0びょう", milliseconds: "070" });
  assert.deepEqual(formatClearTimeParts(1092), { text: "0ふん 1びょう", milliseconds: "092" });
  assert.deepEqual(formatClearTimeParts(61233), { text: "1ふん 1びょう", milliseconds: "233" });
  assert.deepEqual(formatClearTimeParts(0), { text: "--", milliseconds: "" });
  assert.deepEqual(formatClearTimeParts(Number.NaN), { text: "--", milliseconds: "" });
});

test("findSecondTiedPlayers only ties records in the same ranking category", () => {
  const normalA = { clearMs: 1092, cleared: true, cheatCleared: false, rtaCleared: false };
  const normalB = { clearMs: 1574, cleared: true, cheatCleared: false, rtaCleared: false };
  const normalOther = { clearMs: 2182, cleared: true, cheatCleared: false, rtaCleared: false };
  const rtaA = { clearMs: 70, cleared: true, cheatCleared: false, rtaCleared: true };
  const rtaB = { clearMs: 605, cleared: true, cheatCleared: false, rtaCleared: true };
  const rtaCrossCategory = {
    clearMs: 1490,
    cleared: true,
    cheatCleared: false,
    rtaCleared: true,
  };
  const tied = findSecondTiedPlayers([normalA, normalB, normalOther, rtaA, rtaB, rtaCrossCategory]);
  assert.equal(tied.has(normalA), true);
  assert.equal(tied.has(normalB), true);
  assert.equal(tied.has(normalOther), false);
  assert.equal(tied.has(rtaA), true);
  assert.equal(tied.has(rtaB), true);
  assert.equal(tied.has(rtaCrossCategory), false);
});

test("writePlayerSnapshot respects EVENT_WRITE_UNTIL and invalid progression", async () => {
  const closedEnv = boardEnv({
    EVENT_WRITE_UNTIL: "2026-07-21T00:00:00.000Z",
  });
  const snapshot = {
    name: "ゆうしゃ",
    level: 1,
    hp: 30,
    maxHp: 30,
    gold: 0,
    location: "おおてまちじょう",
    cleared: false,
    cheatCleared: false,
    princessCarried: false,
    dragonDefeated: false,
    infected: false,
    clearMs: 0,
  };
  const closed = await writePlayerSnapshot(
    closedEnv,
    "89d73a1c-76d6-4ef6-a1e9-7fe7b6aaeb5e",
    snapshot,
    Date.parse("2026-07-22T00:00:00.000Z"),
  );
  assert.equal(closed, false);
  assert.equal(closedEnv.PLAYERS.puts.length, 0);

  const invalid = await writePlayerSnapshot(
    boardEnv(),
    "89d73a1c-76d6-4ef6-a1e9-7fe7b6aaeb5e",
    { ...snapshot, cleared: true, dragonDefeated: false, clearMs: 12000 },
    Date.parse("2026-07-22T00:00:00.000Z"),
  );
  assert.equal(invalid, false);
});

test("isHeroNameTaken finds another player and excludes the current player", async () => {
  const env = boardEnv();
  await env.PLAYERS.put("event:shared-event:89d73a1c-76d6-4ef6-a1e9-7fe7b6aaeb5e", "{}", {
    metadata: {
      name: "ゆうしゃ",
      level: 1,
      hp: 30,
      maxHp: 30,
      gold: 0,
      location: "おおてまちじょう",
      cleared: false,
      cheatCleared: false,
      princessCarried: false,
      dragonDefeated: false,
      infected: false,
      clearMs: 0,
      updatedAt: 1,
    },
  });
  assert.equal(await isHeroNameTaken(env, "ゆうしゃ"), true);
  assert.equal(
    await isHeroNameTaken(env, "ゆうしゃ", "89d73a1c-76d6-4ef6-a1e9-7fe7b6aaeb5e"),
    false,
  );
  assert.equal(await isHeroNameTaken(env, "べつのなまえ"), false);
});

test("board players are sorted by progress, clear time, level, gold, then name", async () => {
  const env = boardEnv();
  await env.PLAYERS.put("event:shared-event:a", "{}", {
    metadata: {
      name: "アルファ",
      level: 5,
      hp: 62,
      maxHp: 62,
      gold: 90,
      location: "まもりのまち",
      cleared: false,
      cheatCleared: false,
      princessCarried: false,
      dragonDefeated: false,
      infected: false,
      clearMs: 0,
      updatedAt: 1,
    },
  });
  await env.PLAYERS.put("event:shared-event:b", "{}", {
    metadata: {
      name: "ベータ",
      level: 5,
      hp: 62,
      maxHp: 62,
      gold: 120,
      location: "まもりのまち",
      cleared: false,
      cheatCleared: false,
      princessCarried: false,
      dragonDefeated: false,
      infected: false,
      clearMs: 0,
      updatedAt: 2,
    },
  });
  await env.PLAYERS.put("event:shared-event:c", "{}", {
    metadata: {
      name: "クリア",
      level: 3,
      hp: 46,
      maxHp: 46,
      gold: 10,
      location: "おおてまちじょう",
      cleared: true,
      cheatCleared: false,
      princessCarried: false,
      dragonDefeated: true,
      infected: false,
      clearMs: 9000,
      updatedAt: 3,
    },
  });

  const board = createBoard({ now: () => Date.parse("2026-07-22T12:00:00.000Z") });
  const response = await board.fetch(makeRequest("/api/players"), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  const body = await response.json();
  assert.deepEqual(
    body.players.map((player) => player.name),
    ["クリア", "ベータ", "アルファ"],
  );
});

test("board page exposes gold column, updated ranking text, and page security headers", async () => {
  const board = createBoard({ now: () => Date.parse("2026-07-22T12:00:00.000Z") });
  const response = await board.fetch(makeRequest("/"), boardEnv());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy"), /fonts\.googleapis\.com/);
  const html = await response.text();
  assert.match(html, /<th scope="col">ゴールド<\/th>/);
  assert.match(html, /クリアタイム → レベル → ゴールド → なまえ/);
  assert.match(html, /\.time-ms \{/);
  assert.match(html, /secondTiedPlayers\.has\(player\)/);
  const script = html.match(/<script>([\s\S]+)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
  assert.match(html, /og:image" content="https:\/\/influ-quest\.nukoevi\.app\/assets\/og-title\.png"/);
  assert.match(html, /twitter:image" content="https:\/\/influ-quest\.nukoevi\.app\/assets\/og-title\.png"/);
});

test("board state api rejects impossible cleared snapshots", async () => {
  const board = createBoard({ now: () => Date.parse("2026-07-22T12:00:00.000Z") });
  const response = await board.fetch(
    makeRequest("/api/state", {
      method: "POST",
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: "89d73a1c-76d6-4ef6-a1e9-7fe7b6aaeb5e",
        name: "ゆうしゃ",
        level: 5,
        hp: 62,
        maxHp: 62,
        gold: 100,
        location: "おおてまちじょう",
        cleared: true,
        cheatCleared: false,
        princessCarried: false,
        dragonDefeated: false,
        infected: false,
        clearMs: 1000,
      }),
    }),
    boardEnv(),
  );
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const body = await response.json();
  assert.equal(body.error, "invalid_record");
});
