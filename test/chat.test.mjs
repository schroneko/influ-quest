import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createInitialState } from "../dist/state.js";
import {
  CHAT_BODY_LIMIT_BYTES,
  handleChat,
  isExplicitNewGameCommand,
  playPage,
  readChatRequestEnvelope,
} from "../worker/src/play.js";
import {
  BrowserChatSession,
  createDurableChatSessionStore,
  createMemoryChatSessionStore,
} from "../worker/src/chat-session.js";

const SESSION_ID = "89d73a1c-76d6-4ef6-a1e9-7fe7b6aaeb5e";
const PLAYER_ID = "9b2e67f1-f52f-4fc8-b7da-59fd4d9344a7";

function createPlayersKv() {
  const puts = [];
  const deletes = [];
  return {
    puts,
    deletes,
    async put(key, value, options = {}) {
      puts.push({ key, value, options });
    },
    async delete(key) {
      deletes.push(key);
    },
    async list() {
      return { keys: [], list_complete: true };
    },
  };
}

function createChatEnv(overrides = {}) {
  return {
    ANTHROPIC_API_KEY: "test-key",
    PLAYERS: createPlayersKv(),
    ...overrides,
  };
}

function createChatRequest(message, options = {}) {
  const body =
    options.rawBody ??
    JSON.stringify({
      sessionId: options.sessionId ?? SESSION_ID,
      message,
    });
  return new Request("https://example.com/api/chat", {
    method: "POST",
    headers: options.headers ?? { "content-type": "application/json" },
    body,
  });
}

function createSave(overrides = {}) {
  return {
    version: 1,
    ...createInitialState(),
    gameLog: [],
    savedAt: "2026-07-22T00:00:00.000Z",
    ...overrides,
  };
}

function modelText(text) {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
  };
}

function modelTool(id, input) {
  return {
    content: [{ type: "tool_use", id, name: "game", input }],
    stop_reason: "tool_use",
  };
}

async function withMockedFetch(responses, run) {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    const next =
      typeof responses === "function"
        ? await responses(callCount)
        : responses[Math.min(callCount, responses.length - 1)];
    callCount += 1;
    return new Response(JSON.stringify(next), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    return await run();
  } finally {
    global.fetch = originalFetch;
  }
}

function createStorage(initialValue = undefined, options = {}) {
  let storedValue = initialValue;
  return {
    puts: [],
    gets: 0,
    async get() {
      this.gets += 1;
      if (options.failGet) {
        throw new Error("get failed");
      }
      return storedValue;
    },
    async put(key, value) {
      if (options.failPut) {
        throw new Error("put failed");
      }
      this.puts.push({ key, value });
      storedValue = value;
    },
    async delete() {
      storedValue = undefined;
    },
    current() {
      return storedValue;
    },
  };
}

test("isExplicitNewGameCommand only matches explicit reset commands", () => {
  assert.equal(isExplicitNewGameCommand("はじめから やりなおす"), true);
  assert.equal(isExplicitNewGameCommand("NEW_GAME"), true);
  assert.equal(isExplicitNewGameCommand("はじめから やりなおす つもりは ない"), false);
  assert.equal(isExplicitNewGameCommand("やりなおすな"), false);
});

test("readChatRequestEnvelope enforces JSON content type and body limit", async () => {
  const unsupported = await readChatRequestEnvelope(
    createChatRequest("こんにちは", {
      headers: { "content-type": "text/plain" },
      rawBody: "plain text",
    }),
  );
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.response.status, 415);
  assert.equal(unsupported.response.headers.get("x-content-type-options"), "nosniff");

  const oversized = await readChatRequestEnvelope(
    createChatRequest("こんにちは", {
      rawBody: JSON.stringify({
        sessionId: SESSION_ID,
        message: "あ".repeat(CHAT_BODY_LIMIT_BYTES),
      }),
    }),
  );
  assert.equal(oversized.ok, false);
  assert.equal(oversized.response.status, 413);
});

test("play page includes security headers", () => {
  const response = playPage();
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy"), /fonts\.googleapis\.com/);
  return response.text().then((html) => {
    assert.match(html, /\.hud\[hidden\],[\s\S]*\.scene\[hidden\][\s\S]*display: none/);
  });
});

test("explicit new game writes a reset snapshot and uses session/ip rate limit keys", async () => {
  const sessionKeys = [];
  const ipKeys = [];
  const env = createChatEnv({
    CHAT_RATE_LIMIT: {
      async limit({ key }) {
        sessionKeys.push(key);
        return { success: true };
      },
    },
    CHAT_IP_RATE_LIMIT: {
      async limit({ key }) {
        ipKeys.push(key);
        return { success: true };
      },
    },
  });
  const store = createMemoryChatSessionStore({
    playerId: PLAYER_ID,
    turns: 4,
    messages: [],
    save: createSave({ gold: 999 }),
  });
  const response = await handleChat(createChatRequest("はじめから やりなおす"), env, undefined, store);
  assert.equal(response.status, 200);
  assert.deepEqual(sessionKeys, [`chat:${SESSION_ID}`]);
  assert.deepEqual(ipKeys, []);
  assert.equal(env.PLAYERS.puts.length, 0);
  assert.equal(env.PLAYERS.deletes.length, 1);
  const stored = await store.read(SESSION_ID);
  assert.equal(stored.turns, 0);
  assert.equal(stored.save.gold, 0);
});

test("incidental reset phrases do not erase progress", async () => {
  const store = createMemoryChatSessionStore({
    playerId: PLAYER_ID,
    turns: 2,
    messages: [],
    save: createSave({ gold: 222, hostGreeted: true }),
  });
  await withMockedFetch(
    [modelTool("tool-1", { action: "status" }), modelText("つづけるのだ。")],
    async () => {
    const response = await handleChat(
      createChatRequest("はじめから やりなおす つもりは ない"),
      createChatEnv(),
      undefined,
      store,
    );
    assert.equal(response.status, 200);
    },
  );
  const stored = await store.read(SESSION_ID);
  assert.equal(stored.save.gold, 222);
  assert.equal(stored.turns, 3);
});

test("はい confirms a purchase the assistant just proposed", async () => {
  const store = createMemoryChatSessionStore({
    playerId: PLAYER_ID,
    turns: 0,
    messages: [
      { role: "user", content: [{ type: "text", text: "スーツを みせて" }] },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "ぼうぐや「かんせんたいさくスーツは 120ゴールドだ。かいますか？」",
          },
        ],
      },
    ],
    save: createSave({ hostGreeted: true, heroName: "てすと", gold: 300, location: "office" }),
  });
  await withMockedFetch(
    [
      modelTool("tool-1", { action: "armor_shop", item: "かんせんたいさくスーツ" }),
      modelText("よい かいものだ。"),
    ],
    async () => {
      const response = await handleChat(createChatRequest("はい"), createChatEnv(), undefined, store);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.match(body.reply, /かんせんたいさくスーツを そうびした/);
      assert.equal(body.hud.gold, 180);
      assert.equal(body.hud.armor, "かんせんたいさくスーツ");
    },
  );
});

test("unsolicited purchases without player intent fall back to the shop listing", async () => {
  const store = createMemoryChatSessionStore({
    playerId: PLAYER_ID,
    turns: 0,
    messages: [],
    save: createSave({ hostGreeted: true, heroName: "てすと", gold: 300, location: "office" }),
  });
  await withMockedFetch(
    [
      modelTool("tool-1", { action: "armor_shop", item: "かんせんたいさくスーツ" }),
      modelText("しなぞろえは こんな ところだ。"),
    ],
    async () => {
      const response = await handleChat(
        createChatRequest("ぼうぐやを のぞく"),
        createChatEnv(),
        undefined,
        store,
      );
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.doesNotMatch(body.reply, /そうびした/);
      assert.equal(body.hud.gold, 300);
      assert.equal(body.hud.armor, "ふだんぎ");
    },
  );
});

test("text-only model replies are shown as conversation without state changes", async () => {
  const store = {
    async read() {
      return {
        playerId: PLAYER_ID,
        turns: 0,
        messages: [],
        save: createSave({ hostGreeted: true, heroName: "てすと", gold: 123 }),
      };
    },
    async write() {},
  };
  await withMockedFetch([modelText("ぶきや「ねぎりは うけつけて いないぜ。」")], async () => {
    const response = await handleChat(
      createChatRequest("いちばん つよいのを ねぎりたい"),
      createChatEnv(),
      undefined,
      store,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.reply, /ねぎりは うけつけて いないぜ/);
    assert.doesNotMatch(body.reply, /ぼうけんは つづいている/);
    assert.equal(body.hud.gold, 123);
  });
});

test("trusted browser sessions preserve battle state on restore", async () => {
  const store = createMemoryChatSessionStore({
    playerId: PLAYER_ID,
    turns: 0,
    messages: [],
    save: createSave({
      inBattle: true,
      enemy: { name: "ウイルスりゅうし", hp: 100, attack: 3, exp: 8, gold: 12, boss: false, rounds: 0 },
      location: "lair",
      hostGreeted: true,
    }),
  });
  await withMockedFetch(
    [modelTool("tool-1", { action: "attack" }), modelText("そのまま すすめ。")],
    async () => {
      const response = await handleChat(createChatRequest("たたかう"), createChatEnv(), undefined, store);
      assert.equal(response.status, 200);
    },
  );
  const stored = await store.read(SESSION_ID);
  assert.equal(stored.save.inBattle, true);
  assert.ok(stored.save.enemy.hp < 100);
});

test("MAX_TOOL_LOOPS returns the last tool output instead of fallback text", async () => {
  const store = createMemoryChatSessionStore({
    playerId: PLAYER_ID,
    turns: 0,
    messages: [],
    save: createSave({ hostGreeted: true }),
  });
  await withMockedFetch(
    Array.from({ length: 12 }, (_, index) => modelTool(`tool-${index}`, { action: "status" })),
    async () => {
      const response = await handleChat(createChatRequest("つよさを みせて"), createChatEnv(), undefined, store);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.match(body.reply, /＊＊ つよさ ＊＊/);
      assert.doesNotMatch(body.reply, /しずかな かぜ/);
    },
  );
});

test("handleChat returns 503 when session writes fail and skips board snapshots", async () => {
  const env = createChatEnv();
  const store = {
    async read() {
      return {
        playerId: PLAYER_ID,
        turns: 0,
        messages: [],
        save: createSave({ gold: 50 }),
      };
    },
    async write() {
      throw new Error("write failed");
    },
  };
  const response = await handleChat(createChatRequest("はじめから やりなおす"), env, undefined, store);
  assert.equal(response.status, 503);
  assert.equal(env.PLAYERS.puts.length, 0);
});

test("handleChat returns 503 when session reads fail", async () => {
  const response = await handleChat(
    createChatRequest("はじめから やりなおす"),
    createChatEnv(),
    undefined,
    {
      async read() {
        throw new Error("read failed");
      },
      async write() {
        throw new Error("should not write");
      },
    },
  );
  assert.equal(response.status, 503);
});

test("createDurableChatSessionStore imports legacy KV only when DO storage is empty", async () => {
  const storage = createStorage();
  const legacyCalls = [];
  const store = createDurableChatSessionStore(
    { storage },
    {
      SESSIONS: {
        async get(key) {
          legacyCalls.push(key);
          return {
            playerId: PLAYER_ID,
            turns: 7,
            messages: [],
            save: createSave({ gold: 444 }),
          };
        },
      },
    },
    { now: () => Date.parse("2026-07-22T12:00:00.000Z") },
  );
  const first = await store.read(SESSION_ID);
  assert.equal(first.turns, 7);
  assert.deepEqual(legacyCalls, [`chat:${SESSION_ID}`]);
  const second = await store.read(SESSION_ID);
  assert.equal(second.save.gold, 444);
  assert.deepEqual(legacyCalls, [`chat:${SESSION_ID}`]);
  assert.equal(storage.puts.length, 1);
});

test("createDurableChatSessionStore propagates storage read failures", async () => {
  const store = createDurableChatSessionStore(
    { storage: createStorage(undefined, { failGet: true }) },
    {},
  );
  await assert.rejects(async () => {
    await store.read(SESSION_ID);
  });
});

test("BrowserChatSession serializes concurrent requests for one session", async () => {
  let activeWrites = 0;
  let maxActiveWrites = 0;
  const storage = createStorage();
  const originalPut = storage.put.bind(storage);
  storage.put = async (key, value) => {
    activeWrites += 1;
    maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await originalPut(key, value);
    activeWrites -= 1;
  };
  const session = new BrowserChatSession({ storage }, createChatEnv());
  const first = session.fetch(createChatRequest("はじめから やりなおす"));
  const second = session.fetch(createChatRequest("はじめから やりなおす"));
  const responses = await Promise.all([first, second]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.equal(maxActiveWrites, 1);
});
