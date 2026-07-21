import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import {
  createInitialState,
  createSaveFileV1,
  type GameState,
  readStoredGameData,
} from "./state.js";

export const saveDir = join(homedir(), ".influenza-quest");
export const savePath = join(saveDir, "karte.json");
export const playerIdPath = join(saveDir, "player-id");
export const screenPath = join(saveDir, "local-ui-preview.html");

function chmodIfPossible(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {}
}

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodIfPossible(path, 0o700);
}

function atomicWritePrivateFile(path: string, payload: string, mode = 0o600): void {
  const directory = dirname(path);
  ensurePrivateDirectory(directory);
  const tempPath = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  let tempCreated = false;
  try {
    writeFileSync(tempPath, payload, { mode, flag: "wx" });
    tempCreated = true;
    chmodIfPossible(tempPath, mode);
    renameSync(tempPath, path);
    chmodIfPossible(path, mode);
  } catch (error) {
    if (tempCreated || existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {}
    }
    throw error;
  }
}

export function loadPlayerId(path = playerIdPath): string {
  try {
    const value = readFileSync(path, "utf8").trim();
    if (value) {
      chmodIfPossible(path, 0o600);
      return value;
    }
  } catch {}
  const id = randomUUID();
  try {
    ensurePrivateDirectory(dirname(path));
    writeFileSync(path, id, { mode: 0o600 });
    chmodIfPossible(path, 0o600);
  } catch {}
  return id;
}

export function loadGame(path = savePath): { state: GameState; gameLog: string[] } {
  if (!existsSync(path)) {
    return { state: createInitialState(), gameLog: [] };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const parsed = readStoredGameData(raw);
    if (parsed.ok) {
      return { state: parsed.state, gameLog: parsed.gameLog };
    }
    if (parsed.reason === "future-version") {
      console.error("Warning: unsupported save version ignored.");
    } else {
      console.error("Warning: save data ignored.");
    }
  } catch {
    console.error("Warning: save data ignored.");
  }
  return { state: createInitialState(), gameLog: [] };
}

export function saveGame(path = savePath, state: GameState, gameLog: string[]): void {
  const payload = JSON.stringify(createSaveFileV1(state, gameLog), null, 2);
  atomicWritePrivateFile(path, payload);
}

export function writeScreenHtml(html: string, path = screenPath): string {
  atomicWritePrivateFile(path, html);
  return path;
}

export function resetSave(path = savePath): string | null {
  if (!existsSync(path)) {
    return null;
  }
  ensurePrivateDirectory(dirname(path));
  const extension = extname(path) || ".json";
  const backupPath = join(
    dirname(path),
    `${basename(path, extname(path))}.backup-${Date.now()}-${randomUUID()}${extension}`,
  );
  renameSync(path, backupPath);
  chmodIfPossible(backupPath, 0o600);
  return backupPath;
}
