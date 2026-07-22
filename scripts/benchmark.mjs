import { randomUUID } from "node:crypto";

const args = process.argv.slice(2).filter((value) => value !== "--full");
const fullMode = process.argv.includes("--full");
const baseUrl = (args[0] ?? "https://influ-quest.nukoevi.app").replace(/\/+$/, "");
const sessionId = randomUUID();
const heroName = "べんち" + sessionId.slice(0, 4);

async function sendChat(message) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 6000));
    }
    const startedAt = Date.now();
    try {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, message }),
      });
      const data = await response.json();
      if (response.ok && data.ok) {
        return { data, elapsedMs: Date.now() - startedAt, error: null };
      }
      if (attempt === 2) {
        return { data, elapsedMs: Date.now() - startedAt, error: `http ${response.status} ${data?.error ?? ""}` };
      }
    } catch (cause) {
      if (attempt === 2) {
        return { data: null, elapsedMs: Date.now() - startedAt, error: String(cause) };
      }
    }
  }
  return { data: null, elapsedMs: 0, error: "unreachable" };
}

if (fullMode) {
  const startedAt = Date.now();
  let inputs = 0;
  let status = "";
  let reply = "";
  const decide = () => {
    if (inputs === 0) return "ぼうけんをはじめて";
    if (inputs === 1) return "なまえは " + heroName + " で";
    if (status.includes("せんとうちゅう")) return "たたかって";
    if (reply.includes("はんぶんを") || reply.includes("うけとってくれるな")) return "いいえ";
    if (
      reply.includes("こえを かけよう") ||
      reply.includes("うずくまって") ||
      reply.includes("さがそう")
    ) {
      return "はなす";
    }
    if (status.includes("ちょまどひめを かついでいる")) {
      return "おおてまちじょうへ もどって ひめを ステージへ とどけて";
    }
    if (status.includes("いま いる ばしょ: おおてまちじょう")) {
      if (!status.includes("ぼうけんタイム")) return "はなす";
      return "まもりのまちへ いって";
    }
    if (status.includes("いま いる ばしょ: まもりのまち")) {
      if (status.includes("じょうたい: インフルエンザ")) return "きゅうけいしつで やすんで";
      if (status.includes("ぶき: たいおんけい")) return "アルコールスプレーを かって";
      if (status.includes("ぼうぐ: ふだんぎ") && !/ゴールド: [0-9]?[0-9]\n/.test(status + "\n")) {
        return "ファントムマスクを かって";
      }
      return "ウイルスのすみかへ いって";
    }
    return "おくへ すすんで";
  };
  for (let turn = 0; turn < 30; turn += 1) {
    const message = decide();
    const { data, elapsedMs, error } = await sendChat(message);
    inputs += 1;
    if (error) {
      console.log(`[ERR] ${message} -> ${error}`);
      continue;
    }
    reply = data.reply ?? "";
    status = data.status ?? status;
    const place = (status.split("\n").find((line) => line.includes("ばしょ")) ?? "").trim();
    console.log(`[${String(inputs).padStart(2)}] ${message} (${elapsedMs}ms) ${place}`);
    if (status.includes("クリアずみ") || status.includes("チートクリア")) {
      break;
    }
  }
  const wallMs = Date.now() - startedAt;
  const timeLine = (status.split("\n").find((line) => line.includes("ぼうけんタイム")) ?? "").trim();
  console.log("");
  console.log(`inputs: ${inputs}`);
  console.log(`wall: ${Math.round(wallMs / 1000)}s`);
  console.log(timeLine ? `ingame: ${timeLine}` : "ingame: (no timer line)");
  const cleared = status.includes("クリアずみ") || status.includes("チートクリア");
  console.log(cleared ? "RESULT: CLEARED" : "RESULT: NOT CLEARED");
  process.exit(cleared ? 0 : 1);
}

const scenario = [
  "ぼうけんをはじめて。ゆうしゃの なまえは「" + heroName + "」だ。",
  "はなす",
  "まもりのまちへ いって ぶきやを みせて",
  "アルコールスプレーを かって",
  "ぼうぐやで N95マスクを かって",
  "すみかへ いって おくへ すすんで",
];

const checks = [
  { name: "markdown-bold", test: (reply) => !reply.includes("**") },
  { name: "markdown-heading", test: (reply) => !/^#{1,6} /m.test(reply) },
  { name: "markdown-bullet", test: (reply) => !/^\s*[-*] /m.test(reply) },
  { name: "label-colon", test: (reply) => !reply.includes("とれる行動") && !reply.includes("行動：") },
  { name: "business-phrase", test: (reply) => !/(承知しました|かしこまりました|了解しました|お手伝い|いたします)/.test(reply) },
  { name: "length", test: (reply) => Array.from(reply).length <= 1400 },
];

const results = [];
let closingQuestionCount = 0;
let questionEndingCount = 0;
let lastStatus = "";

for (const message of scenario) {
  const startedAt = Date.now();
  let data = null;
  let error = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    error = null;
    try {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, message }),
      });
      data = await response.json();
      if (!response.ok || !data.ok) {
        error = `http ${response.status} ${data?.error ?? ""}`;
      }
    } catch (cause) {
      error = String(cause);
    }
    if (!error) {
      break;
    }
  }
  const elapsedMs = Date.now() - startedAt;
  const reply = data?.reply ?? "";
  const violations = error ? ["request-failed: " + error] : checks.filter((check) => !check.test(reply)).map((check) => check.name);
  if (/どうしますか/.test(reply)) {
    closingQuestionCount += 1;
  }
  if (/[?？]\s*$/.test(reply)) {
    questionEndingCount += 1;
  }
  if (typeof data?.status === "string") {
    lastStatus = data.status;
  }
  results.push({ message, elapsedMs, violations, reply });
}

if (closingQuestionCount >= 3) {
  results.push({
    message: "(全体)",
    elapsedMs: 0,
    violations: ["repeated-closing-question"],
    reply: "",
  });
}

if (questionEndingCount >= 4 && closingQuestionCount >= 3) {
  results.push({
    message: "(全体)",
    elapsedMs: 0,
    violations: ["repetitive-question-endings"],
    reply: "",
  });
}

const progressed =
  lastStatus.includes("ウイルスのすみか") &&
  (lastStatus.includes("アルコールスプレー") || lastStatus.includes("でんせつのワクチンソード"));
if (!progressed) {
  results.push({
    message: "(全体)",
    elapsedMs: 0,
    violations: ["no-progress"],
    reply: lastStatus,
  });
}

if (lastStatus.includes("クリアずみ")) {
  results.push({
    message: "(全体)",
    elapsedMs: 0,
    violations: ["auto-cleared-without-player-choice"],
    reply: lastStatus,
  });
}

const failed = results.filter((entry) => entry.violations.length > 0);
const latencies = results.filter((entry) => entry.elapsedMs > 0).map((entry) => entry.elapsedMs).sort((a, b) => a - b);
const p50 = latencies[Math.floor(latencies.length / 2)] ?? 0;
const max = latencies.at(-1) ?? 0;

console.log(`base: ${baseUrl}`);
console.log(`session: ${sessionId}`);
console.log(`turns: ${scenario.length}  p50: ${p50}ms  max: ${max}ms`);
console.log("");
for (const entry of results) {
  const mark = entry.violations.length === 0 ? "PASS" : "FAIL";
  console.log(`[${mark}] ${entry.message} (${entry.elapsedMs}ms)${entry.violations.length ? " -> " + entry.violations.join(", ") : ""}`);
  if (entry.violations.length > 0 && entry.reply) {
    console.log("---- reply ----");
    console.log(entry.reply);
    console.log("---------------");
  }
}
console.log("");
console.log(failed.length === 0 ? "RESULT: PASS" : `RESULT: FAIL (${failed.length} turns)`);
process.exit(failed.length === 0 ? 0 : 1);
