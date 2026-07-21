import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  destinationNames,
  heroPlaceholderName,
  maxSpellLength,
  performableActionNames,
  shopItemNames,
  type Engine,
  type HostOfferResponse,
  type ToolResult,
} from "./engine.js";
import { maxJumonLength } from "./state.js";

export type GameServerOptions = {
  writeScreen?: (html: string) => string;
};

export function createGameServer(options: GameServerOptions = {}): {
  server: McpServer;
  attachEngine: (engine: Engine) => void;
  elicitHostOffer: () => Promise<HostOfferResponse>;
  refreshTools: () => void;
} {
  const server = new McpServer(
    { name: "influenza-quest", version: "0.1.0" },
    {
      instructions: [
        "インフルエンザテーマのレトロ風テキスト RPG のゲームサーバーです。あなたはゲームマスターとして進行してください。",
        "ツールの返り値のテキストはコードブロックでそのまま表示し、結果を捏造しないでください。",
        "毎ターン、次にとれる行動の候補を短く添えてください。",
        "場所や状況によって使えるツールが変わりますが、start_adventure と perform_action は つねに つかえます。",
        `ゲーム開始時は まず start_adventure を呼び、なまえが「${heroPlaceholderName}」なら name_hero で なまえを つけ、そのあと talk で しゅさいしゃと はなしてください。`,
        options.writeScreen
          ? "render_screen は private なローカル HTML ファイルを書き出し、絶対パスと HTML を返します。Artifact や Canvas やローカルブラウザの local UI Preview に使えますが、publish はしません。"
          : "render_screen は げんざいの カルテを HTML として返します。表示に使ってください。",
      ].join("\n"),
    },
  );

  let engine: Engine | null = null;

  const game = (): Engine => {
    if (!engine) {
      throw new Error("engine is not attached");
    }
    return engine;
  };

  async function elicitHostOffer(): Promise<HostOfferResponse> {
    try {
      const response = await server.server.elicitInput({
        message: "しゅさいしゃ「とうだんわくの はんぶんを そなたに やろう。うけとるか？」",
        requestedSchema: {
          type: "object",
          properties: {
            answer: { type: "string", title: "こたえ", enum: ["はい", "いいえ"] },
          },
          required: ["answer"],
        },
      });
      if (response.action === "accept") {
        const answer =
          typeof response.content?.answer === "string" ? response.content.answer : undefined;
        return { action: "accept", answer };
      }
      if (response.action === "decline") {
        return { action: "decline" };
      }
      return { action: "cancel" };
    } catch (error) {
      if (error instanceof Error && /elicitation|not supported|capabilit/i.test(error.message)) {
        return { action: "unsupported" };
      }
      return { action: "failed" };
    }
  }

  function withSafety(handler: () => Promise<ToolResult> | ToolResult) {
    return async () => {
      try {
        return await handler();
      } catch {
        return game().errorText("せかいが ふあんていになっている。もういちど ためしてくれ。");
      }
    };
  }

  function withArgsSafety<T>(handler: (args: T) => Promise<ToolResult> | ToolResult) {
    return async (args: T) => {
      try {
        return await handler(args);
      } catch {
        return game().errorText("せかいが ふあんていになっている。もういちど ためしてくれ。");
      }
    };
  }

  function handleRenderScreen(): ToolResult {
    const html = game().screenHtml();
    if (!options.writeScreen) {
      return {
        content: [
          { type: "text", text: "げんざいの カルテを HTML で かえす。ひょうじに つかってくれ。" },
          { type: "text", text: html },
        ],
      };
    }
    let filePath: string;
    try {
      filePath = options.writeScreen(html);
    } catch {
      return game().errorText("ローカル UI Preview の かきだしに しっぱいした。");
    }
    return {
      content: [
        {
          type: "text",
          text: [
            "ローカル UI Preview 用の HTML を かきだした。",
            "これは publish しない。",
            `パス: ${filePath}`,
            "Artifact や Canvas やローカルブラウザで ひらいてつかってくれ。",
          ].join("\n"),
        },
        { type: "text", text: html },
      ],
    };
  }

  const tools = {
    startAdventure: server.registerTool(
      "start_adventure",
      {
        title: "ぼうけんをはじめる",
        description: "げんざいの ぼうけんの じょうたいと、つぎに とるべき こうどうを かえす",
      },
      withSafety(() => game().handleStartAdventure()),
    ),
    performAction: server.registerTool(
      "perform_action",
      {
        title: "こうどうをだいこうする",
        description:
          "dynamic tool list を こうしんしない クライアントむけの こうどうだいこう。name_hero、talk、move、explore、attack、run、rest、clinic、pharmacy、cast_spell、fukkatsu_no_jumon、answer_host を まとめてよべる",
        inputSchema: {
          action: z.enum(performableActionNames),
          name: z.string().min(1).max(128).optional(),
          destination: z.enum(destinationNames).optional(),
          item: z.enum(shopItemNames).optional(),
          spell: z.string().min(1).max(maxSpellLength).optional(),
          jumon: z.string().min(1).max(maxJumonLength).optional(),
          answer: z.enum(["はい", "いいえ"]).optional(),
        },
      },
      withArgsSafety((args: Parameters<Engine["handlePerformAction"]>[0]) =>
        game().handlePerformAction(args),
      ),
    ),
    newGame: server.registerTool(
      "new_game",
      {
        title: "はじめから",
        description:
          "ぼうけんを はじめから やりなおす。confirmation に NEW_GAME を そのまま いれてくれ",
        inputSchema: { confirmation: z.literal("NEW_GAME") },
      },
      withArgsSafety((args: { confirmation: "NEW_GAME" }) => game().handleNewGame(args)),
    ),
    status: server.registerTool(
      "status",
      { title: "つよさ", description: "ゆうしゃの ステータスを みる" },
      withSafety(() => game().handleStatus()),
    ),
    nameHero: server.registerTool(
      "name_hero",
      {
        title: "なまえをつける",
        description: "ゆうしゃに なまえを つける",
        inputSchema: { name: z.string().min(1).max(128).describe("ゆうしゃの なまえ") },
      },
      withArgsSafety((args: { name: string }) => game().handleNameHero(args)),
    ),
    renderScreen: server.registerTool(
      "render_screen",
      {
        title: "がめんをえがく",
        description: options.writeScreen
          ? "private な ローカル UI Preview 用 HTML を かきだし、絶対パスと HTML を かえす。publish はしない"
          : "げんざいの カルテを HTML で かえす",
      },
      withSafety(handleRenderScreen),
    ),
    talk: server.registerTool(
      "talk",
      { title: "はなす", description: "そのばしょの ひとと はなす" },
      withSafety(() => game().handleTalk()),
    ),
    move: server.registerTool(
      "move",
      {
        title: "いどう",
        description: "べつの ばしょへ いどうする",
        inputSchema: { destination: z.enum(destinationNames).describe("いきたい ばしょ") },
      },
      withArgsSafety((args: { destination: (typeof destinationNames)[number] }) =>
        game().handleMove(args),
      ),
    ),
    explore: server.registerTool(
      "explore",
      { title: "おくへすすむ", description: "すみかの おくへ すすむ" },
      withSafety(() => game().handleExplore()),
    ),
    attack: server.registerTool(
      "attack",
      { title: "たたかう", description: "てきを こうげきする" },
      withSafety(() => game().handleAttack()),
    ),
    run: server.registerTool(
      "run",
      { title: "にげる", description: "せんとうから にげる" },
      withSafety(() => game().handleRun()),
    ),
    rest: server.registerTool(
      "rest",
      {
        title: "きゅうけいしつ",
        description: "ひとやすみ して HP を ぜんかいふくする（6ゴールド）",
      },
      withSafety(() => game().handleRest()),
    ),
    clinic: server.registerTool(
      "clinic",
      { title: "しんりょうじょ", description: "カルテに きろくする（セーブ）" },
      withSafety(() => game().handleClinic()),
    ),
    pharmacy: server.registerTool(
      "pharmacy",
      {
        title: "やっきょく",
        description: "そうびを みる・かう。item を していすると こうにゅうする",
        inputSchema: { item: z.enum(shopItemNames).optional().describe("かいたい そうび") },
      },
      withArgsSafety((args: { item?: (typeof shopItemNames)[number] }) =>
        game().handlePharmacy(args),
      ),
    ),
    castSpell: server.registerTool(
      "cast_spell",
      {
        title: "じゅもんをとなえる",
        description: "じゅもんを となえる",
        inputSchema: { spell: z.string().min(1).max(maxSpellLength).describe("となえる じゅもん") },
      },
      withArgsSafety((args: { spell: string }) => game().handleCastSpell(args)),
    ),
    fukkatsu: server.registerTool(
      "fukkatsu_no_jumon",
      {
        title: "ふっかつのじゅもん",
        description: "ふっかつのじゅもんを となえて ぼうけんを さいかいする",
        inputSchema: {
          jumon: z.string().min(1).max(maxJumonLength).describe("ふっかつのじゅもん"),
        },
      },
      withArgsSafety((args: { jumon: string }) => game().handleFukkatsu(args)),
    ),
    answerHost: server.registerTool(
      "answer_host",
      {
        title: "しゅさいしゃにこたえる",
        description: "しゅさいしゃの といに こたえる",
        inputSchema: { answer: z.enum(["はい", "いいえ"]) },
      },
      withArgsSafety((args: { answer: "はい" | "いいえ" }) => game().handleAnswerHost(args)),
    ),
  };

  function refreshTools() {
    if (!engine) {
      return;
    }
    const state = engine.state;
    const battle = state.inBattle;
    const setEnabled = (
      tool: { enabled: boolean; enable: () => void; disable: () => void },
      on: boolean,
    ) => {
      if (tool.enabled === on) {
        return;
      }
      if (on) {
        tool.enable();
        return;
      }
      tool.disable();
    };
    setEnabled(tools.attack, battle);
    setEnabled(tools.run, battle);
    setEnabled(tools.nameHero, !battle);
    setEnabled(tools.move, !battle);
    setEnabled(tools.talk, !battle);
    setEnabled(tools.explore, !battle && state.location === "lair");
    setEnabled(tools.rest, !battle && state.location === "office");
    setEnabled(tools.clinic, !battle && state.location === "office");
    setEnabled(tools.pharmacy, !battle && state.location === "office");
    setEnabled(tools.fukkatsu, !battle);
    setEnabled(tools.answerHost, !battle && state.hostAsking && state.location === "venue");
  }

  server.registerResource(
    "status",
    "influenza://status",
    { title: "カルテ（ステータス）", description: "げんざいの ステータス", mimeType: "text/plain" },
    async (uri) => ({ contents: [{ uri: uri.href, text: game().statusText() }] }),
  );

  server.registerResource(
    "map",
    "influenza://map",
    { title: "せかいちず", description: "この せかいの ちず", mimeType: "text/plain" },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: [
            "イベントかいじょう ─── オフィスがい ─── ウイルスのすみか",
            "（しゅさいしゃ）　（きゅうけい・しんりょうじょ・やっきょく）　（？？？）",
          ].join("\n"),
        },
      ],
    }),
  );

  server.registerResource(
    "fukkatsu",
    "influenza://fukkatsu-no-jumon",
    {
      title: "ふっかつのじゅもん",
      description: "げんざいの じょうたいを あらわす じゅもん",
      mimeType: "text/plain",
    },
    async (uri) => ({ contents: [{ uri: uri.href, text: game().currentJumon() }] }),
  );

  server.registerPrompt(
    "start-adventure",
    { title: "ぼうけんをはじめる", description: "インフルクエストを はじめる" },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "あなたはレトロ RPG のゲームマスターです。influenza-quest MCP サーバーのツールでゲームを進行してください。",
              "ルール:",
              "・サーバーが返すテキストはコードブロックで原文のまま表示する",
              "・結果を捏造しない。かならずツールを呼んで進める",
              "・毎ターン、次にとれる行動を 2〜4 個、短く提示する",
              "・レトロ RPG の雰囲気をこわさない",
              "まず start_adventure を呼ぶ。",
              `なまえが「${heroPlaceholderName}」なら name_hero で なまえを つける。`,
              "そのあと talk で イベントかいじょうの しゅさいしゃと はなしてゲームを始める。",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  function attachEngine(next: Engine) {
    engine = next;
    refreshTools();
  }

  return { server, attachEngine, elicitHostOffer, refreshTools };
}
