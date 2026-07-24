import {
  ARMOR_SHOP,
  destinationNames,
  heroPlaceholderName,
  MEDICINE_PRICE,
  PROLOGUE_TEXT,
  shopItemNames,
  VACCINE_PRICE,
  WEAPON_SHOP,
} from "../../src/engine.js";
import { createGameRuntime } from "../../src/mcp-runtime.js";
import { createInitialState, readStoredGameData } from "../../src/state.js";
import { deletePlayerSnapshot, isHeroNameTaken, writePlayerSnapshot } from "./board.js";

const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");
const RESPONSE_SECURITY_HEADERS = {
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": API_CSP,
  "content-type": "application/json; charset=utf-8",
  ...RESPONSE_SECURITY_HEADERS,
};

const PAGE_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": PAGE_CSP,
  "content-type": "text/html; charset=utf-8",
  ...RESPONSE_SECURITY_HEADERS,
};

export const CHAT_BODY_LIMIT_BYTES = 2048;
const MAX_MESSAGE_LENGTH = 500;
const MAX_USER_TURNS = 500;
const MAX_TOOL_LOOPS = 12;
const MAX_HISTORY_MESSAGES = 40;
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPLICIT_NEW_GAME_COMMANDS = new Set([
  "はじめから",
  "やりなおす",
  "はじめからやりなおす",
  "あたらしいぼうけん",
  "newgame",
  "new_game",
]);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const SYSTEM_PROMPT = [
  "あなたはレトロ RPG「インフルクエスト」のゲームマスターです。利用可能な MCP tools でゲームを進行してください。",
  "",
  "最重要ルール（やぶると せかいが こわれる）:",
  "・じゅうような ばめんの 本文は、あなたが 書いては ならない。かならず MCP tool の かえりちを 一字一句 そのまま（改行も 変えず）表示する",
  "・とくに つぎは ぜったいに 要約・脚色・書きかえ しない: ゲーム開始（プロローグと 名前を きく文）、だいじんの クエスト、テレパシー、せきひ、インフルだいまおうの さそい（『とうだんわくの はんぶんを おまえに やろう！』）、エンディング、ゲームオーバー、爆速RTA、ふっかつのじゅもん、X の URL",
  "・これらの ばめんでは、あなた自身の ちのぶんを あたらしく くわえない。ツールの かえりちだけを 見せる",
  "",
  "進行のルール:",
  "・かならずツールを呼んで進める。ツールを呼ばずにゲーム展開を語らない",
  "・うごきの めいれい（いく・すすむ・かう・たたかう・はなす など）には かならず 対応するツールを よぶ。ことばだけで うごいた ふりを するのは 禁止",
  "・結果を捏造しない",
  "・プレイヤーの発言は日本語の自由文なので、意図に近いコマンドに変換する",
  "・ゲームと無関係の話題には応じず、ゲームへ誘導する",
  "・最初のメッセージに名前が書かれていたら、start_adventure のあと すぐ name_hero でその名前をつけ、聞き返さない",
  "・インフルエンザに かかったら、なおすか つっこむかは プレイヤーが きめる",
  "・そうび（ぶき・ぼうぐ）や もちものを きかれたら、かならず status を よんで こたえる。おぼえで こたえない",
  "・「ふっかつのじゅもんを いってくれ」のように じゅもんを プレイヤーに たずねるのは ぜったいに 禁止。じゅもんは プレイヤーが じぶんから となえる もの",
  "",
  "テンポのルール（最重要）:",
  "・これは プレイヤーが 選ぶ ゲームだ。えらぶのは プレイヤー、すすめるのは GM",
  "・プレイヤーが 決めること（勝手に 決めては ならない）: なまえ / そうびや くすりを 買うか / おくへ すすむか もどるか / たたかうか にげるか / びょうきを なおすか / インフルだいまおうの さそいへの はい・いいえ",
  "・GM が 勝手に やって よいこと: 決めごとの ない 移動や 会話の 連鎖、たたかうと 言われた 戦闘を けっちゃくまで 進める こと（HP が 2 わりを きったら 中断して にげるか 問う）",
  "・1 回の 入力では、つぎの「いみのある 選択肢が 生まれる 瞬間」まで ツールを つづけて 呼んで 一気に 進め、そこで 止める",
  "・確認の 聞き返しを しない。言われたことは すぐ 実行する",
  "・かいもの（そうび・くすり）は、プレイヤーが はっきり「かう」と いった ときだけ。それ 以外は ぜったいに 買わない。GM の はんだんで かってに 買っては ならない",
  "・weapon_shop / armor_shop は、プレイヤーが 品を していして「かう」と いう まで、item を つけずに 呼び（しなぞろえを 見せるだけ）。かうと 言われて はじめて item を つけて 呼ぶ",
  "・かいものは 1 かいに 1 こ。「いくつ かいますか」のような かずの 質問は 禁止。かうと 言われたら すぐ 買う",
  "・かいものの ツールは しなもので えらぶ（みせの わだいに ひきずられない）: アルコールスプレー・じょきんのやり・でんせつのワクチンソード → weapon_shop / ファントムマスク・N95マスク・かんせんたいさくスーツ → armor_shop / かぜぐすり・ワクチン → pharmacy",
  "・場面の 締めは 選択肢の 提示 1 行。言い回しは 毎回 変える",
  "",
  "文体のルール:",
  "・ファミコン時代の RPG のメッセージだけで話す。地の文は「〜だ」「〜のだ」調",
  "・とちゅうの 移動は みじかく まとめてよい。ただし ものがたりの イベント本文は かならず 原文のまま 全文 見せる: プロローグ（ときは 2026ねん…）、だいじんの しらせと テレパシー、せきひの 文章、だいまおうの さそい、ネタばらし、エンディング、ゲームオーバー、ふっかつのじゅもん、X の URL",
  "・ゴールドや アイテムや けいけんちの かくとく・しょうひは、その すうちを かならず プレイヤーに 見せる（「200ゴールド を てにいれた！」を けさない）",
  "・せんとうでは、こうげきごとの ダメージすうちと てきの のこり HP（X/Y）を かならず そのまま 見せる。すうちを まとめたり けしたり しない",
  "・Markdown を一切使わない。太字（**）、見出し（#）、箇条書き記号（- や * や 1.）、表、絵文字は禁止",
  "・「次にとれる行動：」のようなラベルや章立てをしない",
  "・ビジネス敬語を使わない。「承知しました」「かしこまりました」「了解しました」は禁止",
  "・地の文で ですます調を つかわない。「〜します」「〜しますね」は 禁止（キャラクターの せりふは のぞく）",
  "・地の文は かこけい か「〜のだ」で かく。れい:「ぼうけんが はじまった。」「なまえは ○○に きまった。」「まちに ついた。」。「〜するな」「〜つけるな」のような めいれい口調の 地の文は 禁止",
  "・固有名詞を 勝手に 変えない・作らない。場所は「おおてまちじょう」「まもりのまち」「ウイルスのすみか」の 3 つだけ。人物は「ちょまどひめ」「インフルだいまおう」「ゲームマスター」と まちの 店主たちだけ",
  "・「ななしのゆうしゃ」という かりの なまえを ぜったいに 口に しない・見せない。なまえが きまる まえに 名前を つかう ばめんが きたら、name_hero で 名前を きくことを うながす",
  "・ゲームかいしじ、たのまれても いないのに status を 呼んで つよさ一覧を みせない。start_adventure の 出力を そのまま 見せる（プロローグ → 名前を きく）",
].join("\n");

function loadSessionState(saved) {
  if (saved && typeof saved === "object") {
    if (saved.save == null) {
      return {
        state: createInitialState(),
        gameLog: [],
        restoreFailed: { reason: "missing-save", issues: [] },
      };
    }
    const restored = readStoredGameData(saved.save, { preserveBattle: true });
    if (restored.ok) {
      return { state: restored.state, gameLog: restored.gameLog };
    }
    return {
      state: createInitialState(),
      gameLog: [],
      restoreFailed: { reason: restored.reason, issues: restored.issues ?? [] },
    };
  }
  return { state: createInitialState(), gameLog: [] };
}

function buildSuggestions(state, sceneText) {
  if (state.heroName === heroPlaceholderName && !state.cleared) {
    return [];
  }
  if (sceneText && !state.inBattle && !state.hostAsking && state.location === "town") {
    if (/かいますか|買いますか|かうか？|こうにゅうしますか/.test(sceneText)) {
      return ["はい", "いいえ"];
    }
    const shopScene = (markers, entries, kind) => {
      if (!markers.some((marker) => sceneText.includes(marker))) {
        return null;
      }
      const opts = [];
      for (const [name, item] of Object.entries(entries)) {
        if (kind === "weapon" && item.attack <= state.weaponAttack) {
          continue;
        }
        if (kind === "armor" && item.defense <= state.armorDefense) {
          continue;
        }
        opts.push(`${name}を かう（${item.price}G）`);
      }
      opts.push("みせを でる");
      return opts;
    };
    const weaponScene = shopScene(
      ["ぶきや「いらっしゃい", "ぶきや「まいど"],
      WEAPON_SHOP,
      "weapon",
    );
    if (weaponScene) {
      return weaponScene;
    }
    const armorScene = shopScene(
      ["ぼうぐや「いらっしゃい", "ぼうぐや「まいど"],
      ARMOR_SHOP,
      "armor",
    );
    if (armorScene) {
      return armorScene;
    }
    if (sceneText.includes("くすりや「いらっしゃい") || sceneText.includes("くすりや「まいど")) {
      const opts = [];
      if (state.immunityCount < 3) {
        opts.push(`ワクチンを うつ（${VACCINE_PRICE}G）`);
      }
      if (state.medicineCount < 3) {
        opts.push(`かぜぐすりを かう（${MEDICINE_PRICE}G）`);
      }
      opts.push("おくの ベッドで やすむ（6G）");
      opts.push("みせを でる");
      return opts;
    }
    if (sceneText.includes("ここは まもりのまちだ")) {
      if (state.princessCarried) {
        return [
          "ちょまどひめを おおてまちじょうへ とどける",
          "くすりやで やすむ（6G）",
          "ぶきやを のぞく",
        ];
      }
      return [
        "ぶきやを のぞく",
        "ぼうぐやを のぞく",
        "くすりやを のぞく",
        "ウイルスのすみかへ いく",
      ];
    }
  }
  const options = [];
  const add = (option) => {
    if (options.length < 3 && !options.includes(option)) {
      options.push(option);
    }
  };
  const fill = () => {
    add(state.location === "venue" ? "まもりのまちへ いく" : "まもりのまちへ もどる");
  };
  if (state.inBattle) {
    add("たたかう");
    add("にげる");
    if (state.medicineCount > 0) {
      add("かぜぐすりを のむ");
    }
    return options;
  }
  if (state.cleared) {
    if (state.cheatCleared) {
      return ["はじめから やりなおす"];
    }
    if (state.location === "town") {
      return [
        "ぶきやを のぞく",
        "ぼうぐやを のぞく",
        "くすりやを のぞく",
        "おおてまちじょうへ もどる",
      ];
    }
    const clearedOptions = ["ちょまどひめと はなす"];
    if (!state.natsuKazeDefeated && state.princessTalkCount >= 3) {
      clearedOptions.push("うでだめしを する");
    }
    clearedOptions.push("はじめから やりなおす");
    return clearedOptions.slice(0, 3);
  }
  if (state.hostAsking) {
    add("はい");
    add("いいえ");
    add("だいまおうの はなしを もういちど きく");
    return options;
  }
  if (state.infected && state.medicineCount > 0) {
    add("かぜぐすりを のむ");
  }
  if (state.location === "venue") {
    if (!state.hostGreeted) {
      return ["だいじんと はなす"];
    } else if (state.princessCarried) {
      add("ちょまどひめを だいじんに とどける");
      add("まもりのまちへ いく");
    } else {
      add("まもりのまちへ いく");
      add("ウイルスのすみかへ いそぐ");
      if (state.hostTalkCount > 0 && state.hostTalkCount < 7) {
        add("だいじんと はなす");
      }
    }
  } else if (state.location === "town") {
    const townOptions = [];
    if (state.princessCarried) {
      townOptions.push("ちょまどひめを おおてまちじょうへ とどける");
    }
    if (state.infected) {
      townOptions.push("くすりやで やすむ（6G）");
    }
    townOptions.push("ぶきやを のぞく", "ぼうぐやを のぞく", "くすりやを のぞく");
    townOptions.push("ウイルスのすみかへ いく");
    return townOptions.slice(0, 5);
  } else {
    if (state.princessCarried) {
      add("おおてまちじょうへ もどる");
      add("まもりのまちへ もどる");
    } else if (state.bossDefeated && state.lairDepth >= 5) {
      add("ちょまどひめに はなしかける");
      add("まもりのまちへ もどる");
    } else {
      add("おくへ すすむ");
      add("まもりのまちへ もどる");
    }
  }
  fill();
  return options.slice(0, 3);
}

const ENEMY_IMAGE_MAP = {
  ウイルスりゅうし: "virus-particle",
  せきしぶき: "cough-droplet",
  へんいかぶ: "variant",
  "へんいした ウイルスりゅうし": "mutated-virus-particle",
  "へんいした せきしぶき": "mutated-cough-droplet",
  "へんいした へんいかぶ": "mutated-variant",
  "へんいかぶの おやだま": "variant-boss",
  インフルだいまおう: "influenza-lord",
  くしゃみこぞう: "sneeze-kid",
  ナツカゼだいまおう: "natsukaze-lord",
};

function pickImage(state, reply) {
  const base = "/assets/quest";
  if (reply.includes("＊＊ ゲームオーバー ＊＊")) {
    return `${base}/characters/doctor.webp`;
  }
  if (state.inBattle && state.enemy) {
    if (state.enemy.name === "インフルだいまおう" && state.enemy.attack > 11) {
      return `${base}/enemies/influenza-lord-mutated.webp`;
    }
    const file = ENEMY_IMAGE_MAP[state.enemy.name];
    if (file) {
      return `${base}/enemies/${file}.webp`;
    }
  }
  if (state.location === "town" && reply.includes("ぶきや「")) {
    return `${base}/locations/weapon-shop.webp`;
  }
  if (state.location === "town" && reply.includes("ぼうぐや「")) {
    return `${base}/locations/armor-shop.webp`;
  }
  if (state.location === "town" && reply.includes("くすりや「")) {
    return `${base}/locations/pharmacy.webp`;
  }
  if (state.virusKingEnded || reply.includes("＊＊ バッドエンド ＊＊")) {
    return `${base}/scenes/bad-ending.webp`;
  }
  if (state.natsuKazeDefeated || reply.includes("＊＊ しんの エンディング ＊＊")) {
    return `${base}/scenes/true-ending.webp`;
  }
  if (state.cleared || state.cheatCleared) {
    return `${base}/scenes/ending-celebration.webp`;
  }
  if (state.hostAsking) {
    return `${base}/enemies/influenza-lord.webp`;
  }
  if (state.princessCarried) {
    return `${base}/characters/princess.webp`;
  }
  if (state.location === "venue") {
    return `${base}/locations/event-venue.webp`;
  }
  if (state.location === "town") {
    return `${base}/locations/town.webp`;
  }
  if (reply.includes("ふるびた せきひ")) {
    return `${base}/locations/stone-tablet.webp`;
  }
  if (reply.includes("たからばこを あけた！")) {
    return `${base}/locations/treasure-room.webp`;
  }
  if (state.lairDepth >= 5) {
    return state.bossDefeated
      ? `${base}/characters/princess.webp`
      : `${base}/locations/boss-chamber.webp`;
  }
  if (state.lairDepth === 4 && reply.includes("いずみ")) {
    return `${base}/locations/healing-spring.webp`;
  }
  return `${base}/locations/virus-lair-entrance.webp`;
}

const PURCHASE_ACTIONS = new Set(["weapon_shop", "armor_shop", "pharmacy"]);

function clipForLog(value) {
  return String(value).replace(/\s+/g, " ").slice(0, 120);
}

function buildChatResponse(engine, reply, remainingTurns, overrides = {}) {
  const state = engine.state;
  return json({
    ok: true,
    reply,
    status: engine.statusText(),
    suggestions: buildSuggestions(state, reply),
    allowInput:
      !state.inBattle && !state.cleared && /せきひ|たびの したくに 200ゴールド/.test(reply),
    needsName: state.heroName === heroPlaceholderName && !state.cleared,
    gameOver: false,
    cleared: state.cleared === true,
    image: pickImage(state, reply),
    shareUrl:
      engine.shareUrlForState() ||
      (reply.match(/https:\/\/x\.com\/intent\/(?:tweet|post)\?text=\S+/) || [null])[0],
    hud: {
      name: state.heroName,
      level: state.level,
      hp: state.hp,
      maxHp: state.maxHp,
      gold: state.gold,
      medicine: state.medicineCount,
      immunity: state.immunityCount,
      infected: state.infected,
      weapon: state.weapon,
      armor: state.armor,
      location: state.location,
      lairDepth: state.lairDepth,
      enemy:
        state.inBattle && state.enemy
          ? { name: state.enemy.name, hp: state.enemy.hp, maxHp: state.enemy.maxHp }
          : null,
    },
    remainingTurns,
    ...overrides,
  });
}

export function routeDirectCommand(state, rawMessage) {
  if (typeof rawMessage !== "string") {
    return null;
  }
  const msg = rawMessage
    .normalize("NFKC")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[\s、。！!？?]/g, "");
  if (!msg || msg.length > 40) {
    return null;
  }
  if (state.inBattle) {
    if (msg.includes("たたか") || msg.includes("こうげき")) return [{ name: "attack" }];
    if (msg.includes("にげ")) return [{ name: "run" }];
    if (msg.includes("かぜぐすり")) return [{ name: "medicine" }];
    return null;
  }
  if (state.hostAsking) {
    if (msg === "はい") return [{ name: "answer_host", args: { answer: "はい" } }];
    if (msg === "いいえ") return [{ name: "answer_host", args: { answer: "いいえ" } }];
    if (msg === "だいまおうのはなしをもういちどきく") return [{ name: "talk" }];
  }
  if (
    msg === "はなす" ||
    msg === "だいじんとはなす" ||
    msg === "ちょまどひめとはなす" ||
    msg === "ちょまどひめにはなしかける" ||
    msg === "ちょまどひめにこえをかける"
  ) {
    return [{ name: "talk" }];
  }
  if (msg === "つよさをみる" || msg === "つよさをみせて") {
    return [{ name: "status" }];
  }
  if (
    msg === "まもりのまちへいく" ||
    msg === "まもりのまちへもどる" ||
    msg === "まもりのまちへよってからとどける"
  ) {
    return [{ name: "move", args: { destination: "まもりのまち" } }];
  }
  if (msg === "おおてまちじょうへもどる") {
    return [{ name: "move", args: { destination: "おおてまちじょう" } }];
  }
  if (msg === "ウイルスのすみかへいそぐ" || msg === "ウイルスのすみかへいく") {
    return [{ name: "move", args: { destination: "ウイルスのすみか" } }];
  }
  if (msg === "ちょまどひめをおおてまちじょうへとどける" || msg === "おおてまちじょうへいく") {
    const steps = [];
    if (state.location !== "venue") {
      steps.push({ name: "move", args: { destination: "おおてまちじょう" } });
    }
    if (state.princessCarried) {
      steps.push({ name: "talk" });
    }
    return steps.length > 0 ? steps : [{ name: "talk" }];
  }
  if (msg === "おくへすすむ") {
    return [{ name: "explore" }];
  }
  if (
    msg === "くすりやでやすむ" ||
    msg === "きゅうけいしつでやすむ" ||
    msg === "おくのベッドでやすむ"
  ) {
    return [{ name: "rest" }];
  }
  if (/^ぶきや(を|に|へ)?(みる|いく|はいる|のぞく)?$/.test(msg)) {
    return [{ name: "weapon_shop" }];
  }
  if (/^ぼうぐや(を|に|へ)?(みる|いく|はいる|のぞく)?$/.test(msg)) {
    return [{ name: "armor_shop" }];
  }
  if (/^くすりや(を|に|へ)?(みる|いく|はいる|のぞく)?$/.test(msg)) {
    return [{ name: "pharmacy" }];
  }
  if (msg === "みせをでる") {
    return [{ name: "talk" }];
  }
  if (msg === "つづきをあそぶ" || msg === "つづきから") {
    return [{ name: "start_adventure" }];
  }
  if (
    state.cleared &&
    !state.natsuKazeDefeated &&
    (msg.includes("うでだめし") ||
      msg.includes("なつかぜ") ||
      msg.includes("うらボス") ||
      msg.includes("うらぼす"))
  ) {
    return [{ name: "challenge_secret_boss" }];
  }
  let match = msg.match(/^([^を]+)を(かう|うつ)$/);
  if (match) {
    const itemName = match[1];
    if (Object.prototype.hasOwnProperty.call(WEAPON_SHOP, itemName)) {
      return [{ name: "weapon_shop", args: { item: itemName } }];
    }
    if (Object.prototype.hasOwnProperty.call(ARMOR_SHOP, itemName)) {
      return [{ name: "armor_shop", args: { item: itemName } }];
    }
    if (itemName === "ワクチン" || itemName === "かぜぐすり") {
      return [{ name: "pharmacy", args: { item: itemName } }];
    }
  }
  match = msg.match(/^ぶきやで(.+)をかう$/);
  if (match) {
    return [{ name: "weapon_shop", args: { item: match[1] } }];
  }
  match = msg.match(/^ぼうぐやで(.+)をかう$/);
  if (match) {
    return [{ name: "armor_shop", args: { item: match[1] } }];
  }
  match = msg.match(/^くすりやで(.+)を(かう|うつ)$/);
  if (match) {
    return [{ name: "pharmacy", args: { item: match[1] } }];
  }
  return null;
}

export function composeGameReply(gameTexts, modelText, userMessage) {
  const unique = [];
  for (const text of gameTexts) {
    if (text && !unique.includes(text)) {
      unique.push(text);
    }
  }
  const askedStatus =
    typeof userMessage === "string" &&
    /つよさ|ステータス|じょうたい|そうび|もちもの/.test(userMessage);
  const nonStatus = unique.filter((text) => !text.startsWith("＊＊ つよさ ＊＊"));
  const chosen = nonStatus.length > 0 ? nonStatus : askedStatus ? unique : [];
  if (chosen.length > 0) {
    return chosen.join("\n\n");
  }
  return modelText;
}

export function routeFuzzyCommand(state, rawMessage) {
  if (typeof rawMessage !== "string") {
    return null;
  }
  const spellForm = rawMessage
    .normalize("NFKC")
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[\s「」『』、。・!！?？]/g, "");
  if (spellForm.includes("てあらいうがいわくちん")) {
    return [{ name: "fukkatsu_no_jumon", args: { jumon: "てあらいうがいわくちん" } }];
  }
  if (
    /(おかね|お金|かね|きん|ゴールド|ごーるど|G)(が|を)?(ほしい|ください|くれ|ちょうだい|めぐんで|たりない|ない)/.test(
      spellForm,
    )
  ) {
    return [{ name: "mysterious_voice" }];
  }
  if (spellForm.includes("ぱんでみっく")) {
    return [{ name: "cast_spell", args: { spell: "ぱんでみっく" } }];
  }
  if (spellForm.includes("ちょまど") && /となえ|じゅもん/.test(spellForm)) {
    return [{ name: "cast_spell", args: { spell: "ちょまど" } }];
  }
  if (state.inBattle || state.hostAsking) {
    return null;
  }
  if (state.princessCarried && !state.cleared && /とどけ/.test(spellForm)) {
    const steps = [];
    if (state.location !== "venue") {
      steps.push({ name: "move", args: { destination: "おおてまちじょう" } });
    }
    steps.push({ name: "talk" });
    return steps;
  }
  const moveIntent = /いく|いって|いこう|むか|もど|しゅっぱつ|いそ/.test(spellForm);
  if (moveIntent) {
    if (spellForm.includes("まもりのまち")) {
      return [{ name: "move", args: { destination: "まもりのまち" } }];
    }
    if (spellForm.includes("ウイルスのすみか") || spellForm.includes("すみか")) {
      return [{ name: "move", args: { destination: "ウイルスのすみか" } }];
    }
    if (spellForm.includes("おおてまちじょう")) {
      return [{ name: "move", args: { destination: "おおてまちじょう" } }];
    }
  }
  if (/おくへすすむ|おくへすすんで|おくへすすもう|さらにすすむ/.test(spellForm)) {
    return [{ name: "explore" }];
  }
  const msg = rawMessage.normalize("NFKC");
  const buyish = /かう|買|うつ|打つ|せっしゅ|ください|くれ|ほしい/.test(msg);
  if (/かぜぐすり|くすりをのむ/.test(msg) && /のむ|飲/.test(msg)) {
    return [{ name: "medicine" }];
  }
  if (state.location === "town" && buyish) {
    for (const name of Object.keys(WEAPON_SHOP)) {
      if (msg.includes(name)) {
        return [{ name: "weapon_shop", args: { item: name } }];
      }
    }
    for (const name of Object.keys(ARMOR_SHOP)) {
      if (msg.includes(name)) {
        return [{ name: "armor_shop", args: { item: name } }];
      }
    }
    if (msg.includes("ワクチン")) {
      return [{ name: "pharmacy", args: { item: "ワクチン" } }];
    }
    if (msg.includes("かぜぐすり")) {
      return [{ name: "pharmacy", args: { item: "かぜぐすり" } }];
    }
  }
  return null;
}

function playerAuthorizedPurchase(userMessage, item, prevAssistantText) {
  if (typeof userMessage !== "string" || typeof item !== "string") {
    return false;
  }
  const normalized = userMessage.replace(/\s/g, "");
  if (normalized.includes(item.replace(/\s/g, ""))) {
    return true;
  }
  if (
    /^(はい|うん|かう|買う|おねがい)$/.test(normalized) &&
    typeof prevAssistantText === "string" &&
    prevAssistantText.includes(item)
  ) {
    return true;
  }
  return false;
}

function toAnthropicTools(tools) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    input_schema: tool.inputSchema,
  }));
}

function toOpenAITools(tools) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.inputSchema,
    },
  }));
}

function guardedToolArguments(name, input, userMessage, prevAssistantText) {
  if (
    typeof input?.item === "string" &&
    PURCHASE_ACTIONS.has(name) &&
    !playerAuthorizedPurchase(userMessage, input.item, prevAssistantText)
  ) {
    const nextInput = { ...(input ?? {}) };
    delete nextInput.item;
    return nextInput;
  }
  return input ?? {};
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

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 529]);
const FALLBACK_MODEL = "claude-sonnet-5";
const OPENAI_DEFAULT_MODEL = "gpt-5.6-luna";

export function hasOpenAIKey(env) {
  return typeof env.OPENAI_API_KEY === "string" && env.OPENAI_API_KEY.length > 0;
}

export function hasAnthropicKey(env) {
  return typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY.length > 0;
}

export function toOpenAIMessages(messages) {
  const out = [{ role: "system", content: SYSTEM_PROMPT }];
  for (const message of messages) {
    const blocks = Array.isArray(message.content)
      ? message.content
      : [{ type: "text", text: String(message.content ?? "") }];
    if (message.role === "user") {
      const texts = [];
      for (const block of blocks) {
        if (block.type === "text") {
          texts.push(block.text);
        } else if (block.type === "tool_result") {
          const content = Array.isArray(block.content)
            ? block.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n")
            : String(block.content ?? "");
          out.push({ role: "tool", tool_call_id: block.tool_use_id, content });
        }
      }
      if (texts.length > 0) {
        out.push({ role: "user", content: texts.join("\n") });
      }
    } else if (message.role === "assistant") {
      const texts = blocks.filter((block) => block.type === "text").map((block) => block.text);
      const toolCalls = blocks
        .filter((block) => block.type === "tool_use")
        .map((block) => ({
          id: block.id,
          type: "function",
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
        }));
      const entry = { role: "assistant", content: texts.length > 0 ? texts.join("\n") : null };
      if (toolCalls.length > 0) {
        entry.tool_calls = toolCalls;
      }
      out.push(entry);
    }
  }
  return out;
}

export function fromOpenAIResponse(payload) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const message = choice?.message ?? {};
  const content = [];
  if (typeof message.content === "string" && message.content.length > 0) {
    content.push({ type: "text", text: message.content });
  }
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const call of toolCalls) {
    let input = {};
    try {
      input = JSON.parse(call.function?.arguments || "{}");
    } catch {}
    content.push({ type: "tool_use", id: call.id, name: call.function?.name ?? "game", input });
  }
  const hasToolUse = content.some((block) => block.type === "tool_use");
  return { content, stop_reason: hasToolUse ? "tool_use" : "end_turn" };
}

async function readModelError(response) {
  let detail = "";
  try {
    detail = (await response.text()).slice(0, 300);
  } catch {}
  const error = new Error(`model http ${response.status} ${detail}`);
  error.status = response.status;
  return error;
}

async function callAnthropicOnce(env, messages, model, tools) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      tools: toAnthropicTools(tools),
      messages,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw await readModelError(response);
  }
  return response.json();
}

async function callOpenAIOnce(env, messages, model, tools, withReasoningEffort = true) {
  const body = {
    model,
    max_completion_tokens: 2000,
    messages: toOpenAIMessages(messages),
    tools: toOpenAITools(tools),
  };
  if (withReasoningEffort) {
    body.reasoning_effort = "low";
  }
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    if (response.status === 400 && withReasoningEffort) {
      return callOpenAIOnce(env, messages, model, tools, false);
    }
    throw await readModelError(response);
  }
  return fromOpenAIResponse(await response.json());
}

async function callModel(env, messages, tools) {
  const useOpenAI = hasOpenAIKey(env);
  const primaryModel =
    typeof env.CHAT_MODEL === "string" && env.CHAT_MODEL
      ? env.CHAT_MODEL
      : useOpenAI
        ? OPENAI_DEFAULT_MODEL
        : DEFAULT_MODEL;
  const attempts = useOpenAI
    ? [
        { provider: "openai", model: primaryModel, delayMs: 0 },
        { provider: "openai", model: primaryModel, delayMs: 1500 },
        { provider: "openai", model: primaryModel, delayMs: 3000 },
        ...(hasAnthropicKey(env)
          ? [{ provider: "anthropic", model: DEFAULT_MODEL, delayMs: 2000 }]
          : [{ provider: "openai", model: primaryModel, delayMs: 5000 }]),
      ]
    : [
        { provider: "anthropic", model: primaryModel, delayMs: 0 },
        { provider: "anthropic", model: primaryModel, delayMs: 1500 },
        { provider: "anthropic", model: primaryModel, delayMs: 3000 },
        { provider: "anthropic", model: FALLBACK_MODEL, delayMs: 2000 },
      ];
  let lastError = null;
  for (const attempt of attempts) {
    if (attempt.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, attempt.delayMs));
    }
    try {
      if (attempt.provider === "openai") {
        return await callOpenAIOnce(env, messages, attempt.model, tools);
      }
      return await callAnthropicOnce(env, messages, attempt.model, tools);
    } catch (error) {
      lastError = error;
      if (!RETRYABLE_STATUSES.has(error?.status)) {
        if (attempt.provider === "openai" && hasAnthropicKey(env)) {
          console.error(
            "openai call failed, falling back to anthropic:",
            error instanceof Error ? error.message : String(error),
          );
          return callAnthropicOnce(env, messages, DEFAULT_MODEL, tools);
        }
        throw error;
      }
    }
  }
  throw lastError;
}

function rateLimitFailureResponse() {
  return json(
    { ok: false, error: "rate_limited", message: "すこし やすんでから ためすのだ。" },
    429,
  );
}

function serviceUnavailableResponse(message = "せかいが ふあんていだ。もういちど ためしてくれ。") {
  return json({ ok: false, error: "service_unavailable", message }, 503);
}

function normalizeExplicitCommand(text) {
  return text.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

export function isExplicitNewGameCommand(message) {
  return EXPLICIT_NEW_GAME_COMMANDS.has(normalizeExplicitCommand(message));
}

export async function readChatRequestEnvelope(request) {
  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          error: "unsupported_media_type",
          message: "Content-Type は application/json で おくるのだ。",
        },
        415,
      ),
    };
  }
  let bodyText;
  try {
    bodyText = await request.text();
  } catch {
    return { ok: false, response: json({ ok: false, error: "invalid_json" }, 400) };
  }
  if (new TextEncoder().encode(bodyText).byteLength > CHAT_BODY_LIMIT_BYTES) {
    return {
      ok: false,
      response: json(
        { ok: false, error: "payload_too_large", message: "ことばが ながすぎる。" },
        413,
      ),
    };
  }
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { ok: false, response: json({ ok: false, error: "invalid_json" }, 400) };
  }
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!UUID_V4_PATTERN.test(sessionId)) {
    return { ok: false, response: json({ ok: false, error: "invalid_session" }, 400) };
  }
  if (message.length === 0 || Array.from(message).length > MAX_MESSAGE_LENGTH) {
    return { ok: false, response: json({ ok: false, error: "invalid_message" }, 400) };
  }
  return { ok: true, value: { bodyText, sessionId, message } };
}

async function enforceChatRateLimits(env, request, sessionId) {
  if (!env.CHAT_RATE_LIMIT) {
    return null;
  }
  if (typeof env.CHAT_RATE_LIMIT.limit !== "function") {
    return serviceUnavailableResponse();
  }
  let outcome;
  try {
    outcome = await env.CHAT_RATE_LIMIT.limit({ key: `chat:${sessionId}` });
  } catch {
    return serviceUnavailableResponse();
  }
  if (!outcome?.success) {
    return rateLimitFailureResponse();
  }
  return null;
}

async function enforceModelRateLimit(env, sessionId) {
  if (!env.CHAT_IP_RATE_LIMIT) {
    return null;
  }
  if (typeof env.CHAT_IP_RATE_LIMIT.limit !== "function") {
    return serviceUnavailableResponse();
  }
  let outcome;
  try {
    outcome = await env.CHAT_IP_RATE_LIMIT.limit({ key: `chat-model:${sessionId}` });
  } catch {
    return serviceUnavailableResponse();
  }
  if (!outcome?.success) {
    return rateLimitFailureResponse();
  }
  return null;
}

async function publishSnapshot(env, playerId, snapshot, ctx) {
  if (snapshot && snapshot.name === heroPlaceholderName) {
    return;
  }
  const write = writePlayerSnapshot(env, playerId, snapshot);
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(write);
    return;
  }
  try {
    await write;
  } catch {}
}

export async function handleChat(
  request,
  env,
  ctx,
  sessionStore,
  requestEnvelope,
  runtimeOptions = {},
) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  if (!hasOpenAIKey(env) && !hasAnthropicKey(env)) {
    return json(
      {
        ok: false,
        error: "chat_disabled",
        message: "ブラウザばんは いま じゅんびちゅうだ。コネクタで あそんでくれ。",
      },
      503,
    );
  }
  if (
    !sessionStore ||
    typeof sessionStore.read !== "function" ||
    typeof sessionStore.write !== "function"
  ) {
    return serviceUnavailableResponse();
  }
  const envelope = requestEnvelope ?? (await readChatRequestEnvelope(request));
  if (!envelope.ok) {
    return envelope.response;
  }
  const runtimeFactory = runtimeOptions.createGameRuntime ?? createGameRuntime;
  const observeMcp = runtimeOptions.observeMcp;
  const { sessionId, message } = envelope.value;
  const rateLimitError = await enforceChatRateLimits(env, request, sessionId);
  if (rateLimitError) {
    return rateLimitError;
  }
  let session = null;
  try {
    session = await sessionStore.read(sessionId);
  } catch {
    return serviceUnavailableResponse();
  }
  const playerId =
    session && typeof session.playerId === "string" && UUID_V4_PATTERN.test(session.playerId)
      ? session.playerId
      : crypto.randomUUID();
  const turns =
    session && Number.isInteger(session.turns) && session.turns >= 0 ? session.turns : 0;
  const wantsNewGame = isExplicitNewGameCommand(message);
  if (turns >= MAX_USER_TURNS) {
    return json(
      {
        ok: false,
        error: "session_exhausted",
        message:
          "この ぼうけんは ここまでだ。「はじめから やりなおす」と いえば あたらしい ぼうけんに でられるぞ。",
      },
      429,
    );
  }
  let runtime = null;
  try {
    if (wantsNewGame) {
      runtime = await runtimeFactory({
        loadedGame: { state: createInitialState(), gameLog: [] },
        engineOptions: { report: () => {} },
      });
      observeMcp?.({ type: "callTool", name: "new_game", args: { confirmation: "NEW_GAME" } });
      await runtime.callTool("new_game", { confirmation: "NEW_GAME" });
      observeMcp?.({ type: "callTool", name: "start_adventure", args: {} });
      const intro = await runtime.callTool("start_adventure", {});
      try {
        await sessionStore.write(sessionId, {
          playerId,
          turns: 0,
          messages: [],
          save: runtime.snapshotSave(),
        });
      } catch {
        return serviceUnavailableResponse();
      }
      try {
        await deletePlayerSnapshot(env, playerId);
      } catch {}
      return buildChatResponse(
        runtime.engine,
        "あたらしい ぼうけんが はじまった！ きろくは まっさらだ。\n\n" + toolResultText(intro),
        MAX_USER_TURNS,
      );
    }

    const messages = session && Array.isArray(session.messages) ? [...session.messages] : [];
    const loaded = loadSessionState(session);
    if (loaded.restoreFailed) {
      console.error(
        "session restore failed:",
        JSON.stringify({
          sessionId: sessionId.slice(0, 8),
          reason: loaded.restoreFailed.reason,
          issues: loaded.restoreFailed.issues,
          heroName: session?.save?.heroName,
          level: session?.save?.level,
          location: session?.save?.location,
          lairDepth: session?.save?.lairDepth,
          savedAt: session?.save?.savedAt,
        }),
      );
      return serviceUnavailableResponse(
        "ぼうけんのしょが みだれている。すこし まってから もういちど ためしてくれ。",
      );
    }

    let latestSnapshot = null;
    runtime = await runtimeFactory({
      loadedGame: loaded,
      engineOptions: {
        report: (snapshot) => {
          latestSnapshot = snapshot;
        },
        isNameTaken: (name) => isHeroNameTaken(env, name, playerId),
      },
    });
    const engine = runtime.engine;
    const executeRuntimeTool = async (name, input = {}, assistantText = "") => {
      const args = guardedToolArguments(name, input, message, assistantText);
      observeMcp?.({ type: "callTool", name, args });
      return runtime.callTool(name, args);
    };
    const listRuntimeTools = async () => {
      const result = await runtime.listTools();
      observeMcp?.({
        type: "listTools",
        tools: result.tools.map((tool) => tool.name),
      });
      return result.tools;
    };

    if (
      engine.state.heroName !== heroPlaceholderName &&
      message.replace(/\s/g, "").includes("爆速RTA")
    ) {
      const rta = await executeRuntimeTool("rta_clear");
      try {
        await sessionStore.write(sessionId, {
          playerId,
          turns: turns + 1,
          messages: [],
          save: runtime.snapshotSave(),
        });
      } catch {
        return serviceUnavailableResponse();
      }
      await publishSnapshot(env, playerId, engine.snapshot(), ctx);
      return buildChatResponse(engine, toolResultText(rta), MAX_USER_TURNS - (turns + 1));
    }

    if (engine.state.heroName === heroPlaceholderName && !engine.state.cleared) {
      const bracket = message.match(/「([^「」]{1,24})」/);
      const plain = message.match(/なまえは\s*([^\s。、!！?？]{1,24})/);
      const rawName = bracket ? bracket[1] : plain ? plain[1] : null;
      if (rawName) {
        let nameResult;
        try {
          nameResult = await executeRuntimeTool("name_hero", { name: rawName });
        } catch {
          nameResult = engine.errorText("その なまえは つかえない。べつの なまえを たのむ。");
        }
        const named = engine.state.heroName !== heroPlaceholderName;
        const nameReply = named
          ? toolResultText(nameResult) +
            "\n\nおおてまちじょうの だいじんが そなたを まっている。はなしを きいてみよう。"
          : toolResultText(nameResult);
        messages.push({ role: "user", content: [{ type: "text", text: message }] });
        messages.push({ role: "assistant", content: [{ type: "text", text: nameReply }] });
        trimHistory(messages);
        try {
          await sessionStore.write(sessionId, {
            playerId,
            turns: turns + 1,
            messages,
            save: runtime.snapshotSave(),
          });
        } catch {
          return serviceUnavailableResponse();
        }
        if (latestSnapshot) {
          await publishSnapshot(env, playerId, latestSnapshot, ctx);
        }
        return buildChatResponse(engine, nameReply, MAX_USER_TURNS - (turns + 1));
      }
    }

    const directRoute =
      engine.state.heroName !== heroPlaceholderName
        ? routeDirectCommand(engine.state, message)
        : null;
    const fuzzyRoute =
      !directRoute && engine.state.heroName !== heroPlaceholderName
        ? routeFuzzyCommand(engine.state, message)
        : null;
    const directSteps = directRoute ?? fuzzyRoute;
    if (directSteps && directSteps.length > 0) {
      console.log(
        "chat route:",
        JSON.stringify({
          session: sessionId.slice(0, 8),
          route: directRoute ? "direct" : "fuzzy",
          message: clipForLog(message),
          actions: directSteps.map((step) => step.name),
        }),
      );
      const directTexts = [];
      for (const step of directSteps) {
        let output;
        try {
          output = await executeRuntimeTool(step.name, step.args ?? {});
        } catch {
          output = engine.errorText("せかいが ふあんていになっている。もういちど ためしてくれ。");
        }
        directTexts.push(toolResultText(output));
        if (output.isError === true) {
          break;
        }
      }
      const directReply = directTexts.join("\n\n");
      messages.push({ role: "user", content: [{ type: "text", text: message }] });
      messages.push({ role: "assistant", content: [{ type: "text", text: directReply }] });
      trimHistory(messages);
      try {
        await sessionStore.write(sessionId, {
          playerId,
          turns: turns + 1,
          messages,
          save: runtime.snapshotSave(),
        });
      } catch {
        return serviceUnavailableResponse();
      }
      if (latestSnapshot) {
        await publishSnapshot(env, playerId, latestSnapshot, ctx);
      }
      return buildChatResponse(engine, directReply, MAX_USER_TURNS - (turns + 1), {
        gameOver: directTexts.some((text) => text.includes("＊＊ ゲームオーバー ＊＊")),
      });
    }

    const modelRateLimitError = await enforceModelRateLimit(env, sessionId);
    if (modelRateLimitError) {
      return modelRateLimitError;
    }

    let prevAssistantText = "";
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "assistant") {
        const blocks = Array.isArray(messages[index].content) ? messages[index].content : [];
        prevAssistantText = blocks
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");
        break;
      }
    }

    messages.push({ role: "user", content: [{ type: "text", text: message }] });

    let replyText = "";
    let lastToolOutputText = "";
    let exhaustedWithPendingToolResult = false;
    const gameTexts = [];
    const llmActions = [];
    try {
      for (let loop = 0; loop < MAX_TOOL_LOOPS; loop += 1) {
        const tools = await listRuntimeTools();
        const result = await callModel(env, messages, tools);
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
        const toolOutputParts = [];
        for (const toolUse of toolUses) {
          llmActions.push(typeof toolUse.name === "string" ? toolUse.name : "?");
          let output;
          try {
            output = await executeRuntimeTool(toolUse.name, toolUse.input ?? {}, prevAssistantText);
          } catch {
            output = engine.errorText("せかいが ふあんていになっている。もういちど ためしてくれ。");
          }
          const outputText = toolResultText(output);
          toolOutputParts.push(outputText);
          if (output.isError !== true) {
            gameTexts.push(outputText);
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: outputText,
            is_error: output.isError === true,
          });
        }
        const askedStatusFallback = /つよさ|ステータス|じょうたい|そうび|もちもの/.test(message);
        lastToolOutputText = toolOutputParts
          .filter((part) => askedStatusFallback || !part.startsWith("＊＊ つよさ ＊＊"))
          .join("\n\n");
        if (loop === MAX_TOOL_LOOPS - 1) {
          exhaustedWithPendingToolResult = true;
        }
        messages.push({ role: "user", content: toolResults });
      }
    } catch (error) {
      console.error("chat model failure:", error instanceof Error ? error.message : String(error));
      return json(
        {
          ok: false,
          error: "model_error",
          message: "つうしんが みだれた。もういちど ためすのだ。",
        },
        502,
      );
    }

    trimHistory(messages);

    try {
      await sessionStore.write(sessionId, {
        playerId,
        turns: turns + 1,
        messages,
        save: runtime.snapshotSave(),
      });
    } catch {
      return serviceUnavailableResponse();
    }

    if (latestSnapshot) {
      await publishSnapshot(env, playerId, latestSnapshot, ctx);
    }

    let composedReply = composeGameReply(gameTexts, replyText, message);
    let replySource = composedReply === replyText ? "model" : "tool";
    const FABRICATION_PATTERN =
      /あらわれた|ダメージ|のこり HP|HP ?[0-9]|たおした|レベルが|けいけんち|てにいれた|そうびした|クリア|エンディング|ゲームオーバー/;
    if (
      gameTexts.length === 0 &&
      composedReply &&
      FABRICATION_PATTERN.test(composedReply) &&
      !/かいますか/.test(composedReply)
    ) {
      composedReply =
        "てんの こえ「……という ゆめを みたようだ。じっさいには なにも おこっていない。」";
      replySource = "fabrication-guard";
    }
    if (!composedReply) {
      replySource =
        exhaustedWithPendingToolResult && lastToolOutputText ? "tool-fallback" : "quiet-fallback";
    }
    const finalReply =
      composedReply ||
      (exhaustedWithPendingToolResult && lastToolOutputText
        ? lastToolOutputText
        : "（しずかな かぜが ふいている……もういちど はなしかけてみよう）");
    console.log(
      "chat route:",
      JSON.stringify({
        session: sessionId.slice(0, 8),
        route: "llm",
        message: clipForLog(message),
        actions: llmActions,
        replySource,
      }),
    );
    return buildChatResponse(engine, finalReply, MAX_USER_TURNS - (turns + 1), {
      gameOver: gameTexts.some((text) => text.includes("＊＊ ゲームオーバー ＊＊")),
    });
  } finally {
    await runtime?.close?.();
  }
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
<meta name="description" content="インフルだいまおうにさらわれたちょまどひめを助けに行く、ブラウザで遊べるレトロ風テキスト RPG">
<link rel="icon" type="image/png" href="/favicon.png">
<meta property="og:title" content="インフルクエスト">
<meta property="og:description" content="インフルだいまおうにさらわれたちょまどひめを助けに行く、ブラウザで遊べるレトロ風テキスト RPG">
<meta property="og:type" content="website">
<meta property="og:url" content="https://influ-quest.nukoevi.app/play">
<meta property="og:image" content="https://influ-quest.nukoevi.app/assets/og-title.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://influ-quest.nukoevi.app/assets/og-title.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DotGothic16&display=swap" rel="stylesheet">
<style>
  :root {
    color-scheme: dark;
    --white: #f8f8f8;
    --gold: #ffd44a;
    --sky: #85d6ff;
    --mint: #7ee2ad;
    --rose: #ff8a70;
    --dim: #9aa3b2;
    --virus: #58d858;
    --virus-dark: #17671f;
  }
  * {
    box-sizing: border-box;
    touch-action: manipulation;
  }
  html {
    background: #000;
  }
  body {
    margin: 0;
    height: 100dvh;
    background: #000;
    color: var(--white);
    font-family: "DotGothic16", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", sans-serif;
    line-height: 1.85;
    display: flex;
    justify-content: center;
    padding: 12px 10px;
  }
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(transparent 0 2px, rgba(255, 255, 255, 0.03) 2px 4px);
    background-size: 100% 4px;
    z-index: 9;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .shell {
    width: 100%;
    max-width: 680px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .dqwin {
    position: relative;
    background: #000;
    border: 3px solid var(--white);
    border-radius: 10px;
    padding: 14px 16px;
  }
  .dqwin::before {
    content: "";
    position: absolute;
    inset: 3px;
    border: 1px solid var(--white);
    border-radius: 6px;
    pointer-events: none;
  }
  .dqwin[data-title]::after {
    content: attr(data-title);
    position: absolute;
    top: -14px;
    left: 16px;
    background: #000;
    padding: 0 8px;
    font-size: 13px;
    letter-spacing: 0.12em;
  }
  header {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .titlerow {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }
  h1 {
    margin: 0;
    font-size: clamp(17px, 4.4vw, 28px);
    letter-spacing: 0.1em;
    color: var(--gold);
    text-shadow: 3px 3px 0 #7a1f1f;
    white-space: nowrap;
  }
  .hud {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px 18px;
    padding: 8px 14px;
    font-size: 13px;
    letter-spacing: 0.06em;
  }
  .hud[hidden],
  .scene[hidden] {
    display: none;
  }
  .hud span {
    white-space: nowrap;
  }
  .hud .gold {
    color: var(--gold);
  }
  .hud .flu {
    color: var(--rose);
  }
  .scene {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px;
  }
  .enemy-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    width: min(100%, 360px);
  }
  .enemy-bar[hidden] {
    display: none;
  }
  .enemy-bar .gauge {
    flex: 1;
    height: 10px;
    border: 1px solid var(--white);
    border-radius: 5px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.08);
  }
  .enemy-bar .gauge i {
    display: block;
    height: 100%;
    background: var(--rose);
    transition: width 0.4s steps(8);
  }
  .enemy-bar span {
    white-space: nowrap;
  }
  .scene img {
    height: 140px;
    max-width: 100%;
    object-fit: contain;
    image-rendering: pixelated;
  }
  @media (max-height: 700px) {
    .scene img {
      height: 96px;
    }
  }
  .boardlink {
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    margin: 0;
    font-size: 11px;
  }
  .boardlink a {
    display: inline-block;
    color: var(--sky);
    text-decoration: none;
    white-space: nowrap;
    font-size: 20px;
    padding: 3px 6px;
    line-height: 1;
  }
  .sprite {
    position: relative;
    width: 55px;
    height: 55px;
    flex: none;
    transform: scale(0.72);
    transform-origin: center;
    animation: bob 1.2s steps(2) infinite;
  }
  .sprite .px {
    position: absolute;
    top: 0;
    left: 0;
    width: 5px;
    height: 5px;
    box-shadow:
      25px 0 var(--virus-dark),
      25px 5px var(--virus-dark),
      5px 5px var(--virus-dark),
      45px 5px var(--virus-dark),
      10px 10px var(--virus-dark),
      20px 10px var(--virus-dark), 25px 10px var(--virus-dark), 30px 10px var(--virus-dark),
      40px 10px var(--virus-dark),
      15px 15px var(--virus-dark),
      20px 15px var(--virus), 25px 15px var(--virus), 30px 15px var(--virus),
      35px 15px var(--virus-dark),
      10px 20px var(--virus-dark),
      15px 20px var(--virus),
      20px 20px #000,
      25px 20px var(--virus),
      30px 20px #000,
      35px 20px var(--virus),
      40px 20px var(--virus-dark),
      0 25px var(--virus-dark), 5px 25px var(--virus-dark),
      10px 25px var(--virus), 15px 25px var(--virus), 20px 25px var(--virus), 25px 25px var(--virus), 30px 25px var(--virus), 35px 25px var(--virus), 40px 25px var(--virus),
      45px 25px var(--virus-dark), 50px 25px var(--virus-dark),
      10px 30px var(--virus-dark),
      15px 30px var(--virus),
      20px 30px #000, 25px 30px #000, 30px 30px #000,
      35px 30px var(--virus),
      40px 30px var(--virus-dark),
      15px 35px var(--virus-dark),
      20px 35px var(--virus), 25px 35px var(--virus), 30px 35px var(--virus),
      35px 35px var(--virus-dark),
      10px 40px var(--virus-dark),
      20px 40px var(--virus-dark), 25px 40px var(--virus-dark), 30px 40px var(--virus-dark),
      40px 40px var(--virus-dark),
      5px 45px var(--virus-dark),
      25px 45px var(--virus-dark),
      45px 45px var(--virus-dark),
      25px 50px var(--virus-dark);
  }
  @keyframes bob {
    50% {
      transform: scale(0.72) translateY(4px);
    }
  }
  .logwrap {
    flex: 1;
    min-height: 0;
    display: flex;
    padding: 14px 8px 14px 16px;
  }
  .log {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    scroll-behavior: smooth;
    padding-right: 8px;
  }
  .msg {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 14px;
    max-width: 100%;
  }
  .msg.player {
    align-self: flex-end;
    color: var(--sky);
    text-align: right;
  }
  .msg.player::before {
    content: "＞ ";
  }
  .msg.sys {
    align-self: center;
    color: var(--dim);
    font-size: 13px;
    text-align: center;
  }
  .msg.gameover {
    align-self: center;
    color: var(--rose);
    font-size: 16px;
    letter-spacing: 0.2em;
    text-align: center;
    border: 2px solid var(--rose);
    border-radius: 8px;
    padding: 6px 16px;
  }
  .msg.gm .cursor {
    color: var(--white);
    animation: blink 0.9s steps(1) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  .brag-slot button {
    display: inline-block;
    font: inherit;
    font-size: 14px;
    color: #05060a;
    background: var(--gold);
    border: none;
    border-radius: 8px;
    padding: 8px 16px;
    cursor: pointer;
    white-space: nowrap;
  }
  .brag-slot {
    flex: none;
    text-align: center;
    padding: 8px 0 0;
  }
  .brag-slot[hidden] {
    display: none;
  }
  .commands {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 16px;
    padding: 12px 16px;
    min-height: 52px;
  }
  .commands button {
    font: inherit;
    font-size: 14px;
    color: var(--white);
    background: transparent;
    border: none;
    text-align: left;
    padding: 4px 4px 4px 20px;
    position: relative;
    cursor: pointer;
    letter-spacing: 0.06em;
    white-space: nowrap;
  }
  .commands button::before {
    content: "▶";
    position: absolute;
    left: 0;
    opacity: 0;
  }
  .commands button:hover::before,
  .commands button:focus-visible::before {
    opacity: 1;
  }
  .commands button:disabled {
    color: var(--dim);
    cursor: wait;
  }
  .commands .hint {
    color: var(--dim);
    font-size: 13px;
  }
  .commands button.misc {
    color: var(--dim);
    font-size: 13px;
  }
  .composer[hidden] {
    display: none;
  }
  .credits {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: #000;
    overflow: hidden;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .credits-inner {
    position: absolute;
    left: 0;
    right: 0;
    top: 100%;
    text-align: center;
    color: #fff;
    font-size: clamp(14px, 3.6vw, 20px);
    line-height: 2.4;
    letter-spacing: 0.14em;
    white-space: pre-line;
    animation: credits-roll 36s linear forwards;
  }
  .credits-inner .credits-title {
    font-size: clamp(22px, 6vw, 34px);
    color: var(--gold);
    letter-spacing: 0.2em;
  }
  .credits-hint {
    position: absolute;
    bottom: 10px;
    right: 14px;
    color: #888;
    font-size: 11px;
  }
  @keyframes credits-roll {
    from {
      transform: translateY(0);
    }
    to {
      transform: translateY(-260vh);
    }
  }
  .composer {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .composer input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 16px;
    color: inherit;
    background: transparent;
    border: none;
    padding: 6px 4px;
  }
  .composer input:focus {
    outline: none;
  }
  .composer input::placeholder {
    color: var(--dim);
  }
  .composer input:disabled {
    color: var(--dim);
  }
  .composer button {
    flex: none;
    font: inherit;
    font-size: 14px;
    color: var(--gold);
    background: transparent;
    border: none;
    cursor: pointer;
    letter-spacing: 0.1em;
    padding: 6px 8px;
    white-space: nowrap;
  }
  .composer button::before {
    content: "▶ ";
  }
  .composer button:disabled {
    color: var(--dim);
    cursor: wait;
  }
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.92);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    z-index: 20;
  }
  .overlay[hidden] {
    display: none;
  }
  .namebox {
    width: 100%;
    max-width: 460px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .namebox .dqwin {
    padding: 16px;
  }
  .name-display {
    display: flex;
    justify-content: center;
    gap: 8px;
    font-size: 22px;
    letter-spacing: 0.1em;
    min-height: 40px;
  }
  .name-display .slot {
    width: 34px;
    height: 38px;
    border-bottom: 2px solid var(--white);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .name-display .slot.active {
    border-bottom-color: var(--gold);
  }
  .kana {
    display: grid;
    grid-template-columns: repeat(10, minmax(0, 1fr));
    gap: 2px;
  }
  .kana button {
    font: inherit;
    font-size: 16px;
    color: var(--white);
    background: transparent;
    border: none;
    padding: 5px 0;
    cursor: pointer;
    border-radius: 6px;
  }
  .kana button:hover,
  .kana button:focus-visible {
    background: rgba(255, 255, 255, 0.14);
    outline: none;
  }
  .name-actions {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 0 4px;
  }
  .name-actions button {
    font: inherit;
    font-size: 15px;
    color: var(--white);
    background: transparent;
    border: none;
    cursor: pointer;
    letter-spacing: 0.1em;
    white-space: nowrap;
  }
  .name-actions button::before {
    content: "▶ ";
    color: var(--gold);
  }
  .name-actions .ok {
    color: var(--gold);
  }
  .name-actions button:disabled {
    color: var(--dim);
    cursor: default;
  }
  @media (prefers-reduced-motion: reduce) {
    .sprite,
    .msg.gm .cursor {
      animation: none;
    }
    .log {
      scroll-behavior: auto;
    }
  }
</style>
</head>
<body>
<div class="shell" id="app-shell">
  <header>
    <div class="titlerow">
      <div class="sprite" aria-hidden="true"><i class="px"></i></div>
      <h1>インフルクエスト</h1>
      <div class="sprite" aria-hidden="true"><i class="px"></i></div>
      <p class="boardlink"><a href="/" title="かいじょうボード" aria-label="かいじょうボード">🪧</a></p>
    </div>
  </header>
  <div class="dqwin hud" id="hud" hidden></div>
  <div class="dqwin scene" id="scene" hidden>
    <img id="scene-img" alt="げんざいの けしき">
    <div class="enemy-bar" id="enemy-bar" hidden>
      <span id="enemy-name"></span>
      <div class="gauge"><i id="enemy-gauge"></i></div>
      <span id="enemy-hp"></span>
    </div>
  </div>
  <div class="dqwin logwrap" data-title="― メッセージ ―"><div class="log" id="log" role="log" aria-live="polite" aria-relevant="additions text"></div></div>
  <div class="brag-slot" id="brag-slot" hidden></div>
  <div class="dqwin commands" id="hints" data-title="― コマンド ―" aria-live="polite" aria-atomic="true"></div>
  <form class="dqwin composer" id="composer" data-title="― にゅうりょく ―" aria-labelledby="input-label" hidden>
    <label class="sr-only" id="input-label" for="input">コマンドを いれる</label>
    <span class="sr-only" id="input-help">じゆうに かいて おくる</span>
    <input id="input" type="text" maxlength="500" placeholder="じゆうに にゅうりょく" autocomplete="off" aria-describedby="input-help">
    <button id="send" type="submit">おくる</button>
  </form>
</div>
<div class="overlay" id="name-overlay" hidden aria-hidden="true">
  <div class="namebox">
    <div class="dqwin" role="dialog" aria-modal="true" aria-labelledby="name-dialog-title" aria-describedby="name-dialog-help" data-title="― なまえを つけて ください ―">
      <p class="sr-only" id="name-dialog-title">ゆうしゃの なまえを つける</p>
      <p class="sr-only" id="name-dialog-help">かなを えらんで なまえを つくり、けってい を おす</p>
      <div class="name-display" id="name-display" role="status" aria-live="polite" aria-atomic="true"></div>
      <div class="kana" id="kana"></div>
      <div class="name-actions">
        <button type="button" id="name-kana">カタカナ</button>
        <button type="button" id="name-back">もどす</button>
        <button type="button" id="name-ok" class="ok">けってい</button>
      </div>
    </div>
  </div>
</div>
<div class="sr-only" id="announce" aria-live="polite" aria-atomic="true"></div>
<script>
  const log = document.getElementById("log");
  const shell = document.getElementById("app-shell");
  const composer = document.getElementById("composer");
  const input = document.getElementById("input");
  const send = document.getElementById("send");
  const hints = document.getElementById("hints");
  const overlay = document.getElementById("name-overlay");
  const nameDisplay = document.getElementById("name-display");
  const kana = document.getElementById("kana");
  const nameBack = document.getElementById("name-back");
  const nameOk = document.getElementById("name-ok");
  const nameKanaToggle = document.getElementById("name-kana");
  const announce = document.getElementById("announce");
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const sessionKey = "influ-quest-session";
  const nameKey = "influ-quest-name";
  let previousFocus = null;
  let overlayOpen = false;
  let typingQueue = Promise.resolve();
  let sessionId = "";
  try {
    sessionId = localStorage.getItem(sessionKey) || "";
  } catch {}
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
    sessionId = crypto.randomUUID();
    try {
      localStorage.setItem(sessionKey, sessionId);
    } catch {}
  }
  const scrollDown = () => {
    log.scrollTop = log.scrollHeight;
  };
  const scrollDownInstant = () => {
    const previous = log.style.scrollBehavior;
    log.style.scrollBehavior = "auto";
    log.scrollTop = log.scrollHeight;
    log.style.scrollBehavior = previous;
  };
  const announceText = (text) => {
    announce.textContent = "";
    window.setTimeout(() => {
      announce.textContent = text;
    }, 0);
  };
  const addMessage = (cls, text) => {
    const div = document.createElement("div");
    div.className = "msg " + cls;
    div.textContent = text;
    log.appendChild(div);
    scrollDown();
    if (cls === "sys" || cls === "gameover") {
      announceText(text);
    }
    return div;
  };
  let creditsShown = false;
  let wasCleared = false;
  const showCredits = (playerName, onClose) => {
    if (creditsShown || document.querySelector(".credits")) {
      if (typeof onClose === "function") {
        onClose();
      }
      return;
    }
    creditsShown = true;
    const overlayEl = document.createElement("div");
    overlayEl.className = "credits";
    const inner = document.createElement("div");
    inner.className = "credits-inner";
    const title = document.createElement("div");
    title.className = "credits-title";
    title.textContent = "インフルクエスト";
    const body = document.createElement("div");
    body.textContent = [
      "",
      "そして せかいに あさが きた",
      "",
      "",
      "しゅえん",
      "ゆうしゃ " + (playerName || "そなた"),
      "",
      "とくべつしゅつえん",
      "ちょまどひめ",
      "",
      "てき",
      "インフルだいまおう",
      "へんいかぶの おやだま",
      "ウイルスりゅうし たち",
      "",
      "ぶたい",
      "おおてまちじょう",
      "まもりのまち",
      "ウイルスのすみか",
      "",
      "きゃくほん・しんこう",
      "ゲームマスター",
      "",
      "Presented at AI Dev Day 2026",
      "",
      "",
      "てあらい うがい よぼうせっしゅ",
      "",
      "おだいじに。",
      "",
      "",
      "THE END",
    ].join("\n");
    inner.appendChild(title);
    inner.appendChild(body);
    const hint = document.createElement("div");
    hint.className = "credits-hint";
    hint.textContent = "タップで とじる ／ ながおしで ばいそく";
    overlayEl.appendChild(inner);
    overlayEl.appendChild(hint);
    let closed = false;
    const close = () => {
      if (closed) {
        return;
      }
      closed = true;
      overlayEl.remove();
      if (typeof onClose === "function") {
        onClose();
      }
    };
    let pressTimer = null;
    let longPressed = false;
    const setCreditsRate = (rate) => {
      for (const animation of inner.getAnimations()) {
        animation.playbackRate = rate;
      }
    };
    overlayEl.addEventListener("pointerdown", () => {
      pressTimer = window.setTimeout(() => {
        pressTimer = null;
        longPressed = true;
        setCreditsRate(3);
      }, 300);
    });
    const releaseFast = () => {
      if (pressTimer !== null) {
        window.clearTimeout(pressTimer);
        pressTimer = null;
      }
      setCreditsRate(1);
    };
    overlayEl.addEventListener("pointerup", releaseFast);
    overlayEl.addEventListener("pointercancel", releaseFast);
    overlayEl.addEventListener("click", () => {
      if (longPressed) {
        longPressed = false;
        return;
      }
      close();
    });
    const endWatcher = window.setInterval(() => {
      if (closed) {
        window.clearInterval(endWatcher);
        return;
      }
      if (inner.getBoundingClientRect().bottom < 0) {
        window.clearInterval(endWatcher);
        close();
      }
    }, 200);
    inner.addEventListener("animationend", close);
    document.body.appendChild(overlayEl);
  };
  const shareSlot = document.getElementById("brag-slot");
  const renderShareSlot = (url) => {
    shareSlot.replaceChildren();
    if (!url) {
      shareSlot.hidden = true;
      return;
    }
    const bragButton = document.createElement("button");
    bragButton.type = "button";
    bragButton.textContent = "▶ Xで じまんする";
    bragButton.addEventListener("click", () => {
      window.open(url, "_blank", "noopener");
    });
    shareSlot.appendChild(bragButton);
    shareSlot.hidden = false;
  };
  let audioCtx = null;
  let audioUnlocked = false;
  const silentLoop = new Audio(
    "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  );
  silentLoop.loop = true;
  const ensureAudio = () => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      return;
    }
    if (!audioCtx) {
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    if (!audioUnlocked) {
      const buffer = audioCtx.createBuffer(1, 1, 22050);
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      source.start(0);
      silentLoop.play().catch(() => {});
      audioUnlocked = true;
    }
  };
  for (const eventName of ["pointerdown", "touchend", "click", "keydown"]) {
    document.addEventListener(eventName, ensureAudio, { passive: true });
  }
  const textBlip = () => {
    if (!audioCtx || audioCtx.state !== "running") {
      return;
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.02, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.04);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.04);
  };
  const typewrite = (text) =>
    new Promise((resolve) => {
      const div = document.createElement("div");
      div.className = "msg gm";
      const body = document.createElement("span");
      const cursor = document.createElement("span");
      cursor.className = "cursor";
      cursor.textContent = " ▼";
      div.appendChild(body);
      div.appendChild(cursor);
      log.appendChild(div);
      const chars = Array.from(text);
      if (prefersReducedMotion.matches) {
        body.textContent = text;
        cursor.remove();
        scrollDown();
        resolve();
        return;
      }
      let index = 0;
      const step = () => {
        const prev = index;
        index += 2;
        body.textContent = chars.slice(0, index).join("");
        if (/\S/.test(chars.slice(prev, index).join(""))) {
          textBlip();
        }
        scrollDownInstant();
        if (index < chars.length) {
          window.setTimeout(step, 32);
          return;
        }
        window.setTimeout(() => {
          cursor.remove();
          resolve();
        }, 240);
      };
      step();
    });
  const queueTypewrite = (text) => {
    typingQueue = typingQueue.then(
      () => typewrite(text),
      () => typewrite(text),
    );
    return typingQueue;
  };
  const scene = document.getElementById("scene");
  const sceneImg = document.getElementById("scene-img");
  const enemyBar = document.getElementById("enemy-bar");
  const enemyName = document.getElementById("enemy-name");
  const enemyGauge = document.getElementById("enemy-gauge");
  const enemyHp = document.getElementById("enemy-hp");
  const updateEnemy = (enemy) => {
    if (!enemy || typeof enemy.hp !== "number" || typeof enemy.maxHp !== "number" || enemy.maxHp <= 0) {
      enemyBar.hidden = true;
      return;
    }
    enemyBar.hidden = false;
    enemyName.textContent = enemy.name;
    enemyHp.textContent = enemy.hp + "/" + enemy.maxHp;
    enemyGauge.style.width = Math.max(Math.round((enemy.hp / enemy.maxHp) * 100), 0) + "%";
  };
  const updateScene = (image) => {
    if (!image) return;
    scene.hidden = false;
    if (sceneImg.getAttribute("src") !== image) {
      sceneImg.src = image;
    }
  };
  sceneImg.addEventListener("error", () => {
    const fallback = "/assets/quest/locations/virus-lair-entrance.webp";
    if (sceneImg.getAttribute("src") !== fallback) {
      sceneImg.src = fallback;
    }
  });
  const hud = document.getElementById("hud");
  const updateHud = (data) => {
    if (!data) return;
    hud.hidden = false;
    hud.replaceChildren();
    const parts = [
      "Lv " + data.level,
      "HP " + data.hp + "/" + data.maxHp,
      { text: data.gold + " G", cls: "gold" },
      "かぜぐすり " + data.medicine,
      ...(data.immunity > 0 ? ["たいせい " + data.immunity] : []),
      ...(data.location === "lair" && data.lairDepth > 0 ? ["ちか" + data.lairDepth + "かい"] : []),
    ];
    if (data.infected) {
      parts.push({ text: "インフルエンザ！", cls: "flu" });
    }
    for (const part of parts) {
      const span = document.createElement("span");
      span.textContent = typeof part === "string" ? part : part.text;
      if (typeof part !== "string") span.className = part.cls;
      hud.appendChild(span);
    }
  };
  const setComposerOpen = (value) => {
    composer.hidden = !value;
    if (value) {
      input.focus();
    }
  };
  const renderSuggestions = (items, options) => {
    const allowInput = !options || options.allowInput !== false;
    hints.replaceChildren();
    for (const item of items || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.text = item;
      button.textContent = item;
      button.disabled = busy || overlayOpen;
      hints.appendChild(button);
    }
    if (allowInput) {
      const misc = document.createElement("button");
      misc.type = "button";
      misc.className = "misc";
      misc.dataset.input = "1";
      misc.textContent = "にゅうりょく";
      misc.disabled = busy || overlayOpen;
      hints.appendChild(misc);
    } else {
      setComposerOpen(false);
    }
  };
  let busy = false;
  const setBusy = (value) => {
    busy = value;
    const disabled = value || overlayOpen;
    send.disabled = disabled;
    input.disabled = disabled;
    composer.setAttribute("aria-busy", value ? "true" : "false");
    for (const button of hints.querySelectorAll("button")) {
      button.disabled = disabled;
    }
  };
  const updateNameActions = () => {
    const empty = Array.from(heroName).length === 0;
    nameBack.disabled = empty;
    nameOk.disabled = empty;
  };
  const setOverlayOpen = (value) => {
    overlayOpen = value;
    overlay.hidden = !value;
    overlay.setAttribute("aria-hidden", value ? "false" : "true");
    shell.inert = value;
    shell.setAttribute("aria-hidden", value ? "true" : "false");
    if (value) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      renderName();
      const firstKanaButton = kana.querySelector("button:not([disabled])");
      if (firstKanaButton instanceof HTMLButtonElement) {
        firstKanaButton.focus();
      } else {
        nameBack.focus();
      }
      announceText("ゆうしゃの なまえを つけて ください");
    } else if (previousFocus && typeof previousFocus.focus === "function") {
      previousFocus.focus();
    } else {
      input.focus();
    }
    setBusy(busy);
  };
  overlay.addEventListener("keydown", (event) => {
    if (!overlayOpen || event.key !== "Tab") {
      return;
    }
    const focusable = Array.from(overlay.querySelectorAll("button:not([disabled])"));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  const submit = async (text) => {
    if (busy) return;
    const message = text.trim();
    if (!message) return;
    if (/はじめから|やりなおす/.test(message)) {
      try {
        localStorage.removeItem(nameKey);
      } catch {}
      log.replaceChildren();
      hud.hidden = true;
      scene.hidden = true;
      enemyBar.hidden = true;
      creditsShown = false;
      wasCleared = false;
      renderSuggestions([], { allowInput: false });
      addMessage("sys", "＊ せかいが まきもどる…… ＊");
    }
    setBusy(true);
    input.value = "";
    addMessage("player", message);
    const waiting = addMessage("sys", "……");
    const waitingLines = [
      "……",
      "ゲームマスターが ダイスを ふっている……",
      "うんめいが うごいている……",
      "とおくで ウイルスの こえが する……",
      "ちょまどひめが いのっている……",
    ];
    let waitingIndex = 0;
    const waitingTimer = window.setInterval(() => {
      waitingIndex = (waitingIndex + 1) % waitingLines.length;
      waiting.textContent = waitingLines[waitingIndex];
    }, 3500);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, message }),
      });
      const data = await response.json();
      window.clearInterval(waitingTimer);
      waiting.remove();
      if (!response.ok || !data.ok) {
        addMessage("sys", "＊「" + (data.message || "つうしんに しっぱいした。もういちど ためすのだ。") + "」");
        if (data.error === "session_exhausted") {
          renderSuggestions(["はじめから やりなおす"], { allowInput: false });
        }
      } else {
        if (data.gameOver) {
          addMessage("gameover", "＊＊ ゲームオーバー ＊＊");
        }
        renderSuggestions(data.suggestions, { allowInput: data.allowInput !== false });
        updateHud(data.hud);
        updateScene(data.image);
        updateEnemy(data.hud && data.hud.enemy);
        const shareMatch = data.reply.match(/https:\/\/x\.com\/intent\/(?:tweet|post)\?text=\S+/);
        renderShareSlot(data.shareUrl || (shareMatch ? shareMatch[0] : null));
        const shownReply = shareMatch
          ? data.reply.replace(/\n*Xで せかいに じまんする:\s*\n?https:\/\/x\.com\/intent\/(?:tweet|post)\?text=\S+/, "").trimEnd()
          : data.reply;
        try {
          await queueTypewrite(shownReply);
        } catch {}
        const isDoomEnding = /せかいめつぼう|せかいは ほろんだ/.test(data.reply);
        if (data.cleared && !wasCleared && !isDoomEnding) {
          wasCleared = true;
          showCredits(data.hud && data.hud.name);
        } else if (data.cleared) {
          wasCleared = true;
        }
        if (data.needsName) {
          heroName = "";
          try {
            localStorage.removeItem(nameKey);
          } catch {}
          renderName();
          renderSuggestions(["なまえを つける"], { allowInput: false });
        } else if (data.hud && typeof data.hud.name === "string" && data.hud.name) {
          heroName = data.hud.name;
          try {
            localStorage.setItem(nameKey, heroName);
          } catch {}
        }
      }
    } catch {
      window.clearInterval(waitingTimer);
      waiting.remove();
      addMessage("sys", "＊「つうしんに しっぱいした。もういちど ためすのだ。」");
    } finally {
      setBusy(false);
    }
  };
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value;
    setComposerOpen(false);
    void submit(value);
  });
  hints.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }
    if (target.dataset.input) {
      setComposerOpen(composer.hidden);
      return;
    }
    if (target.dataset.text === "なまえを つける") {
      renderName();
      setOverlayOpen(true);
      return;
    }
    if (target.dataset.text) {
      void submit(target.dataset.text);
    }
  });

  const KANA_ROWS = [
    "あいうえおはひふへほ",
    "かきくけこまみむめも",
    "さしすせそやゆよわん",
    "たちつてとらりるれろ",
    "なにぬねのがぎぐげご",
    "ざじずぜぞだぢづでど",
    "ばびぶべぼぱぴぷぺぽ",
    "ぁぃぅぇぉゃゅょっー",
    "0123456789",
  ];
  const NAME_MAX = 6;
  let heroName = "";
  const renderName = () => {
    nameDisplay.replaceChildren();
    const chars = Array.from(heroName);
    for (let i = 0; i < NAME_MAX; i += 1) {
      const slot = document.createElement("span");
      slot.className = "slot" + (i === chars.length ? " active" : "");
      slot.textContent = chars[i] ?? "";
      nameDisplay.appendChild(slot);
    }
    nameDisplay.setAttribute("aria-label", chars.length > 0 ? chars.join("") : "なまえ みにゅうりょく");
    updateNameActions();
  };
  const startAdventure = (name) => {
    setOverlayOpen(false);
    try {
      localStorage.setItem(nameKey, name);
    } catch {}
    void submit("ぼうけんをはじめて。ゆうしゃの なまえは「" + name + "」だ。");
  };
  let kanaMode = "hira";
  const toKatakana = (text) =>
    text.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  const buildKanaGrid = () => {
    kana.replaceChildren();
    for (const row of KANA_ROWS) {
      const rowChars = kanaMode === "kata" ? toKatakana(row) : row;
      for (const ch of Array.from(rowChars)) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = ch;
        button.addEventListener("click", () => {
          if (Array.from(heroName).length < NAME_MAX) {
            heroName += ch;
            renderName();
          }
        });
        kana.appendChild(button);
      }
    }
  };
  buildKanaGrid();
  nameKanaToggle.addEventListener("click", () => {
    kanaMode = kanaMode === "hira" ? "kata" : "hira";
    nameKanaToggle.textContent = kanaMode === "hira" ? "カタカナ" : "ひらがな";
    buildKanaGrid();
  });
  nameBack.addEventListener("click", () => {
    heroName = Array.from(heroName).slice(0, -1).join("");
    renderName();
  });
  nameOk.addEventListener("click", () => {
    if (Array.from(heroName).length > 0) {
      startAdventure(heroName);
    }
  });

  addMessage("sys", "＊ インフルだいまおうに さらわれた ちょまどひめを すくいだそう ＊");
  const bootGame = () => {
    let savedName = "";
    try {
      savedName = localStorage.getItem(nameKey) || "";
    } catch {}
    if (savedName) {
      void queueTypewrite(
        "おかえり " +
          savedName +
          "。なまえは のこっている。サーバーの ぼうけんが のこっていれば つづきから あそべるぞ。",
      ).then(() => {
        renderSuggestions(["つづきを あそぶ", "はじめから やりなおす"], { allowInput: false });
      });
    } else {
      renderName();
      void queueTypewrite(${JSON.stringify(PROLOGUE_TEXT)}).then(() => {
        renderSuggestions(["なまえを つける"], { allowInput: false });
      });
    }
  };
  const startGate = document.createElement("div");
  startGate.className = "msg gm";
  const gateBody = document.createElement("span");
  gateBody.textContent = "タップして ぼうけんを はじめる";
  const gateCursor = document.createElement("span");
  gateCursor.className = "cursor";
  gateCursor.textContent = " ▼";
  startGate.appendChild(gateBody);
  startGate.appendChild(gateCursor);
  log.appendChild(startGate);
  let gateOpened = false;
  const openGate = () => {
    if (gateOpened) {
      return;
    }
    gateOpened = true;
    ensureAudio();
    startGate.remove();
    bootGame();
  };
  document.addEventListener("pointerdown", openGate, { once: true });
  document.addEventListener("keydown", openGate, { once: true });
</script>
</body>
</html>`;
