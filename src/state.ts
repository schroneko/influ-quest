import { Buffer } from "node:buffer";
import { z } from "zod";

export const locationIds = ["venue", "office", "lair"] as const;
export const weaponNames = ["ふつうのマスク", "N95マスク", "ワクチンちゅうしゃき"] as const;
export const enemyNames = [
  "ウイルスりゅうし",
  "せきしぶき",
  "へんいかぶ",
  "インフルだいまおう",
] as const;
export const weaponAttackByName = {
  ふつうのマスク: 6,
  N95マスク: 14,
  ワクチンちゅうしゃき: 22,
} as const;
export const maxJumonLength = 8192;
export const maxHeroNameCodePoints = 24;

const disallowedCharacterPattern = new RegExp(
  "[\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]",
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
  })
  .strict();

const locationSchema = z.enum(locationIds);
const weaponSchema = z.enum(weaponNames);
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
  level: integerRange(1, 5),
  exp: integerRange(0, 999999),
  hp: integerRange(0, 999),
  maxHp: integerRange(1, 999),
  gold: integerRange(0, 999999),
  weapon: weaponSchema,
  weaponAttack: integerRange(0, 999),
  location: locationSchema,
  lairDepth: integerRange(0, 3),
  tabletFound: z.boolean(),
  hostGreeted: z.boolean(),
  bossDefeated: z.boolean(),
  princessCarried: z.boolean(),
  hostAsking: z.boolean(),
  cleared: z.boolean(),
  cheatCleared: z.boolean(),
  inBattle: z.boolean(),
  enemy: enemySchema.nullable(),
} satisfies z.ZodRawShape;

function validateGameStateInvariants(
  value: {
    hp: number;
    maxHp: number;
    weapon: (typeof weaponNames)[number];
    weaponAttack: number;
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
  gold: 50,
  weapon: "ふつうのマスク",
  weaponAttack: weaponAttackByName["ふつうのマスク"],
  location: "venue",
  lairDepth: 0,
  tabletFound: false,
  hostGreeted: false,
  bossDefeated: false,
  princessCarried: false,
  hostAsking: false,
  cleared: false,
  cheatCleared: false,
  inBattle: false,
  enemy: null,
});

export function createInitialState(): GameState {
  return { ...initialState };
}

export function appendGameText(gameLog: string[], text: string): void {
  for (const line of text.split("\n")) {
    gameLog.push(line.slice(0, 500));
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
    location: saveFile.location,
    lairDepth: saveFile.lairDepth,
    tabletFound: saveFile.tabletFound,
    hostGreeted: saveFile.hostGreeted,
    bossDefeated: saveFile.bossDefeated,
    princessCarried: saveFile.princessCarried,
    hostAsking: saveFile.hostAsking,
    cleared: saveFile.cleared,
    cheatCleared: saveFile.cheatCleared,
    inBattle: saveFile.inBattle,
    enemy: saveFile.enemy,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readStoredGameData(
  value: unknown,
):
  | { ok: true; format: "legacy" | "v1"; state: GameState; gameLog: string[]; savedAt?: string }
  | { ok: false; reason: "invalid" | "future-version" } {
  if (isRecord(value) && "version" in value) {
    if (value.version !== 1) {
      return { ok: false, reason: "future-version" };
    }
    const parsed = saveFileV1Schema.safeParse(value);
    if (!parsed.success) {
      return { ok: false, reason: "invalid" };
    }
    const restored = gameStateSchema.safeParse(
      restoreBattleState(extractGameStateFromSaveFile(parsed.data)),
    );
    if (!restored.success) {
      return { ok: false, reason: "invalid" };
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
  const restored = gameStateSchema.safeParse(restoreBattleState(parsed.data));
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

export function encodeJumon(
  state: GameState,
  gameLog: string[],
  savedAt = new Date().toISOString(),
): string {
  return Buffer.from(JSON.stringify(createSaveFileV1(state, gameLog, savedAt)), "utf8").toString(
    "base64",
  );
}

export function decodeJumon(input: string): {
  state: GameState;
  gameLog: string[];
  savedAt?: string;
} {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > maxJumonLength || !isStrictBase64(trimmed)) {
    throw new Error("invalid jumon");
  }
  let parsed: unknown;
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    parsed = JSON.parse(decoded) as unknown;
  } catch {
    throw new Error("invalid jumon");
  }
  const restored = readStoredGameData(parsed);
  if (!restored.ok) {
    throw new Error(restored.reason);
  }
  return {
    state: restored.state,
    gameLog: restored.gameLog,
    savedAt: restored.savedAt,
  };
}
