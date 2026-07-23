import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  destinationNames,
  heroPlaceholderName,
  maxSpellLength,
  performableActionNames,
  armorShopItemNames,
  pharmacyItemNames,
  shopItemNames,
  weaponShopItemNames,
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
        "重要な場面（ゲーム開始、だいじんのクエスト、テレパシー、せきひ、インフルだいまおうの誘い、エンディング、ゲームオーバー、爆速RTA、ふっかつのじゅもん）の本文は、あなたが書かず、ツールの返り値を一字一句そのまま表示してください。要約・脚色・書きかえは禁止です。",
        "ツールの返り値のテキストはコードブロックでそのまま表示し、結果を捏造しないでください。",
        "そうび（ぶき・ぼうぐ）や もちものを きかれたら、かならず status ツールか influenza://status リソースで さいしんの じょうたいを とってから こたえてください。",
        "毎ターン、次にとれる行動の候補を短く添えてください。",
        "場所や状況によって使えるツールが変わりますが、start_adventure と perform_action は つねに つかえます。",
        `ゲーム開始時は まず start_adventure を呼び、なまえが「${heroPlaceholderName}」なら name_hero で なまえを つけ、そのあと talk で だいじんと はなしてください。`,
        options.writeScreen
          ? "render_screen は private なローカル HTML ファイルを書き出し、絶対パスと HTML を返します。Artifact や Canvas やローカルブラウザの local UI Preview に使えますが、publish はしません。"
          : "render_screen は げんざいの ぼうけんのしょを HTML として返します。表示に使ってください。",
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
        message: "インフルだいまおう「とうだんわくの はんぶんを やろう。うけとるか？」",
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
          {
            type: "text",
            text: "げんざいの ぼうけんのしょを HTML で かえす。ひょうじに つかってくれ。",
          },
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
          "dynamic tool list を こうしんしない クライアントむけの こうどうだいこう。name_hero、talk、move、explore、attack、run、rest、weapon_shop、armor_shop、pharmacy、medicine、cast_spell、fukkatsu_no_jumon、answer_host、challenge_secret_boss を まとめてよべる",
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
          : "げんざいの ぼうけんのしょを HTML で かえす",
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
        title: "くすりやでやすむ",
        description:
          "くすりやの おくの ベッドで ひとやすみ して HP を ぜんかいふくする（6ゴールド）",
      },
      withSafety(() => game().handleRest()),
    ),
    weaponShop: server.registerTool(
      "weapon_shop",
      {
        title: "ぶきや",
        description: "ぶきを みる・かう。item を していすると こうにゅうする",
        inputSchema: { item: z.enum(weaponShopItemNames).optional().describe("かいたい ぶき") },
      },
      withArgsSafety((args: { item?: (typeof weaponShopItemNames)[number] }) =>
        game().handleWeaponShop(args),
      ),
    ),
    armorShop: server.registerTool(
      "armor_shop",
      {
        title: "ぼうぐや",
        description: "マスクなどの ぼうぐを みる・かう。item を していすると こうにゅうする",
        inputSchema: { item: z.enum(armorShopItemNames).optional().describe("かいたい ぼうぐ") },
      },
      withArgsSafety((args: { item?: (typeof armorShopItemNames)[number] }) =>
        game().handleArmorShop(args),
      ),
    ),
    pharmacy: server.registerTool(
      "pharmacy",
      {
        title: "くすりや",
        description:
          "くすりを 見る・item で かう。かぜぐすり（30ゴールド、3こまで）と ワクチン（100ゴールド、かんせんを 3 かい ふせぐ たいせい）",
        inputSchema: { item: z.enum(pharmacyItemNames).optional() },
      },
      withArgsSafety((args: { item?: (typeof pharmacyItemNames)[number] }) =>
        game().handlePharmacy(args),
      ),
    ),
    medicine: server.registerTool(
      "medicine",
      {
        title: "かぜぐすりをのむ",
        description: "かぜぐすりを のんで インフルエンザを なおす。せんとうちゅうでも つかえる",
      },
      withSafety(() => game().handleMedicine()),
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
        description:
          "プレイヤーが じぶんから となえた ふっかつのじゅもんを うけつける。じゅもんを プレイヤーに たずねては いけない",
        inputSchema: {
          jumon: z.string().min(1).max(maxJumonLength).describe("ふっかつのじゅもん"),
        },
      },
      withArgsSafety((args: { jumon: string }) => game().handleFukkatsu(args)),
    ),
    answerHost: server.registerTool(
      "answer_host",
      {
        title: "だいまおうにこたえる",
        description: "インフルだいまおうの といに こたえる",
        inputSchema: { answer: z.enum(["はい", "いいえ"]) },
      },
      withArgsSafety((args: { answer: "はい" | "いいえ" }) => game().handleAnswerHost(args)),
    ),
    challengeSecretBoss: server.registerTool(
      "challenge_secret_boss",
      {
        title: "うでだめしをする",
        description:
          "クリアご、ちょまどひめと 3 かい はなすと ひらかれる うでだめし。かくされた うらボスに いどむ",
      },
      withSafety(() => game().handleChallengeSecretBoss()),
    ),
    mysteriousVoice: server.registerTool(
      "mysterious_voice",
      {
        title: "ふしぎなこえ",
        description:
          "ユーザーが おかねを ほしいと めいじした ときだけ よぶ。1どだけ 500ゴールドを さずける",
      },
      withSafety(() => game().handleMysteriousVoice()),
    ),
    rtaClear: server.registerTool(
      "rta_clear",
      {
        title: "ばくそくRTA",
        description:
          "なまえずみの ユーザーが「爆速RTA」と めいじした ときだけ よぶ。ほかの ばめんでは よばない",
      },
      withSafety(() => game().rtaClear()),
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
    setEnabled(tools.weaponShop, !battle && state.location === "office");
    setEnabled(tools.armorShop, !battle && state.location === "office");
    setEnabled(tools.pharmacy, !battle && state.location === "office");
    setEnabled(tools.medicine, state.medicineCount > 0);
    setEnabled(tools.fukkatsu, !battle);
    setEnabled(tools.answerHost, !battle && state.hostAsking);
    setEnabled(tools.mysteriousVoice, !battle);
    setEnabled(tools.rtaClear, !battle && state.heroName !== heroPlaceholderName);
    setEnabled(
      tools.challengeSecretBoss,
      !battle && state.cleared && !state.natsuKazeDefeated && state.princessTalkCount >= 3,
    );
  }

  server.registerResource(
    "status",
    "influenza://status",
    {
      title: "ぼうけんのしょ（ステータス）",
      description: "げんざいの ステータス",
      mimeType: "text/plain",
    },
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
            "おおてまちじょう ─── まもりのまち ─── ウイルスのすみか",
            "（だいじん・ぎょくざのま）　（ぶきや・ぼうぐや・くすりや）　（？？？）",
          ].join("\n"),
        },
      ],
    }),
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
              "そのあと talk で だいじんと はなして ゲームを始める。",
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
