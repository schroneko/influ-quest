import { Buffer } from "node:buffer";
import { z } from "zod";

export const locationIds = ["venue", "office", "lair"] as const;
export const weaponNames = [
  "たいおんけい",
  "アルコールスプレー",
  "じょきんのやり",
  "でんせつのワクチンソード",
] as const;
export const armorNames = [
  "ふだんぎ",
  "ファントムマスク",
  "N95マスク",
  "かんせんたいさくスーツ",
] as const;
export const armorDefenseByName = {
  ふだんぎ: 0,
  ファントムマスク: 2,
  N95マスク: 4,
  かんせんたいさくスーツ: 7,
} as const;
export const infectionChanceByArmor = {
  ふだんぎ: 0.35,
  ファントムマスク: 0.25,
  N95マスク: 0.12,
  かんせんたいさくスーツ: 0.05,
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
] as const;
export const weaponAttackByName = {
  たいおんけい: 5,
  アルコールスプレー: 14,
  じょきんのやり: 22,
  でんせつのワクチンソード: 30,
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
  inBattle: false,
  enemy: null,
});

export function createInitialState(): GameState {
  return { ...initialState };
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
  | { ok: false; reason: "invalid" | "future-version" } {
  if (isRecord(value) && "version" in value) {
    if (value.version !== 1) {
      return { ok: false, reason: "future-version" };
    }
    const parsed = saveFileV1Schema.safeParse(value);
    if (!parsed.success) {
      return { ok: false, reason: "invalid" };
    }
    const restored = normalizeStoredState(extractGameStateFromSaveFile(parsed.data), options);
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

export const JUMON_CHARS =
  "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわんがぎぐげござじずぜぞだぢづでどばびぶべ";
const jumonIndex = new Map([...JUMON_CHARS].map((char, index) => [char, index]));
const LEGACY_JUMON_VERSION = 2;
const JUMON_VERSION = 3;
const maxJumonGold = 131071;
const maxJumonSeconds = 131071;
const maxJumonElapsedSeconds = 1048575;
const maxLegacyJumonNameLength = 7;
const compactJumonNameMode = 0;
const unicodeJumonNameMode = 1;

class BitWriter {
  bits: number[] = [];

  write(value: number, width: number): void {
    for (let i = width - 1; i >= 0; i -= 1) {
      this.bits.push((value >> i) & 1);
    }
  }
}

class BitReader {
  private readonly bits: number[];
  private position = 0;

  constructor(bits: number[]) {
    this.bits = bits;
  }

  read(width: number): number {
    if (this.position + width > this.bits.length) {
      throw new Error("invalid jumon");
    }
    let value = 0;
    for (let i = 0; i < width; i += 1) {
      value = (value << 1) | this.bits[this.position];
      this.position += 1;
    }
    return value;
  }
}

function bitsToGroups(bits: number[]): number[] {
  const groups: number[] = [];
  for (let i = 0; i < bits.length; i += 6) {
    let value = 0;
    for (let j = 0; j < 6; j += 1) {
      value = (value << 1) | (bits[i + j] ?? 0);
    }
    groups.push(value);
  }
  return groups;
}

function groupsToBits(groups: number[]): number[] {
  const bits: number[] = [];
  for (const group of groups) {
    for (let i = 5; i >= 0; i -= 1) {
      bits.push((group >> i) & 1);
    }
  }
  return bits;
}

function jumonChecksum(groups: number[]): number {
  let value = 7;
  for (const group of groups) {
    value = (value * 33 + group + 13) & 0xff;
  }
  return value;
}

function encodeLegacyJumonName(name: string): number[] {
  const chars = [...name];
  if (chars.length === 0 || chars.length > maxLegacyJumonNameLength) {
    return [];
  }
  const encoded: number[] = [];
  for (const char of chars) {
    const index = jumonIndex.get(char);
    if (index === undefined) {
      return [];
    }
    encoded.push(index);
  }
  return encoded;
}

function encodeUnicodeJumonName(name: string): number[] {
  return Array.from(name, (char) => char.codePointAt(0) ?? 0);
}

function trimJumonInput(input: string): string {
  return input.normalize("NFKC").replace(/[\s、。・「」]/g, "");
}

function splitJumonGroups(trimmed: string): { groups: number[]; payloadGroups: number[] } {
  if (trimmed.length < 12 || trimmed.length > 256) {
    throw new Error("invalid jumon");
  }
  const groups: number[] = [];
  for (const char of trimmed) {
    const index = jumonIndex.get(char);
    if (index === undefined) {
      throw new Error("invalid jumon");
    }
    groups.push(index);
  }
  if (groups.length < 3) {
    throw new Error("invalid jumon");
  }
  const checksumLow = groups[groups.length - 1];
  if ((checksumLow & 0x0f) !== 0) {
    throw new Error("invalid jumon");
  }
  const payloadGroups = groups.slice(0, -2);
  const checksumHigh = groups[groups.length - 2];
  const checksum = ((checksumHigh << 2) | (checksumLow >> 4)) & 0xff;
  if (jumonChecksum(payloadGroups) !== checksum) {
    throw new Error("invalid jumon");
  }
  return { groups, payloadGroups };
}

function assertExpectedJumonSize(payloadGroups: number[], expectedBits: number): void {
  const expectedGroups = Math.ceil(expectedBits / 6);
  if (payloadGroups.length !== expectedGroups) {
    throw new Error("invalid jumon");
  }
  const payloadBits = groupsToBits(payloadGroups);
  for (let index = expectedBits; index < payloadBits.length; index += 1) {
    if (payloadBits[index] !== 0) {
      throw new Error("invalid jumon");
    }
  }
}

function buildDecodedJumonState(fields: {
  level: number;
  exp: number;
  gold: number;
  weapon: (typeof weaponNames)[number];
  armor: (typeof armorNames)[number];
  medicineCount: number;
  location: (typeof locationIds)[number];
  lairDepth: number;
  tabletFound: boolean;
  hostGreeted: boolean;
  miniBossDefeated: boolean;
  bossDefeated: boolean;
  princessCarried: boolean;
  hostAsking: boolean;
  cleared: boolean;
  cheatCleared: boolean;
  fanMode: boolean;
  infected: boolean;
  hasTimer: boolean;
  elapsedSeconds: number;
  clearSeconds: number;
  heroName: string;
}): GameState {
  return {
    heroName: fields.heroName || "ななしのゆうしゃ",
    level: fields.level,
    exp: fields.exp,
    hp: maxHpForLevel(fields.level),
    maxHp: maxHpForLevel(fields.level),
    gold: fields.gold,
    weapon: fields.weapon,
    weaponAttack: weaponAttackByName[fields.weapon],
    armor: fields.armor,
    armorDefense: armorDefenseByName[fields.armor],
    infected: fields.infected,
    medicineCount: fields.medicineCount,
    immunityCount: 0,
    hostTalkCount: 0,
    location: fields.location,
    lairDepth: fields.lairDepth,
    tabletFound: fields.tabletFound,
    hostGreeted: fields.hostGreeted,
    miniBossDefeated: fields.miniBossDefeated,
    startedAtMs: fields.hasTimer ? Math.max(Date.now() - fields.elapsedSeconds * 1000, 1) : 0,
    clearMs: fields.clearSeconds * 1000,
    bossDefeated: fields.bossDefeated,
    princessCarried: fields.princessCarried,
    hostAsking: fields.hostAsking,
    cleared: fields.cleared,
    cheatCleared: fields.cheatCleared,
    fanMode: fields.fanMode,
    inBattle: false,
    enemy: null,
  };
}

function decodeLegacyJumon(payloadGroups: number[], reader: BitReader): GameState {
  const level = reader.read(3);
  const exp = reader.read(17);
  const gold = reader.read(17);
  const weapon = weaponNames[reader.read(2)];
  const armor = armorNames[reader.read(2)];
  const medicineCount = reader.read(2);
  const location = locationIds[reader.read(2)];
  const lairDepth = reader.read(3);
  const tabletFound = reader.read(1) === 1;
  const hostGreeted = reader.read(1) === 1;
  const miniBossDefeated = reader.read(1) === 1;
  const bossDefeated = reader.read(1) === 1;
  const princessCarried = reader.read(1) === 1;
  const cleared = reader.read(1) === 1;
  const cheatCleared = reader.read(1) === 1;
  const fanMode = reader.read(1) === 1;
  const infected = reader.read(1) === 1;
  const hasTimer = reader.read(1) === 1;
  const elapsedSeconds = reader.read(20);
  const clearSeconds = reader.read(17);
  const nameLength = reader.read(3);
  const expectedBits = 102 + nameLength * 6;
  assertExpectedJumonSize(payloadGroups, expectedBits);
  let heroName = "";
  for (let i = 0; i < nameLength; i += 1) {
    const char = JUMON_CHARS[reader.read(6)];
    if (!char) {
      throw new Error("invalid jumon");
    }
    heroName += char;
  }
  if (!weapon || !armor || !location) {
    throw new Error("invalid jumon");
  }
  return buildDecodedJumonState({
    level,
    exp,
    gold,
    weapon,
    armor,
    medicineCount,
    location,
    lairDepth,
    tabletFound,
    hostGreeted,
    miniBossDefeated,
    bossDefeated,
    princessCarried,
    hostAsking: false,
    cleared,
    cheatCleared,
    fanMode,
    infected,
    hasTimer,
    elapsedSeconds,
    clearSeconds,
    heroName,
  });
}

function decodeJumonV3(payloadGroups: number[], reader: BitReader): GameState {
  const level = reader.read(3);
  const exp = reader.read(17);
  const gold = reader.read(17);
  const weapon = weaponNames[reader.read(2)];
  const armor = armorNames[reader.read(2)];
  const medicineCount = reader.read(2);
  const location = locationIds[reader.read(2)];
  const lairDepth = reader.read(3);
  const tabletFound = reader.read(1) === 1;
  const hostGreeted = reader.read(1) === 1;
  const miniBossDefeated = reader.read(1) === 1;
  const bossDefeated = reader.read(1) === 1;
  const princessCarried = reader.read(1) === 1;
  const hostAsking = reader.read(1) === 1;
  const cleared = reader.read(1) === 1;
  const cheatCleared = reader.read(1) === 1;
  const fanMode = reader.read(1) === 1;
  const infected = reader.read(1) === 1;
  const hasTimer = reader.read(1) === 1;
  const elapsedSeconds = reader.read(20);
  const clearSeconds = reader.read(17);
  const nameMode = reader.read(1);
  const nameLength = reader.read(5);
  const widthsByMode = {
    [compactJumonNameMode]: 6,
    [unicodeJumonNameMode]: 21,
  } as const;
  const itemWidth = widthsByMode[nameMode as keyof typeof widthsByMode];
  if (itemWidth === undefined) {
    throw new Error("invalid jumon");
  }
  const expectedBits = 106 + nameLength * itemWidth;
  assertExpectedJumonSize(payloadGroups, expectedBits);
  let heroName = "";
  if (nameMode === compactJumonNameMode) {
    for (let i = 0; i < nameLength; i += 1) {
      const char = JUMON_CHARS[reader.read(6)];
      if (!char) {
        throw new Error("invalid jumon");
      }
      heroName += char;
    }
  } else {
    const chars: string[] = [];
    for (let i = 0; i < nameLength; i += 1) {
      const codePoint = reader.read(21);
      if (codePoint < 0 || codePoint > 0x10ffff) {
        throw new Error("invalid jumon");
      }
      const char = String.fromCodePoint(codePoint);
      if (char.length === 0) {
        throw new Error("invalid jumon");
      }
      chars.push(char);
    }
    heroName = chars.join("");
  }
  if (!weapon || !armor || !location) {
    throw new Error("invalid jumon");
  }
  return buildDecodedJumonState({
    level,
    exp,
    gold,
    weapon,
    armor,
    medicineCount,
    location,
    lairDepth,
    tabletFound,
    hostGreeted,
    miniBossDefeated,
    bossDefeated,
    princessCarried,
    hostAsking,
    cleared,
    cheatCleared,
    fanMode,
    infected,
    hasTimer,
    elapsedSeconds,
    clearSeconds,
    heroName,
  });
}

export function encodeJumon(state: GameState, _gameLog: string[] = [], _savedAt?: string): string {
  const writer = new BitWriter();
  writer.write(JUMON_VERSION, 4);
  writer.write(Math.min(state.level, 5), 3);
  writer.write(Math.min(state.exp, maxJumonSeconds), 17);
  writer.write(Math.min(state.gold, maxJumonGold), 17);
  writer.write(weaponNames.indexOf(state.weapon), 2);
  writer.write(armorNames.indexOf(state.armor), 2);
  writer.write(state.medicineCount, 2);
  writer.write(locationIds.indexOf(state.location), 2);
  writer.write(state.lairDepth, 3);
  writer.write(state.tabletFound ? 1 : 0, 1);
  writer.write(state.hostGreeted ? 1 : 0, 1);
  writer.write(state.miniBossDefeated ? 1 : 0, 1);
  writer.write(state.bossDefeated ? 1 : 0, 1);
  writer.write(state.princessCarried ? 1 : 0, 1);
  writer.write(state.hostAsking ? 1 : 0, 1);
  writer.write(state.cleared ? 1 : 0, 1);
  writer.write(state.cheatCleared ? 1 : 0, 1);
  writer.write(state.fanMode ? 1 : 0, 1);
  writer.write(state.infected ? 1 : 0, 1);
  const elapsedSeconds =
    state.startedAtMs > 0
      ? Math.min(
          Math.max(Math.floor((Date.now() - state.startedAtMs) / 1000), 0),
          maxJumonElapsedSeconds,
        )
      : 0;
  writer.write(state.startedAtMs > 0 ? 1 : 0, 1);
  writer.write(elapsedSeconds, 20);
  writer.write(Math.min(Math.floor(state.clearMs / 1000), maxJumonSeconds), 17);
  const storedHeroName = state.heroName === "ななしのゆうしゃ" ? "" : state.heroName;
  const compactName = encodeLegacyJumonName(storedHeroName);
  if (compactName.length === Array.from(storedHeroName).length) {
    writer.write(compactJumonNameMode, 1);
    writer.write(compactName.length, 5);
    for (const group of compactName) {
      writer.write(group, 6);
    }
  } else {
    const codePoints = encodeUnicodeJumonName(storedHeroName);
    writer.write(unicodeJumonNameMode, 1);
    writer.write(codePoints.length, 5);
    for (const codePoint of codePoints) {
      writer.write(codePoint, 21);
    }
  }
  const payloadGroups = bitsToGroups(writer.bits);
  const checksum = jumonChecksum(payloadGroups);
  const groups = [...payloadGroups, (checksum >> 2) & 63, ((checksum & 3) << 4) & 63];
  return groups.map((group) => JUMON_CHARS[group]).join("");
}

export function decodeJumon(input: string): {
  state: GameState;
  gameLog: string[];
  savedAt?: string;
} {
  const { payloadGroups } = splitJumonGroups(trimJumonInput(input));
  const reader = new BitReader(groupsToBits(payloadGroups));
  const version = reader.read(4);
  let candidate: GameState;
  if (version === LEGACY_JUMON_VERSION) {
    candidate = decodeLegacyJumon(payloadGroups, reader);
  } else if (version === JUMON_VERSION) {
    candidate = decodeJumonV3(payloadGroups, reader);
  } else {
    throw new Error("future-version");
  }
  const parsed = gameStateSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error("invalid jumon");
  }
  return {
    state: parsed.data,
    gameLog: [],
  };
}
