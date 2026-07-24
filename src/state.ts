import { Buffer } from "node:buffer";
import { z } from "zod";

export const locationIds = ["venue", "town", "lair"] as const;
export const weaponNames = [
  "たいおんけい",
  "アルコールスプレー",
  "じょきんのやり",
  "でんせつのワクチンソード",
  "ロトのつるぎ",
] as const;
export const armorNames = [
  "ふだんぎ",
  "ファントムマスク",
  "N95マスク",
  "かんせんたいさくスーツ",
  "ロトのよろい",
] as const;
export const armorDefenseByName = {
  ふだんぎ: 0,
  ファントムマスク: 2,
  N95マスク: 4,
  かんせんたいさくスーツ: 7,
  ロトのよろい: 12,
} as const;
export const infectionPreventionByArmor = {
  ふだんぎ: 0,
  ファントムマスク: 0.25,
  N95マスク: 0.5,
  かんせんたいさくスーツ: 0.75,
  ロトのよろい: 1,
} as const;
export const enemyNames = [
  "くしゃみこぞう",
  "ウイルスりゅうし",
  "せきしぶき",
  "へんいかぶ",
  "へんいした ウイルスりゅうし",
  "へんいした せきしぶき",
  "へんいした へんいかぶ",
  "へんいかぶの おやだま",
  "インフルだいまおう",
  "ナツカゼだいまおう",
] as const;
export const weaponAttackByName = {
  たいおんけい: 5,
  アルコールスプレー: 14,
  じょきんのやり: 22,
  でんせつのワクチンソード: 30,
  ロトのつるぎ: 40,
} as const;
export const maxJumonLength = 8192;
export const maxHeroNameCodePoints = 24;

const disallowedCharacterPattern = new RegExp(
  "[\\u0000-\\u001F\\u007F-\\u009F\\u00AD\\u061C\\u200B-\\u200F\\u202A-\\u202E\\u2060\\u2066-\\u2069\\uFEFF]",
  "u",
);
const strictBase64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const integerRange = (min: number, max: number) => z.number().int().min(min).max(max);
const hasDisallowedCharacters = (value: string) => disallowedCharacterPattern.test(value);
const codePointLength = (value: string) => Array.from(value).length;
const normalizeText = (value: string) => value.normalize("NFKC").trim();
export const maxHpForLevel = (level: number) => 30 + (level - 1) * 8;

export function normalizeHeroName(value: string): string {
  const normalized = normalizeText(value);
  if (normalized.length === 0) {
    throw new Error("invalid hero name");
  }
  if (hasDisallowedCharacters(normalized)) {
    throw new Error("invalid hero name");
  }
  if (codePointLength(normalized) > maxHeroNameCodePoints) {
    throw new Error("invalid hero name");
  }
  return normalized;
}

export function katakanaToHiragana(value: string): string {
  return value.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

export function normalizeSpellText(value: string): string {
  const normalized = normalizeText(value);
  if (normalized.length === 0) {
    throw new Error("invalid spell");
  }
  if (hasDisallowedCharacters(normalized)) {
    throw new Error("invalid spell");
  }
  return normalized;
}

export function isStrictBase64(value: string): boolean {
  return (
    value.length > 0 &&
    value.length % 4 === 0 &&
    strictBase64Pattern.test(value) &&
    Buffer.from(value, "base64").toString("base64") === value
  );
}

export const enemySchema = z
  .object({
    name: z.enum(enemyNames),
    hp: integerRange(0, 999),
    attack: integerRange(0, 999),
    exp: integerRange(0, 999999),
    gold: integerRange(0, 999999),
    boss: z.boolean(),
    rounds: integerRange(0, 99).default(0),
    maxHp: integerRange(0, 999).default(0),
  })
  .strict();

const locationSchema = z.enum(locationIds);
const weaponSchema = z.enum(weaponNames);
const armorSchema = z.enum(armorNames);
const heroNameSchema = z.preprocess(
  (value) => (typeof value === "string" ? normalizeText(value) : value),
  z
    .string()
    .min(1)
    .refine((value) => !hasDisallowedCharacters(value))
    .refine((value) => codePointLength(value) <= maxHeroNameCodePoints),
);

const gameStateFields = {
  heroName: heroNameSchema,
  level: integerRange(1, 60),
  exp: integerRange(0, 999999),
  hp: integerRange(0, 999),
  maxHp: integerRange(1, 999),
  gold: integerRange(0, 999999),
  weapon: weaponSchema,
  weaponAttack: integerRange(0, 999),
  armor: armorSchema.default("ふだんぎ"),
  armorDefense: integerRange(0, 999).default(0),
  infected: z.boolean().default(false),
  medicineCount: integerRange(0, 3).default(0),
  immunityCount: integerRange(0, 3).default(0),
  hostTalkCount: integerRange(0, 999).default(0),
  location: locationSchema,
  lairDepth: integerRange(0, 5),
  floorEncounters: integerRange(0, 3).default(0),
  defeatedEnemies: z.array(z.enum(enemyNames)).max(10).default([]),
  voiceGoldGiven: z.boolean().default(false),
  virusKingEnded: z.boolean().default(false),
  tabletFound: z.boolean(),
  hostGreeted: z.boolean(),
  miniBossDefeated: z.boolean().default(false),
  startedAtMs: integerRange(0, Number.MAX_SAFE_INTEGER).default(0),
  clearMs: integerRange(0, Number.MAX_SAFE_INTEGER).default(0),
  bossDefeated: z.boolean(),
  princessCarried: z.boolean(),
  hostAsking: z.boolean(),
  cleared: z.boolean(),
  cheatCleared: z.boolean(),
  rtaCleared: z.boolean().default(false),
  natsuKazeDefeated: z.boolean().default(false),
  princessTalkCount: integerRange(0, 999).default(0),
  fanMode: z.boolean().default(false),
  inBattle: z.boolean(),
  enemy: enemySchema.nullable(),
} satisfies z.ZodRawShape;

function validateGameStateInvariants(
  value: {
    hp: number;
    maxHp: number;
    weapon: (typeof weaponNames)[number];
    weaponAttack: number;
    armor: (typeof armorNames)[number];
    armorDefense: number;
    level: number;
    inBattle: boolean;
    enemy: Enemy | null;
    princessCarried: boolean;
    bossDefeated: boolean;
    cleared: boolean;
    cheatCleared: boolean;
    hostAsking: boolean;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.armorDefense !== armorDefenseByName[value.armor]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "armorDefense must match armor",
      path: ["armorDefense"],
    });
  }
  if (value.hp > value.maxHp) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "hp must be less than or equal to maxHp",
      path: ["hp"],
    });
  }
  if (value.weaponAttack !== weaponAttackByName[value.weapon]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "weaponAttack must match weapon",
      path: ["weaponAttack"],
    });
  }
  if (value.maxHp !== maxHpForLevel(value.level)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "maxHp must match level progression",
      path: ["maxHp"],
    });
  }
  if (value.inBattle && value.enemy === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "enemy is required during battle",
      path: ["enemy"],
    });
  }
  if (!value.inBattle && value.enemy !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "enemy must be null outside battle",
      path: ["enemy"],
    });
  }
  if (value.princessCarried && (!value.bossDefeated || value.cleared)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "princessCarried requires bossDefeated and uncleared state",
      path: ["princessCarried"],
    });
  }
  if (value.cheatCleared && (!value.cleared || !value.bossDefeated)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "cheatCleared requires cleared and bossDefeated",
      path: ["cheatCleared"],
    });
  }
  if (value.cleared && value.princessCarried) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "cleared state cannot carry princess",
      path: ["cleared"],
    });
  }
  if (value.cleared && value.hostAsking) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "cleared state cannot keep hostAsking",
      path: ["hostAsking"],
    });
  }
}

export const gameStateSchema = z
  .object(gameStateFields)
  .strict()
  .superRefine(validateGameStateInvariants);

const gameLogLineSchema = z
  .string()
  .max(500)
  .refine((value) => !hasDisallowedCharacters(value));
export const gameLogSchema = z.array(gameLogLineSchema).max(60);

export const saveFileV1Schema = z
  .object({
    version: z.literal(1),
    ...gameStateFields,
    gameLog: gameLogSchema,
    savedAt: z.string().min(1).max(64).datetime({ offset: true }),
  })
  .strict()
  .superRefine(validateGameStateInvariants);

export type Enemy = z.infer<typeof enemySchema>;
export type GameState = z.infer<typeof gameStateSchema>;
export type SaveFileV1 = z.infer<typeof saveFileV1Schema>;

export const initialState: GameState = gameStateSchema.parse({
  heroName: "ななしのゆうしゃ",
  level: 1,
  exp: 0,
  hp: 30,
  maxHp: maxHpForLevel(1),
  gold: 0,
  weapon: "たいおんけい",
  weaponAttack: weaponAttackByName["たいおんけい"],
  armor: "ふだんぎ",
  armorDefense: armorDefenseByName["ふだんぎ"],
  infected: false,
  medicineCount: 0,
  immunityCount: 0,
  hostTalkCount: 0,
  location: "venue",
  lairDepth: 0,
  floorEncounters: 0,
  defeatedEnemies: [],
  voiceGoldGiven: false,
  virusKingEnded: false,
  tabletFound: false,
  hostGreeted: false,
  miniBossDefeated: false,
  startedAtMs: 0,
  clearMs: 0,
  bossDefeated: false,
  princessCarried: false,
  hostAsking: false,
  cleared: false,
  cheatCleared: false,
  rtaCleared: false,
  inBattle: false,
  enemy: null,
});

export function createInitialState(): GameState {
  return { ...initialState, defeatedEnemies: [] };
}

export function appendGameText(gameLog: string[], text: string): void {
  for (const line of text.split("\n")) {
    const clipped = line.slice(0, 500);
    if (hasDisallowedCharacters(clipped)) {
      throw new Error("invalid game log");
    }
    gameLog.push(clipped);
  }
  while (gameLog.length > 60) {
    gameLog.shift();
  }
}

export function createSaveFileV1(
  state: GameState,
  gameLog: string[],
  savedAt = new Date().toISOString(),
): SaveFileV1 {
  return saveFileV1Schema.parse({
    version: 1,
    ...state,
    gameLog: [...gameLog],
    savedAt,
  });
}

function restoreBattleState(state: GameState): GameState {
  return {
    ...state,
    inBattle: false,
    enemy: null,
  };
}

function extractGameStateFromSaveFile(saveFile: SaveFileV1): GameState {
  return {
    heroName: saveFile.heroName,
    level: saveFile.level,
    exp: saveFile.exp,
    hp: saveFile.hp,
    maxHp: saveFile.maxHp,
    gold: saveFile.gold,
    weapon: saveFile.weapon,
    weaponAttack: saveFile.weaponAttack,
    armor: saveFile.armor,
    armorDefense: saveFile.armorDefense,
    infected: saveFile.infected,
    medicineCount: saveFile.medicineCount,
    immunityCount: saveFile.immunityCount,
    hostTalkCount: saveFile.hostTalkCount,
    location: saveFile.location,
    lairDepth: saveFile.lairDepth,
    floorEncounters: saveFile.floorEncounters,
    defeatedEnemies: saveFile.defeatedEnemies,
    voiceGoldGiven: saveFile.voiceGoldGiven,
    virusKingEnded: saveFile.virusKingEnded,
    tabletFound: saveFile.tabletFound,
    hostGreeted: saveFile.hostGreeted,
    miniBossDefeated: saveFile.miniBossDefeated,
    startedAtMs: saveFile.startedAtMs,
    clearMs: saveFile.clearMs,
    bossDefeated: saveFile.bossDefeated,
    princessCarried: saveFile.princessCarried,
    hostAsking: saveFile.hostAsking,
    cleared: saveFile.cleared,
    cheatCleared: saveFile.cheatCleared,
    rtaCleared: saveFile.rtaCleared,
    natsuKazeDefeated: saveFile.natsuKazeDefeated,
    princessTalkCount: saveFile.princessTalkCount,
    fanMode: saveFile.fanMode,
    inBattle: saveFile.inBattle,
    enemy: saveFile.enemy,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ReadStoredGameDataOptions = {
  preserveBattle?: boolean;
};

function normalizeStoredState(
  state: GameState,
  options: ReadStoredGameDataOptions,
): ReturnType<typeof gameStateSchema.safeParse> {
  return gameStateSchema.safeParse(options.preserveBattle ? state : restoreBattleState(state));
}

export function readStoredGameData(
  value: unknown,
  options: ReadStoredGameDataOptions = {},
):
  | { ok: true; format: "legacy" | "v1"; state: GameState; gameLog: string[]; savedAt?: string }
  | { ok: false; reason: "invalid" | "future-version"; issues?: string[] } {
  if (isRecord(value) && typeof value.exp === "number" && value.exp > 999999) {
    value = { ...value, exp: 999999 };
  }
  if (isRecord(value) && isRecord(value.enemy) && value.enemy.name === "なつかぜだいまおう") {
    value = { ...value, enemy: { ...value.enemy, name: "ナツカゼだいまおう" } };
  }
  if (isRecord(value) && value.location === "office") {
    value = { ...value, location: "town" };
  }
  if (isRecord(value) && "version" in value) {
    if (value.version !== 1) {
      return { ok: false, reason: "future-version" };
    }
    const parsed = saveFileV1Schema.safeParse(value);
    if (!parsed.success) {
      return {
        ok: false,
        reason: "invalid",
        issues: parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      };
    }
    const restored = normalizeStoredState(extractGameStateFromSaveFile(parsed.data), options);
    if (!restored.success) {
      return {
        ok: false,
        reason: "invalid",
        issues: restored.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      };
    }
    return {
      ok: true,
      format: "v1",
      state: restored.data,
      gameLog: [...parsed.data.gameLog],
      savedAt: parsed.data.savedAt,
    };
  }
  const parsed = gameStateSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, reason: "invalid" };
  }
  const restored = normalizeStoredState(parsed.data, options);
  if (!restored.success) {
    return { ok: false, reason: "invalid" };
  }
  return {
    ok: true,
    format: "legacy",
    state: restored.data,
    gameLog: [],
  };
}
