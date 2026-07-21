const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

const PAGE_HEADERS = {
  "cache-control": "no-store",
  "content-type": "text/html; charset=utf-8",
};

const BODY_LIMIT_BYTES = 2048;
const CACHE_TTL_MS = 3000;
export const KV_TTL_SECONDS = 21600;
const DEFAULT_EVENT_ID = "default";
const LOCATION_NAMES = new Set(["イベントかいじょう", "オフィスがい", "ウイルスのすみか"]);
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_OR_BIDI_PATTERN = new RegExp(
  "[\\u0000-\\u001f\\u007f-\\u009f\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]",
  "gu",
);
const NAME_COMPARATOR = new Intl.Collator("ja");
const RECORD_FIELD_NAMES = new Set([
  "name",
  "level",
  "hp",
  "maxHp",
  "gold",
  "location",
  "cleared",
  "cheatCleared",
  "princessCarried",
  "dragonDefeated",
  "updatedAt",
]);
const INCOMING_FIELD_NAMES = new Set(
  ["id", ...RECORD_FIELD_NAMES].filter((field) => field !== "updatedAt"),
);

class ServiceUnavailableError extends Error {
  constructor(message = "Service temporarily unavailable") {
    super(message);
    this.name = "ServiceUnavailableError";
  }
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });

const apiError = (status, error, message) => json({ ok: false, error, message }, status);

const serviceUnavailable = (message = "Service temporarily unavailable") =>
  apiError(503, "service_unavailable", message);

const notFound = () => apiError(404, "not_found", "Not found");

const methodNotAllowed = () => apiError(405, "method_not_allowed", "Method not allowed");

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIntegerInRange = (value, min, max) =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

const hasExactFields = (value, fields) => {
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
};

const maxHpForLevel = (level) => 30 + (level - 1) * 8;

const hasValidProgression = (candidate) => {
  if (candidate.maxHp !== maxHpForLevel(candidate.level)) return false;
  if (candidate.princessCarried && (!candidate.dragonDefeated || candidate.cleared)) return false;
  if (candidate.cheatCleared && (!candidate.cleared || !candidate.dragonDefeated)) return false;
  if (candidate.cleared && candidate.princessCarried) return false;
  return true;
};

const sanitizeName = (value) => {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").replace(CONTROL_OR_BIDI_PATTERN, "");
  const codePoints = [...normalized];
  if (codePoints.length < 1 || codePoints.length > 24) return null;
  return codePoints.join("");
};

const ensureCrypto = (cryptoApi) => {
  if (!cryptoApi?.subtle?.digest) {
    throw new ServiceUnavailableError();
  }
  return cryptoApi;
};

const digestText = async (cryptoApi, text) => {
  const bytes = new TextEncoder().encode(text);
  const digest = await ensureCrypto(cryptoApi).subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
};

const timingSafeEqual = (left, right) => {
  const maxLength = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return mismatch === 0;
};

const getEventId = (env) => {
  const raw = typeof env.EVENT_ID === "string" ? env.EVENT_ID.trim() : "";
  return /^[A-Za-z0-9._-]{1,64}$/.test(raw) ? raw : DEFAULT_EVENT_ID;
};

const getPlayersKv = (env) => {
  if (!env?.PLAYERS?.put || !env?.PLAYERS?.list) {
    throw new ServiceUnavailableError();
  }
  return env.PLAYERS;
};

const getWriteWindow = (env, now) => {
  if (env.EVENT_WRITE_UNTIL == null || env.EVENT_WRITE_UNTIL === "") {
    return {
      configured: false,
      valid: true,
      expiresAt: null,
      writesOpen: true,
    };
  }
  if (typeof env.EVENT_WRITE_UNTIL !== "string") {
    return {
      configured: true,
      valid: false,
      expiresAt: null,
      writesOpen: false,
    };
  }
  const expiresAt = Date.parse(env.EVENT_WRITE_UNTIL);
  if (!Number.isFinite(expiresAt)) {
    return {
      configured: true,
      valid: false,
      expiresAt: null,
      writesOpen: false,
    };
  }
  return {
    configured: true,
    valid: true,
    expiresAt,
    writesOpen: now <= expiresAt,
  };
};

const makeEventPrefix = (eventId) => `event:${eventId}:`;

const makePlayerKey = (eventId, id) => `${makeEventPrefix(eventId)}${id}`;

const validateRecordShape = (candidate, { exactName = false } = {}) => {
  if (!isPlainObject(candidate)) return null;
  if (!hasExactFields(candidate, RECORD_FIELD_NAMES)) return null;
  const name = sanitizeName(candidate.name);
  if (name === null) return null;
  if (exactName && name !== candidate.name) return null;
  if (!isIntegerInRange(candidate.level, 1, 5)) return null;
  if (!isIntegerInRange(candidate.hp, 0, 999)) return null;
  if (!isIntegerInRange(candidate.maxHp, 1, 999)) return null;
  if (!isIntegerInRange(candidate.gold, 0, 999999)) return null;
  if (candidate.hp > candidate.maxHp) return null;
  if (typeof candidate.location !== "string" || !LOCATION_NAMES.has(candidate.location))
    return null;
  if (typeof candidate.cleared !== "boolean") return null;
  if (typeof candidate.cheatCleared !== "boolean") return null;
  if (typeof candidate.princessCarried !== "boolean") return null;
  if (typeof candidate.dragonDefeated !== "boolean") return null;
  if (!isIntegerInRange(candidate.updatedAt, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (!hasValidProgression(candidate)) return null;
  return {
    name,
    level: candidate.level,
    hp: candidate.hp,
    maxHp: candidate.maxHp,
    gold: candidate.gold,
    location: candidate.location,
    cleared: candidate.cleared,
    cheatCleared: candidate.cheatCleared,
    princessCarried: candidate.princessCarried,
    dragonDefeated: candidate.dragonDefeated,
    updatedAt: candidate.updatedAt,
  };
};

const validateIncomingBody = (candidate, now) => {
  if (!isPlainObject(candidate)) {
    return { error: apiError(400, "invalid_json", "JSON body must be an object") };
  }
  if (!hasExactFields(candidate, INCOMING_FIELD_NAMES)) {
    return { error: apiError(400, "invalid_shape", "JSON body has missing or unknown fields") };
  }
  if (typeof candidate.id !== "string" || !UUID_V4_PATTERN.test(candidate.id)) {
    return { error: apiError(400, "invalid_id", "Player id must be a UUID v4") };
  }
  const cleaned = { ...candidate };
  delete cleaned.id;
  cleaned.updatedAt = now;
  const validated = validateRecordShape(cleaned);
  if (!validated) {
    return { error: apiError(400, "invalid_record", "Game record is invalid") };
  }
  return {
    value: {
      id: candidate.id,
      record: validated,
    },
  };
};

export async function writePlayerSnapshot(env, playerId, snapshot, now = Date.now()) {
  if (typeof playerId !== "string" || !UUID_V4_PATTERN.test(playerId)) {
    return false;
  }
  const record = validateRecordShape({ ...snapshot, updatedAt: now });
  if (!record) {
    return false;
  }
  const eventId = getEventId(env);
  try {
    const kv = getPlayersKv(env);
    await kv.put(makePlayerKey(eventId, playerId), JSON.stringify(record), {
      expirationTtl: KV_TTL_SECONDS,
      metadata: record,
    });
    return true;
  } catch {
    return false;
  }
}

const comparePlayers = (left, right) =>
  Number(right.record.cheatCleared) - Number(left.record.cheatCleared) ||
  Number(right.record.cleared) - Number(left.record.cleared) ||
  Number(right.record.princessCarried) - Number(left.record.princessCarried) ||
  Number(right.record.dragonDefeated) - Number(left.record.dragonDefeated) ||
  right.record.level - left.record.level ||
  right.record.gold - left.record.gold ||
  right.record.updatedAt - left.record.updatedAt ||
  NAME_COMPARATOR.compare(left.record.name, right.record.name) ||
  NAME_COMPARATOR.compare(left.record.location, right.record.location) ||
  right.record.hp - left.record.hp ||
  right.record.maxHp - left.record.maxHp ||
  left.key.localeCompare(right.key);

export function createBoard(options = {}) {
  const now = options.now ?? (() => Date.now());
  const cryptoApi = options.crypto ?? globalThis.crypto;
  const page = options.page ?? PAGE;
  const cachedSnapshots = new Map();
  const snapshotPromises = new Map();

  const authenticate = async (request, env) => {
    if (typeof env.EVENT_TOKEN !== "string" || env.EVENT_TOKEN.length === 0) {
      return serviceUnavailable();
    }
    const header = request.headers.get("authorization") ?? "";
    const match = /^Bearer[ \t]+(.+)$/.exec(header);
    if (!match) {
      return apiError(401, "unauthorized", "Authorization token is missing or invalid");
    }
    try {
      const [providedDigest, secretDigest] = await Promise.all([
        digestText(cryptoApi, match[1]),
        digestText(cryptoApi, env.EVENT_TOKEN),
      ]);
      if (!timingSafeEqual(providedDigest, secretDigest)) {
        return apiError(401, "unauthorized", "Authorization token is missing or invalid");
      }
      return null;
    } catch {
      return serviceUnavailable();
    }
  };

  const enforceRateLimits = async (env, eventId, playerId) => {
    const bindings = [];
    if ("PLAYER_RATE_LIMIT" in env && env.PLAYER_RATE_LIMIT != null) {
      if (typeof env.PLAYER_RATE_LIMIT.limit !== "function") throw new ServiceUnavailableError();
      bindings.push({ binding: env.PLAYER_RATE_LIMIT, key: makePlayerKey(eventId, playerId) });
    }
    if ("EVENT_RATE_LIMIT" in env && env.EVENT_RATE_LIMIT != null) {
      if (typeof env.EVENT_RATE_LIMIT.limit !== "function") throw new ServiceUnavailableError();
      bindings.push({ binding: env.EVENT_RATE_LIMIT, key: eventId });
    }
    for (const entry of bindings) {
      let result;
      try {
        result = await entry.binding.limit({ key: entry.key });
      } catch {
        throw new ServiceUnavailableError();
      }
      if (!result?.success) {
        return false;
      }
    }
    return true;
  };

  const loadPlayersSnapshot = async (env) => {
    const currentTime = now();
    const eventId = getEventId(env);
    const cachedSnapshot = cachedSnapshots.get(eventId);
    if (cachedSnapshot && currentTime < cachedSnapshot.expiresAt) {
      return cachedSnapshot.value;
    }
    const activeSnapshotPromise = snapshotPromises.get(eventId);
    if (activeSnapshotPromise) {
      return activeSnapshotPromise;
    }
    const snapshotPromise = (async () => {
      const kv = getPlayersKv(env);
      const prefix = makeEventPrefix(eventId);
      const rows = [];
      let cursor;
      do {
        let pageResult;
        try {
          pageResult = await kv.list({ prefix, limit: 1000, cursor });
        } catch {
          throw new ServiceUnavailableError();
        }
        for (const key of pageResult?.keys ?? []) {
          const record = validateRecordShape(key.metadata, { exactName: true });
          if (record) {
            rows.push({ key: key.name, record });
          }
        }
        cursor = pageResult?.list_complete ? undefined : pageResult?.cursor;
      } while (cursor);
      rows.sort(comparePlayers);
      const value = {
        ok: true,
        generatedAt: now(),
        players: rows.map((entry) => entry.record),
      };
      cachedSnapshots.set(eventId, {
        expiresAt: currentTime + CACHE_TTL_MS,
        value,
      });
      return value;
    })();
    snapshotPromises.set(eventId, snapshotPromise);
    try {
      return await snapshotPromise;
    } finally {
      if (snapshotPromises.get(eventId) === snapshotPromise) {
        snapshotPromises.delete(eventId);
      }
    }
  };

  const handleStatePost = async (request, env) => {
    const authFailure = await authenticate(request, env);
    if (authFailure) return authFailure;

    const writeWindow = getWriteWindow(env, now());
    if (!writeWindow.valid) {
      return serviceUnavailable();
    }
    if (!writeWindow.writesOpen) {
      return apiError(410, "event_closed", "Event writes are closed");
    }

    const contentType = request.headers.get("content-type") ?? "";
    const mediaType = contentType.split(";")[0].trim().toLowerCase();
    if (mediaType !== "application/json") {
      return apiError(415, "unsupported_media_type", "Content-Type must be application/json");
    }

    let bodyText;
    try {
      bodyText = await request.text();
    } catch {
      throw new ServiceUnavailableError();
    }
    if (new TextEncoder().encode(bodyText).byteLength > BODY_LIMIT_BYTES) {
      return apiError(413, "payload_too_large", "Request body is too large");
    }

    let parsedBody;
    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      return apiError(400, "invalid_json", "Request body must be valid JSON");
    }

    const validated = validateIncomingBody(parsedBody, now());
    if (validated.error) return validated.error;

    const eventId = getEventId(env);
    const allowed = await enforceRateLimits(env, eventId, validated.value.id);
    if (!allowed) {
      return apiError(429, "rate_limited", "Too many requests");
    }

    const kv = getPlayersKv(env);
    try {
      await kv.put(
        makePlayerKey(eventId, validated.value.id),
        JSON.stringify(validated.value.record),
        {
          expirationTtl: KV_TTL_SECONDS,
          metadata: validated.value.record,
        },
      );
    } catch {
      throw new ServiceUnavailableError();
    }
    return json({ ok: true });
  };

  const handlePlayersGet = async (env) => json(await loadPlayersSnapshot(env));

  const handleHealthGet = (env) => {
    const eventId = getEventId(env);
    const writeWindow = getWriteWindow(env, now());
    return json({
      ok: true,
      eventId,
      writesOpen: writeWindow.valid ? writeWindow.writesOpen : false,
      writeWindowConfigured: writeWindow.configured,
      writeWindowValid: writeWindow.valid,
      writeUntil:
        writeWindow.expiresAt == null ? null : new Date(writeWindow.expiresAt).toISOString(),
      playerRateLimitConfigured: "PLAYER_RATE_LIMIT" in env && env.PLAYER_RATE_LIMIT != null,
      eventRateLimitConfigured: "EVENT_RATE_LIMIT" in env && env.EVENT_RATE_LIMIT != null,
    });
  };

  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      try {
        if (url.pathname === "/api/state") {
          if (request.method !== "POST") return methodNotAllowed();
          return await handleStatePost(request, env);
        }
        if (url.pathname === "/api/players") {
          if (request.method !== "GET") return methodNotAllowed();
          return await handlePlayersGet(env);
        }
        if (url.pathname === "/api/health") {
          if (request.method !== "GET") return methodNotAllowed();
          return handleHealthGet(env);
        }
        if (url.pathname === "/") {
          if (request.method !== "GET") return methodNotAllowed();
          return new Response(page, { headers: PAGE_HEADERS });
        }
        return notFound();
      } catch (error) {
        if (url.pathname.startsWith("/api/")) {
          if (error instanceof ServiceUnavailableError) {
            return serviceUnavailable(error.message);
          }
          return serviceUnavailable();
        }
        return new Response("Service temporarily unavailable", {
          status: 503,
          headers: PAGE_HEADERS,
        });
      }
    },
  };
}

const PAGE = String.raw`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>インフルクエスト 会場ボード</title>
<style>
  :root {
    color-scheme: dark;
    --bg0: #06070b;
    --bg1: #0f1623;
    --panel: rgba(7, 10, 16, 0.88);
    --line: rgba(255, 255, 255, 0.16);
    --line-strong: rgba(255, 212, 74, 0.44);
    --text: #f6f6f2;
    --muted: #a9b3c2;
    --gold: #ffd44a;
    --mint: #7ee2ad;
    --rose: #ff9e87;
    --violet: #c6a6ff;
    --sky: #85d6ff;
    --card: rgba(16, 24, 37, 0.92);
    --shadow: 0 20px 48px rgba(0, 0, 0, 0.35);
  }
  * {
    box-sizing: border-box;
  }
  html {
    background:
      radial-gradient(circle at top, rgba(133, 214, 255, 0.14), transparent 34%),
      linear-gradient(180deg, #08101b 0%, #05060a 100%);
  }
  body {
    margin: 0;
    min-height: 100vh;
    background: transparent;
    color: var(--text);
    font-family: "DotGothic16", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", sans-serif;
    line-height: 1.7;
    padding: 24px 16px 48px;
  }
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background:
      linear-gradient(transparent 0 2px, rgba(255, 255, 255, 0.028) 2px 4px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.01), transparent 35%);
    background-size: 100% 4px, 100% 100%;
    opacity: 0.9;
  }
  .shell {
    max-width: 1120px;
    margin: 0 auto;
    position: relative;
  }
  .masthead {
    display: grid;
    gap: 12px;
    margin-bottom: 18px;
  }
  .eyebrow {
    margin: 0;
    color: var(--gold);
    letter-spacing: 0.18em;
    font-size: 12px;
    text-transform: uppercase;
  }
  h1 {
    margin: 0;
    font-size: clamp(28px, 5.2vw, 44px);
    letter-spacing: 0.12em;
    color: var(--gold);
    text-shadow: 4px 4px 0 rgba(6, 48, 74, 0.95);
  }
  .intro {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
  }
  .join {
    background: var(--panel);
    border: 2px solid var(--line);
    border-radius: 16px;
    padding: 14px 18px;
    margin-bottom: 18px;
  }
  .join h2 {
    margin: 0 0 8px;
    font-size: 16px;
    color: var(--sky);
    letter-spacing: 0.1em;
  }
  .join ol {
    margin: 0 0 8px;
    padding-left: 22px;
    font-size: 14px;
  }
  .join li {
    margin-bottom: 4px;
  }
  .join p {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
  }
  .join code {
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 1px 6px;
    font-size: 13px;
    word-break: break-all;
  }
  .join a {
    color: var(--sky);
  }
  .board {
    background: linear-gradient(180deg, rgba(9, 12, 18, 0.98), rgba(5, 8, 12, 0.94));
    border: 4px double rgba(255, 255, 255, 0.72);
    border-radius: 20px;
    box-shadow: var(--shadow);
    overflow: hidden;
    position: relative;
  }
  .board::before {
    content: "";
    position: absolute;
    inset: 0;
    border: 1px solid rgba(255, 212, 74, 0.28);
    border-radius: 16px;
    pointer-events: none;
  }
  .statusbar {
    display: grid;
    gap: 10px;
    padding: 18px;
    border-bottom: 1px solid var(--line);
    background: linear-gradient(180deg, rgba(22, 30, 44, 0.94), rgba(11, 16, 24, 0.92));
  }
  .statusline {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 28px;
  }
  .lamp {
    width: 12px;
    height: 12px;
    border-radius: 999px;
    background: var(--sky);
    box-shadow: 0 0 0 3px rgba(133, 214, 255, 0.18);
    flex: none;
  }
  .statusbar p {
    margin: 0;
  }
  .status-text {
    font-size: 16px;
  }
  .status-detail {
    color: var(--muted);
    font-size: 13px;
    min-height: 1.7em;
  }
  .summary {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .summary-box {
    background: rgba(0, 0, 0, 0.24);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 12px 14px;
    min-height: 72px;
  }
  .summary-label {
    margin: 0 0 4px;
    color: var(--muted);
    font-size: 12px;
    letter-spacing: 0.08em;
  }
  .summary-value {
    margin: 0;
    font-size: 20px;
    color: var(--text);
    word-break: break-word;
  }
  .table-shell {
    padding: 12px 18px 18px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  caption {
    text-align: left;
    color: var(--muted);
    padding: 0 0 12px;
  }
  th,
  td {
    text-align: left;
    padding: 10px 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    vertical-align: top;
  }
  thead th {
    border-top: none;
    color: var(--muted);
    font-size: 12px;
    letter-spacing: 0.1em;
    font-weight: normal;
  }
  tbody tr:first-child td {
    border-top-color: rgba(255, 212, 74, 0.24);
  }
  tbody tr {
    background: transparent;
  }
  tbody tr:nth-child(odd) {
    background: rgba(255, 255, 255, 0.018);
  }
  .cell-name {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cell-status {
    color: var(--sky);
  }
  .cell-status.status-clear {
    color: var(--gold);
  }
  .cell-status.status-cheat {
    color: var(--violet);
  }
  .cell-status.status-princess {
    color: var(--mint);
  }
  .cell-status.status-boss {
    color: var(--rose);
  }
  .cell-updated {
    color: var(--muted);
    white-space: nowrap;
  }
  .state-empty td {
    color: var(--muted);
  }
  .board[data-view="loading"] .lamp {
    background: var(--sky);
    box-shadow: 0 0 0 3px rgba(133, 214, 255, 0.18);
  }
  .board[data-view="empty"] .lamp {
    background: var(--muted);
    box-shadow: 0 0 0 3px rgba(169, 179, 194, 0.18);
  }
  .board[data-view="fresh"] .lamp {
    background: var(--mint);
    box-shadow: 0 0 0 3px rgba(126, 226, 173, 0.18);
  }
  .board[data-view="stale"] .lamp {
    background: var(--gold);
    box-shadow: 0 0 0 3px rgba(255, 212, 74, 0.18);
  }
  .board[data-view="error"] .lamp {
    background: var(--rose);
    box-shadow: 0 0 0 3px rgba(255, 158, 135, 0.18);
  }
  @media (max-width: 760px) {
    body {
      padding: 16px 10px 32px;
    }
    .statusbar,
    .table-shell {
      padding-left: 12px;
      padding-right: 12px;
    }
    .summary {
      grid-template-columns: 1fr;
    }
    table,
    thead,
    tbody,
    tr,
    th,
    td {
      display: block;
    }
    thead {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      border: 0;
    }
    tbody {
      display: grid;
      gap: 12px;
    }
    tbody tr {
      border: 1px solid var(--line);
      border-radius: 14px;
      background: var(--card);
      padding: 8px 0;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    }
    tbody td {
      border: none;
      padding: 7px 14px;
      display: grid;
      grid-template-columns: minmax(82px, 94px) minmax(0, 1fr);
      gap: 10px;
      align-items: baseline;
      white-space: normal;
    }
    tbody td::before {
      content: attr(data-label);
      color: var(--muted);
      font-size: 12px;
      letter-spacing: 0.06em;
    }
    .cell-name {
      max-width: none;
    }
    .cell-updated {
      white-space: normal;
    }
  }
</style>
</head>
<body>
<div class="shell">
  <header class="masthead">
    <p class="eyebrow">Public Venue Dashboard</p>
    <h1>インフルクエスト 会場ボード</h1>
    <p class="intro">インフルだいまおうに さらわれた ちょまどひめを、みんなで たすけにいく MCP ゲームの会場ボードだよ。インフルエンサーではなく、インフルエンザのクエストです。参加者データを約4秒ごとに更新するの。</p>
  </header>
  <section class="join">
    <h2>あそびかた</h2>
    <ol>
      <li>スマホで claude.ai にログインする（無料アカウントで大丈夫）</li>
      <li>設定の「コネクタ」からカスタムコネクタを追加して、URL に <code>https://influ-quest.nukoevi.app/mcp</code> を入れる</li>
      <li>新しいチャットで「インフルクエストをはじめて」と話しかける</li>
    </ol>
    <p>コネクタが使えないときは <a href="/play">ブラウザ版</a> で遊べるよ。いまみんながやったこの登録操作こそが MCP なの。</p>
  </section>
  <main class="board" data-view="loading">
    <section class="statusbar" aria-live="polite" aria-atomic="true">
      <div class="statusline">
        <span class="lamp" aria-hidden="true"></span>
        <p class="status-text" id="status-text">会場データを読み込んでいるよ</p>
      </div>
      <p class="status-detail" id="status-detail">はじめての通信を待っているの</p>
      <div class="summary">
        <section class="summary-box">
          <p class="summary-label">参加者数</p>
          <p class="summary-value" id="summary-count">読み込み中</p>
        </section>
        <section class="summary-box">
          <p class="summary-label">最終更新</p>
          <p class="summary-value" id="summary-updated">まだありません</p>
        </section>
      </div>
    </section>
    <section class="table-shell">
      <table aria-describedby="status-detail">
        <caption>会場の参加者一覧</caption>
        <thead>
          <tr>
            <th scope="col">なまえ</th>
            <th scope="col">レベル</th>
            <th scope="col">HP</th>
            <th scope="col">ばしょ</th>
            <th scope="col">じょうたい</th>
            <th scope="col">こうしん</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </section>
  </main>
</div>
<script>
  const board = document.querySelector(".board");
  const rows = document.getElementById("rows");
  const statusText = document.getElementById("status-text");
  const statusDetail = document.getElementById("status-detail");
  const summaryCount = document.getElementById("summary-count");
  const summaryUpdated = document.getElementById("summary-updated");
  const viewMessages = {
    loading: "会場データを読み込んでいるよ",
    empty: "まだ公開された参加者データがないよ",
    fresh: "会場の最新データを表示しているよ",
    stale: "更新に失敗したから、直前の表示をそのまま残しているよ",
    error: "会場データと通信できないよ",
  };
  const detailMessages = {
    loading: "はじめての通信を待っているの",
    empty: "参加者が送信すると、ここに並ぶよ",
    fresh: "いま見えている一覧は最新の応答だよ",
    stale: "しばらくすると自動で再試行するよ",
    error: "ページを開いたままだと自動で再接続するよ",
  };
  const rowLabels = ["なまえ", "レベル", "HP", "ばしょ", "じょうたい", "こうしん"];
  const timeFormatter = new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const state = {
    hasSuccessfulSnapshot: false,
    inFlight: null,
    timer: 0,
    visible: !document.hidden,
    lastGeneratedAt: null,
    players: [],
  };
  const setView = (view, detail) => {
    board.dataset.view = view;
    statusText.textContent = viewMessages[view];
    statusDetail.textContent = detail || detailMessages[view];
  };
  const setSummary = (countText, updatedText) => {
    summaryCount.textContent = countText;
    summaryUpdated.textContent = updatedText;
  };
  const formatTimestamp = (value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return "不明";
    }
    return timeFormatter.format(new Date(value));
  };
  const statusOf = (player) => {
    if (player.cheatCleared) return { label: "チートクリア", cls: "status-cheat" };
    if (player.cleared) return { label: "クリア", cls: "status-clear" };
    if (player.princessCarried) return { label: "ちょまどひめを かついでいる", cls: "status-princess" };
    if (player.dragonDefeated) return { label: "だいまおうを たおした", cls: "status-boss" };
    return { label: "ぼうけんちゅう", cls: "" };
  };
  const renderPlayers = (players) => {
    const fragment = document.createDocumentFragment();
    if (!players.length) {
      const tr = document.createElement("tr");
      tr.className = "state-empty";
      const td = document.createElement("td");
      td.colSpan = 6;
      td.setAttribute("data-label", "おしらせ");
      td.textContent = "まだ だれも ぼうけんに でていないよ";
      tr.appendChild(td);
      fragment.appendChild(tr);
      rows.replaceChildren(fragment);
      return;
    }
    for (const player of players) {
      const tr = document.createElement("tr");
      const status = statusOf(player);
      const values = [
        { label: rowLabels[0], text: player.name, className: "cell-name" },
        { label: rowLabels[1], text: String(player.level) },
        { label: rowLabels[2], text: String(player.hp) + " / " + String(player.maxHp) },
        { label: rowLabels[3], text: player.location },
        { label: rowLabels[4], text: status.label, className: "cell-status " + status.cls },
        { label: rowLabels[5], text: formatTimestamp(player.updatedAt), className: "cell-updated" },
      ];
      for (const cell of values) {
        const td = document.createElement("td");
        td.setAttribute("data-label", cell.label);
        td.textContent = cell.text;
        if (cell.className) td.className = cell.className;
        tr.appendChild(td);
      }
      fragment.appendChild(tr);
    }
    rows.replaceChildren(fragment);
  };
  const scheduleNext = () => {
    if (!state.visible) return;
    clearTimeout(state.timer);
    const delay = 3600 + Math.floor(Math.random() * 900);
    state.timer = window.setTimeout(() => {
      void refresh();
    }, delay);
  };
  const readSnapshot = async () => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch("/api/players", {
        cache: "no-store",
        signal: controller.signal,
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("bad-json");
      }
      if (!response.ok) {
        throw new Error("http-" + String(response.status));
      }
      if (!data || !Array.isArray(data.players) || typeof data.generatedAt !== "number") {
        throw new Error("bad-shape");
      }
      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  };
  const applySnapshot = (snapshot) => {
    state.players = snapshot.players;
    state.lastGeneratedAt = snapshot.generatedAt;
    state.hasSuccessfulSnapshot = true;
    renderPlayers(snapshot.players);
    setSummary(String(snapshot.players.length) + "人", formatTimestamp(snapshot.generatedAt));
    if (snapshot.players.length === 0) {
      setView("empty");
      return;
    }
    setView("fresh");
  };
  const handleRefreshFailure = () => {
    if (state.hasSuccessfulSnapshot) {
      setView("stale");
      setSummary(String(state.players.length) + "人", formatTimestamp(state.lastGeneratedAt));
      return;
    }
    renderPlayers([]);
    setSummary("通信失敗", "まだありません");
    setView("error");
  };
  const refresh = () => {
    if (state.inFlight) return state.inFlight;
    state.inFlight = (async () => {
      try {
        const snapshot = await readSnapshot();
        applySnapshot(snapshot);
      } catch {
        handleRefreshFailure();
      } finally {
        state.inFlight = null;
        scheduleNext();
      }
    })();
    return state.inFlight;
  };
  document.addEventListener("visibilitychange", () => {
    state.visible = !document.hidden;
    if (!state.visible) {
      clearTimeout(state.timer);
      state.timer = 0;
      return;
    }
    void refresh();
  });
  setSummary("読み込み中", "まだありません");
  setView("loading");
  renderPlayers([]);
  void refresh();
</script>
</body>
</html>`;
