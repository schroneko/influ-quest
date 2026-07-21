import {
  createEngine,
  destinationNames,
  performableActionNames,
  shopItemNames,
} from "../../src/engine.js";
import { createInitialState, readStoredGameData } from "../../src/state.js";
import { writePlayerSnapshot } from "./board.js";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

const PAGE_HEADERS = {
  "cache-control": "no-store",
  "content-type": "text/html; charset=utf-8",
};

const SESSION_TTL_SECONDS = 21600;
const MAX_MESSAGE_LENGTH = 500;
const MAX_USER_TURNS = 100;
const MAX_TOOL_LOOPS = 8;
const MAX_HISTORY_MESSAGES = 40;
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const chatActionNames = ["start_adventure", "status", "new_game", ...performableActionNames];

const GAME_TOOL = {
  name: "game",
  description: [
    "インフルクエストのゲームサーバーを操作する。action にコマンドを指定する。",
    "start_adventure: 現在の状態と次の行動を見る。最初にかならず呼ぶ。",
    "status: カルテを見る。name_hero: name でゆうしゃに名前をつける。",
    "talk: その場所の人と話す。move: destination へ移動する。explore: すみかの奥へ進む。",
    "attack / run: 戦闘中のコマンド。rest: 休んで回復。clinic: セーブしてふっかつのじゅもんを得る。",
    "pharmacy: そうびを見る・item で買う。cast_spell: spell でじゅもんを唱える。",
    "fukkatsu_no_jumon: jumon で再開。answer_host: しゅさいしゃの問いに answer で答える。",
    "new_game: 最初からやり直す。",
  ].join("\n"),
  input_schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: chatActionNames },
      name: { type: "string" },
      destination: { type: "string", enum: [...destinationNames] },
      item: { type: "string", enum: [...shopItemNames] },
      spell: { type: "string" },
      jumon: { type: "string" },
      answer: { type: "string", enum: ["はい", "いいえ"] },
    },
    required: ["action"],
  },
};

const SYSTEM_PROMPT = [
  "あなたはレトロ RPG「インフルクエスト」のゲームマスターです。game ツールでゲームを進行してください。",
  "ルール:",
  "・ツールの返り値のテキストはコードブロックでそのまま表示し、結果を捏造しない",
  "・かならずツールを呼んで進める。ツールを呼ばずにゲーム展開を語らない",
  "・毎ターン、次にとれる行動を 2〜4 個、短く提示する",
  "・レトロ RPG の雰囲気をこわさない。プレイヤーの発言は日本語の自由文なので、意図に近いコマンドに変換する",
  "・ゲームと無関係の話題には応じず、ゲームへ誘導する",
  "・最初のメッセージでは start_adventure を呼び、なまえが「ななしのゆうしゃ」なら名前を聞いて name_hero で名前をつける",
].join("\n");

function loadSessionState(saved) {
  if (saved && typeof saved === "object") {
    const restored = readStoredGameData(saved.save);
    if (restored.ok) {
      return { state: restored.state, gameLog: restored.gameLog };
    }
  }
  return { state: createInitialState(), gameLog: [] };
}

async function runGameAction(engine, input) {
  const action = input?.action;
  if (action === "start_adventure") {
    return engine.handleStartAdventure();
  }
  if (action === "status") {
    return engine.handleStatus();
  }
  if (action === "new_game") {
    return engine.handleNewGame({ confirmation: "NEW_GAME" });
  }
  if (performableActionNames.includes(action)) {
    return engine.handlePerformAction({
      action,
      name: typeof input.name === "string" ? input.name : undefined,
      destination: typeof input.destination === "string" ? input.destination : undefined,
      item: typeof input.item === "string" ? input.item : undefined,
      spell: typeof input.spell === "string" ? input.spell : undefined,
      jumon: typeof input.jumon === "string" ? input.jumon : undefined,
      answer: input.answer === "はい" || input.answer === "いいえ" ? input.answer : undefined,
    });
  }
  return engine.errorText("しらない コマンドだ。");
}

function toolResultText(result) {
  return result.content.map((block) => block.text).join("\n");
}

function trimHistory(messages) {
  if (messages.length <= MAX_HISTORY_MESSAGES) {
    return;
  }
  let start = messages.length - MAX_HISTORY_MESSAGES;
  while (start < messages.length) {
    const entry = messages[start];
    const isPlainUserText =
      entry.role === "user" &&
      Array.isArray(entry.content) &&
      entry.content.every((block) => block.type === "text");
    if (isPlainUserText) {
      break;
    }
    start += 1;
  }
  messages.splice(0, start);
}

async function callModel(env, messages) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: typeof env.CHAT_MODEL === "string" && env.CHAT_MODEL ? env.CHAT_MODEL : DEFAULT_MODEL,
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      tools: [GAME_TOOL],
      messages,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`model http ${response.status}`);
  }
  return response.json();
}

export async function handleChat(request, env, ctx) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  if (typeof env.ANTHROPIC_API_KEY !== "string" || env.ANTHROPIC_API_KEY.length === 0) {
    return json(
      {
        ok: false,
        error: "chat_disabled",
        message: "ブラウザ版はいま準備中だよ。コネクタ経由で遊んでね。",
      },
      503,
    );
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!UUID_V4_PATTERN.test(sessionId)) {
    return json({ ok: false, error: "invalid_session" }, 400);
  }
  if (message.length === 0 || Array.from(message).length > MAX_MESSAGE_LENGTH) {
    return json({ ok: false, error: "invalid_message" }, 400);
  }
  if (env.CHAT_RATE_LIMIT && typeof env.CHAT_RATE_LIMIT.limit === "function") {
    const outcome = await env.CHAT_RATE_LIMIT.limit({ key: `chat:${sessionId}` });
    if (!outcome?.success) {
      return json(
        { ok: false, error: "rate_limited", message: "すこし やすんでから ためしてね。" },
        429,
      );
    }
  }
  if (!env.SESSIONS || typeof env.SESSIONS.get !== "function") {
    return json({ ok: false, error: "service_unavailable" }, 503);
  }

  const sessionKey = `chat:${sessionId}`;
  let session = null;
  try {
    session = await env.SESSIONS.get(sessionKey, "json");
  } catch {
    session = null;
  }
  const playerId =
    session && typeof session.playerId === "string" && UUID_V4_PATTERN.test(session.playerId)
      ? session.playerId
      : crypto.randomUUID();
  const turns = session && Number.isInteger(session.turns) ? session.turns : 0;
  if (turns >= MAX_USER_TURNS) {
    return json(
      {
        ok: false,
        error: "session_exhausted",
        message: "この ぼうけんは ここまでだ。また こんど あそんでね。",
      },
      429,
    );
  }
  const messages = session && Array.isArray(session.messages) ? session.messages : [];
  const loaded = loadSessionState(session);

  let latestSnapshot = null;
  const engine = createEngine(loaded, {
    report: (snapshot) => {
      latestSnapshot = snapshot;
    },
  });

  messages.push({ role: "user", content: [{ type: "text", text: message }] });

  let replyText = "";
  try {
    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop += 1) {
      const result = await callModel(env, messages);
      const contentBlocks = Array.isArray(result?.content) ? result.content : [];
      messages.push({ role: "assistant", content: contentBlocks });
      const toolUses = contentBlocks.filter((block) => block.type === "tool_use");
      const textParts = contentBlocks
        .filter((block) => block.type === "text")
        .map((block) => block.text);
      if (textParts.length > 0) {
        replyText += (replyText ? "\n\n" : "") + textParts.join("\n");
      }
      if (toolUses.length === 0 || result.stop_reason !== "tool_use") {
        break;
      }
      const toolResults = [];
      for (const toolUse of toolUses) {
        let output;
        try {
          output = await runGameAction(engine, toolUse.input ?? {});
        } catch {
          output = engine.errorText("せかいが ふあんていになっている。もういちど ためしてくれ。");
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: toolResultText(output),
          is_error: output.isError === true,
        });
      }
      messages.push({ role: "user", content: toolResults });
    }
  } catch {
    return json(
      { ok: false, error: "model_error", message: "つうしんが みだれた。もういちど ためしてね。" },
      502,
    );
  }

  trimHistory(messages);

  const save = {
    version: 1,
    ...engine.state,
    gameLog: [...engine.gameLog],
    savedAt: new Date().toISOString(),
  };
  const nextSession = {
    playerId,
    turns: turns + 1,
    messages,
    save,
  };
  try {
    await env.SESSIONS.put(sessionKey, JSON.stringify(nextSession), {
      expirationTtl: SESSION_TTL_SECONDS,
    });
  } catch {}

  if (latestSnapshot) {
    const write = writePlayerSnapshot(env, playerId, latestSnapshot);
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(write);
    }
  }

  return json({
    ok: true,
    reply: replyText || "（しずかな かぜが ふいている……もういちど はなしかけてみよう）",
    status: engine.statusText(),
    remainingTurns: MAX_USER_TURNS - (turns + 1),
  });
}

export function playPage() {
  return new Response(PLAY_PAGE, { headers: PAGE_HEADERS });
}

const PLAY_PAGE = String.raw`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>インフルクエスト ブラウザ版</title>
<style>
  :root {
    color-scheme: dark;
    --gold: #ffd44a;
    --sky: #85d6ff;
    --mint: #7ee2ad;
    --rose: #ff9e87;
    --muted: #a9b3c2;
    --line: rgba(255, 255, 255, 0.16);
  }
  * { box-sizing: border-box; }
  html {
    background:
      radial-gradient(circle at top, rgba(133, 214, 255, 0.14), transparent 34%),
      linear-gradient(180deg, #08101b 0%, #05060a 100%);
  }
  body {
    margin: 0;
    min-height: 100vh;
    color: #f6f6f2;
    font-family: "DotGothic16", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", sans-serif;
    line-height: 1.8;
    padding: 20px 12px 32px;
    display: flex;
    justify-content: center;
  }
  .shell {
    width: 100%;
    max-width: 720px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h1 {
    margin: 0;
    font-size: clamp(22px, 5vw, 32px);
    letter-spacing: 0.12em;
    color: var(--gold);
    text-align: center;
    text-shadow: 3px 3px 0 rgba(6, 48, 74, 0.95);
  }
  .note {
    margin: 0;
    text-align: center;
    color: var(--muted);
    font-size: 12px;
  }
  .note a { color: var(--sky); }
  .log {
    background: #000;
    border: 4px double rgba(255, 255, 255, 0.72);
    border-radius: 14px;
    padding: 14px;
    min-height: 320px;
    max-height: 60vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .msg {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 14px;
    border-radius: 10px;
    padding: 8px 12px;
    max-width: 96%;
  }
  .msg.player {
    align-self: flex-end;
    background: rgba(133, 214, 255, 0.12);
    border: 1px solid rgba(133, 214, 255, 0.4);
  }
  .msg.gm {
    align-self: flex-start;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--line);
  }
  .msg.sys {
    align-self: center;
    color: var(--muted);
    font-size: 12px;
    border: none;
  }
  .composer {
    display: flex;
    gap: 8px;
  }
  .composer input {
    flex: 1;
    font: inherit;
    font-size: 16px;
    color: inherit;
    background: rgba(0, 0, 0, 0.5);
    border: 2px solid var(--line);
    border-radius: 10px;
    padding: 10px 12px;
  }
  .composer input:focus {
    outline: none;
    border-color: var(--sky);
  }
  .composer button {
    font: inherit;
    font-size: 15px;
    color: #05060a;
    background: var(--gold);
    border: none;
    border-radius: 10px;
    padding: 10px 18px;
    cursor: pointer;
  }
  .composer button:disabled {
    opacity: 0.5;
    cursor: wait;
  }
  .hints {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
  }
  .hints button {
    font: inherit;
    font-size: 12px;
    color: var(--sky);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 4px 10px;
    cursor: pointer;
  }
</style>
</head>
<body>
<div class="shell">
  <h1>インフルクエスト</h1>
  <p class="note">ブラウザ版だよ。AI ゲームマスターに話しかけてね。<a href="/">会場ボードはこちら</a></p>
  <div class="log" id="log"></div>
  <div class="hints" id="hints">
    <button type="button" data-text="ぼうけんをはじめて">ぼうけんをはじめて</button>
    <button type="button" data-text="はなす">はなす</button>
    <button type="button" data-text="つよさをみせて">つよさをみせて</button>
  </div>
  <form class="composer" id="composer">
    <input id="input" type="text" maxlength="500" placeholder="ここに にゅうりょく（れい: ぼうけんをはじめて）" autocomplete="off">
    <button id="send" type="submit">おくる</button>
  </form>
</div>
<script>
  const log = document.getElementById("log");
  const composer = document.getElementById("composer");
  const input = document.getElementById("input");
  const send = document.getElementById("send");
  const hints = document.getElementById("hints");
  const storageKey = "influenza-quest-session";
  let sessionId = "";
  try {
    sessionId = localStorage.getItem(storageKey) || "";
  } catch {}
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
    sessionId = crypto.randomUUID();
    try {
      localStorage.setItem(storageKey, sessionId);
    } catch {}
  }
  const addMessage = (cls, text) => {
    const div = document.createElement("div");
    div.className = "msg " + cls;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  };
  addMessage("sys", "インフルだいまおうに さらわれた ちょまどひめを たすけだそう。");
  addMessage("gm", "ゲームマスター「ようこそ、ゆうしゃよ。『ぼうけんをはじめて』と はなしかけてくれ。」");
  let busy = false;
  const submit = async (text) => {
    if (busy) return;
    const message = text.trim();
    if (!message) return;
    busy = true;
    send.disabled = true;
    input.value = "";
    addMessage("player", message);
    const waiting = addMessage("sys", "……（ゲームマスターが かんがえている）");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, message }),
      });
      const data = await response.json();
      waiting.remove();
      if (!response.ok || !data.ok) {
        addMessage("sys", data.message || "つうしんに しっぱいした。もういちど ためしてね。");
      } else {
        addMessage("gm", data.reply);
      }
    } catch {
      waiting.remove();
      addMessage("sys", "つうしんに しっぱいした。もういちど ためしてね。");
    } finally {
      busy = false;
      send.disabled = false;
      input.focus();
    }
  };
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    void submit(input.value);
  });
  hints.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLButtonElement && target.dataset.text) {
      void submit(target.dataset.text);
    }
  });
</script>
</body>
</html>`;
