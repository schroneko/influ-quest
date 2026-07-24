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

const JSON_HEADERS = {
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

const BODY_LIMIT_BYTES = 2048;
const CACHE_TTL_MS = 3000;
export const KV_TTL_SECONDS = 21600;
const DEFAULT_EVENT_ID = "default";
const LOCATION_NAMES = new Set(["おおてまちじょう", "まもりのまち", "ウイルスのすみか"]);
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
  "rtaCleared",
  "princessCarried",
  "dragonDefeated",
  "virusKing",
  "infected",
  "clearMs",
  "updatedAt",
]);
const OPTIONAL_BOOLEAN_FIELDS = ["virusKing", "rtaCleared"];
const withOptionalFieldDefaults = (candidate) => {
  let filled = candidate;
  for (const field of OPTIONAL_BOOLEAN_FIELDS) {
    if (!(field in filled)) {
      filled = { ...filled, [field]: false };
    }
  }
  return filled;
};
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
  if (candidate.cleared && !candidate.dragonDefeated) return false;
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
  candidate = withOptionalFieldDefaults(candidate);
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
  if (typeof candidate.rtaCleared !== "boolean") return null;
  if (typeof candidate.princessCarried !== "boolean") return null;
  if (typeof candidate.dragonDefeated !== "boolean") return null;
  if (typeof candidate.virusKing !== "boolean") return null;
  if (typeof candidate.infected !== "boolean") return null;
  if (!isIntegerInRange(candidate.clearMs, 0, Number.MAX_SAFE_INTEGER)) return null;
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
    rtaCleared: candidate.rtaCleared,
    princessCarried: candidate.princessCarried,
    dragonDefeated: candidate.dragonDefeated,
    virusKing: candidate.virusKing,
    infected: candidate.infected,
    clearMs: candidate.clearMs,
    updatedAt: candidate.updatedAt,
  };
};

const validateIncomingBody = (candidate, now) => {
  if (!isPlainObject(candidate)) {
    return { error: apiError(400, "invalid_json", "JSON body must be an object") };
  }
  candidate = withOptionalFieldDefaults(candidate);
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
  const writeWindow = getWriteWindow(env, now);
  if (!writeWindow.valid || !writeWindow.writesOpen) {
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

export async function deletePlayerSnapshot(env, playerId) {
  if (typeof playerId !== "string" || !UUID_V4_PATTERN.test(playerId)) {
    return false;
  }
  try {
    const kv = getPlayersKv(env);
    await kv.delete(makePlayerKey(getEventId(env), playerId));
    return true;
  } catch {
    return false;
  }
}

export async function isHeroNameTaken(env, name, excludedPlayerId = "") {
  const normalizedName = sanitizeName(name);
  if (normalizedName === null || normalizedName !== name) {
    return false;
  }
  const kv = getPlayersKv(env);
  const eventId = getEventId(env);
  const ownKey = UUID_V4_PATTERN.test(excludedPlayerId)
    ? makePlayerKey(eventId, excludedPlayerId)
    : "";
  const prefix = makeEventPrefix(eventId);
  let cursor;
  do {
    let pageResult;
    try {
      pageResult = await kv.list({ prefix, limit: 1000, cursor });
    } catch {
      throw new ServiceUnavailableError();
    }
    for (const key of pageResult?.keys ?? []) {
      if (key.name === ownKey) {
        continue;
      }
      const record = validateRecordShape(key.metadata, { exactName: true });
      if (record?.name === normalizedName) {
        return true;
      }
    }
    cursor = pageResult?.list_complete ? undefined : pageResult?.cursor;
  } while (cursor);
  return false;
}

const tierOf = (record) => {
  if (record.cleared && !record.cheatCleared && !record.rtaCleared) return 0;
  if (record.cleared && record.rtaCleared && !record.cheatCleared) return 1;
  if (record.cheatCleared) return 2;
  if (record.princessCarried) return 3;
  if (record.dragonDefeated) return 4;
  return 5;
};

const clearSortValue = (record) => (record.clearMs > 0 ? record.clearMs : Number.MAX_SAFE_INTEGER);

const comparePlayers = (left, right) =>
  tierOf(left.record) - tierOf(right.record) ||
  clearSortValue(left.record) - clearSortValue(right.record) ||
  right.record.level - left.record.level ||
  right.record.gold - left.record.gold ||
  NAME_COMPARATOR.compare(left.record.name, right.record.name) ||
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
<meta name="description" content="インフルクエストのリーダーボード。勇者たちの冒険をリアルタイムで見守ろう">
<link rel="icon" type="image/png" href="/favicon.png">
<meta property="og:title" content="インフルクエスト 会場ボード">
<meta property="og:description" content="インフルクエストのリーダーボード。勇者たちの冒険をリアルタイムで見守ろう">
<meta property="og:type" content="website">
<meta property="og:url" content="https://influ-quest.nukoevi.app/">
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
    --mint: #7ee2ad;
    --rose: #ff8a70;
    --violet: #c6a6ff;
    --sky: #85d6ff;
    --dim: #9aa3b2;
    --virus: #58d858;
    --virus-dark: #17671f;
  }
  * {
    box-sizing: border-box;
  }
  html {
    background: #000;
  }
  body {
    margin: 0;
    min-height: 100vh;
    background: #000;
    color: var(--white);
    font-family: "DotGothic16", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", sans-serif;
    line-height: 1.9;
    padding: 24px 14px 56px;
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
  .shell {
    max-width: 1080px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 26px;
  }
  .dqwin {
    position: relative;
    background: #000;
    border: 3px solid var(--white);
    border-radius: 10px;
    padding: 18px 20px 16px;
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
    top: -16px;
    left: 18px;
    background: #000;
    padding: 0 10px;
    font-size: 14px;
    letter-spacing: 0.14em;
    color: var(--white);
  }
  .masthead {
    text-align: center;
    display: grid;
    gap: 8px;
    justify-items: center;
  }
  .eyebrow {
    margin: 0;
    color: var(--dim);
    letter-spacing: 0.5em;
    font-size: 12px;
  }
  .titlerow {
    display: flex;
    align-items: center;
    gap: 28px;
  }
  h1 {
    margin: 0;
    font-size: clamp(22px, 6.2vw, 56px);
    letter-spacing: 0.1em;
    color: var(--gold);
    text-shadow: 4px 4px 0 #7a1f1f, 8px 8px 0 rgba(0, 0, 0, 0.9);
    white-space: nowrap;
  }
  .tagline {
    margin: 0;
    font-size: clamp(13px, 2.6vw, 16px);
  }
  .tagline .pun {
    color: var(--sky);
  }
  .sprite {
    position: relative;
    width: 55px;
    height: 55px;
    flex: none;
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
      transform: translateY(4px);
    }
  }
  .talk {
    margin: 0;
    font-size: 15px;
  }
  .talk + ol,
  ol + .talk {
    margin-top: 10px;
  }
  .talk .speaker {
    color: var(--gold);
  }
  .join ol {
    margin: 10px 0 0;
    padding-left: 26px;
    font-size: 15px;
  }
  .join li {
    margin-bottom: 6px;
  }
  .join li::marker {
    color: var(--gold);
  }
  .join code {
    display: inline-block;
    background: #101418;
    border: 1px solid rgba(255, 255, 255, 0.4);
    border-radius: 6px;
    padding: 1px 8px;
    font-family: inherit;
    font-size: 14px;
    color: var(--mint);
    word-break: break-all;
  }
  .join a {
    color: var(--sky);
  }
  .statusbar {
    display: grid;
    gap: 6px;
    margin-bottom: 12px;
  }
  .status-text {
    margin: 0;
    font-size: 16px;
  }
  .status-text::before {
    content: "＊「";
  }
  .status-text::after {
    content: "」";
  }
  .status-detail {
    margin: 0;
    color: var(--dim);
    font-size: 13px;
    min-height: 1.7em;
  }
  .summary {
    margin: 0;
    font-size: 15px;
  }
  .summary .accent {
    color: var(--gold);
  }
  .board[data-view="error"] .status-text {
    color: var(--rose);
  }
  .board[data-view="stale"] .status-text {
    color: var(--gold);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
    font-size: 15px;
  }
  caption {
    text-align: left;
    color: var(--dim);
    font-size: 13px;
    padding: 0 0 10px;
  }
  th,
  td {
    text-align: left;
    padding: 9px 12px;
    border-top: 1px dashed rgba(255, 255, 255, 0.25);
    vertical-align: top;
  }
  thead th {
    border-top: none;
    color: var(--dim);
    font-size: 13px;
    letter-spacing: 0.12em;
    font-weight: normal;
  }
  tbody tr:nth-child(1) .cell-rank {
    color: var(--gold);
  }
  tbody tr:nth-child(2) .cell-rank {
    color: var(--sky);
  }
  tbody tr:nth-child(3) .cell-rank {
    color: var(--rose);
  }
  .cell-rank {
    white-space: nowrap;
  }
  .cell-name {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cell-status {
    color: var(--sky);
  }
  .cell-status::before {
    content: "▶ ";
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
  .state-empty td {
    color: var(--dim);
  }
  .foot {
    text-align: center;
    color: var(--dim);
    font-size: 13px;
  }
  .blink {
    animation: blink 1s steps(1) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  @media (max-width: 760px) {
    body {
      padding: 16px 8px 40px;
    }
    .titlerow {
      gap: 8px;
    }
    .sprite {
      width: 40px;
      height: 40px;
      transform: scale(0.7);
      transform-origin: center;
    }
    table,
    thead,
    tbody,
    tr,
    th,
    td {
      display: block;
    }
    caption {
      display: block;
      width: 100%;
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
      border: 2px solid var(--white);
      border-radius: 8px;
      padding: 6px 0;
    }
    tbody td {
      border: none;
      padding: 5px 14px;
      display: grid;
      grid-template-columns: minmax(86px, 100px) minmax(0, 1fr);
      gap: 10px;
      align-items: baseline;
      white-space: normal;
    }
    tbody td::before {
      content: attr(data-label);
      color: var(--dim);
      font-size: 12px;
      letter-spacing: 0.06em;
    }
    .cell-name {
      max-width: none;
    }
    .cell-status::before {
      content: attr(data-label);
    }
  }
</style>
</head>
<body>
<div class="shell">
  <header class="masthead">
    <p class="eyebrow">INFLU QUEST</p>
    <div class="titlerow">
      <div class="sprite" aria-hidden="true"><i class="px"></i></div>
      <h1>インフルクエスト</h1>
      <div class="sprite" aria-hidden="true"><i class="px"></i></div>
    </div>
    <p class="tagline">インフルだいまおうに さらわれた ちょまどひめを すくいだせ！<br><span class="pun">インフルエンサーでは なく インフルエンザの クエストです。</span></p>
  </header>
  <section class="dqwin join" data-title="― あそびかた ―">
    <p class="talk"><span class="speaker">やくざいし</span>「よくきた ぼうけんしゃよ。てじゅんは みっつ じゃ。」</p>
    <ol>
      <li><a href="/play">ブラウザばん</a> を ひらく</li>
      <li>がぞうと おとつきの ぼうけんを はじめる</li>
      <li>Claude の コネクタばんは ごかん けいろで、<code>https://influ-quest.nukoevi.app/mcp</code> を つかう</li>
    </ol>
    <p class="talk"><span class="speaker">やくざいし</span>「ブラウザばんが ほんけで、がぞうも おとも でるのじゃ。Claude の コネクタばんでも あそべるが、そちらは がぞうと おとが でぬ ごかん けいろじゃ。」</p>
  </section>
  <main class="dqwin board" data-title="― ぼうけんのしょ ―" data-view="loading">
    <section class="statusbar" aria-live="polite" aria-atomic="true">
      <p class="status-text" id="status-text">かいじょうの データを よみこんでいる……</p>
      <p class="status-detail" id="status-detail">はじめての つうしんを まっている</p>
      <p class="summary">ぼうけんしゃ <span class="accent" id="summary-count">--</span> にん　／　こうしん <span class="accent" id="summary-updated">--:--:--</span></p>
    </section>
    <section class="table-shell">
      <table aria-describedby="status-detail">
        <caption>じゅんいは クリア → 爆速RTA → せかいめつぼう → きゅうしゅつちゅう → とうばつずみ → ぼうけんちゅう の じゅんで、どうじゅんなら クリアタイム → レベル → ゴールド → なまえ で きまる。きろくは 6 じかんで きえる</caption>
        <thead>
          <tr>
            <th scope="col">じゅんい</th>
            <th scope="col">なまえ</th>
            <th scope="col">レベル</th>
            <th scope="col">HP</th>
            <th scope="col">ゴールド</th>
            <th scope="col">ばしょ</th>
            <th scope="col">じょうたい</th>
            <th scope="col">タイム</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </section>
  </main>
  <p class="foot">この がめんは じどうで こうしん される<span class="blink">▼</span></p>
</div>
<script>
  const board = document.querySelector(".board");
  const rows = document.getElementById("rows");
  const statusText = document.getElementById("status-text");
  const statusDetail = document.getElementById("status-detail");
  const summaryCount = document.getElementById("summary-count");
  const summaryUpdated = document.getElementById("summary-updated");
  const viewMessages = {
    loading: "かいじょうの データを よみこんでいる……",
    empty: "まだ だれも ぼうけんに でていない",
    fresh: "かいじょうの さいしんデータを ひょうじちゅう",
    stale: "こうしんに しっぱいした。ひとつまえの ひょうじを のこしている",
    error: "かいじょうデータと つうしん できない",
  };
  const detailMessages = {
    loading: "はじめての つうしんを まっている",
    empty: "ぼうけんしゃが あらわれると ここに ならぶ",
    fresh: "いま みえている いちらんが さいしんの きろく",
    stale: "しばらくすると じどうで さいちょうせん する",
    error: "ひらいたままに しておけば じどうで さいせつぞく する",
  };
  const rowLabels = ["じゅんい", "なまえ", "レベル", "HP", "ゴールド", "ばしょ", "じょうたい", "タイム"];
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
      return "ふめい";
    }
    return timeFormatter.format(new Date(value));
  };
  const statusOf = (player) => {
    if (player.cheatCleared) return { label: "せかいめつぼう", cls: "status-cheat" };
    if (player.cleared && player.rtaCleared) return { label: "爆速RTA", cls: "status-cheat" };
    if (player.cleared) return { label: "クリア", cls: "status-clear" };
    if (player.princessCarried) return { label: "ちょまどひめを かついでいる", cls: "status-princess" };
    if (player.dragonDefeated) return { label: "だいまおうを たおした", cls: "status-boss" };
    if (player.virusKing) return { label: "だいまおう", cls: "status-cheat" };
    if (player.location === "まもりのまち") return { label: "まちを さんさく", cls: "" };
    return { label: "ぼうけんちゅう", cls: "" };
  };
  const formatClearTime = (clearMs) => {
    if (typeof clearMs !== "number" || clearMs <= 0) {
      return "--";
    }
    const totalSeconds = Math.floor(clearMs / 1000);
    return String(Math.floor(totalSeconds / 60)) + "ふん " + String(totalSeconds % 60) + "びょう";
  };
  const renderPlayers = (players) => {
    const fragment = document.createDocumentFragment();
    if (!players.length) {
      const tr = document.createElement("tr");
      tr.className = "state-empty";
      const td = document.createElement("td");
      td.colSpan = 8;
      td.setAttribute("data-label", "おしらせ");
      td.textContent = "＊「まだ だれも ぼうけんに でていない」";
      tr.appendChild(td);
      fragment.appendChild(tr);
      rows.replaceChildren(fragment);
      return;
    }
    const nameSeen = new Map();
    players.forEach((player, index) => {
      const seenCount = (nameSeen.get(player.name) ?? 0) + 1;
      nameSeen.set(player.name, seenCount);
      const displayName = seenCount === 1 ? player.name : player.name + "（" + String(seenCount) + "）";
      const tr = document.createElement("tr");
      const status = statusOf(player);
      const values = [
        { label: rowLabels[0], text: String(index + 1) + " い", className: "cell-rank" },
        { label: rowLabels[1], text: displayName, className: "cell-name" },
        { label: rowLabels[2], text: String(player.level) },
        { label: rowLabels[3], text: String(player.hp) + " / " + String(player.maxHp) },
        { label: rowLabels[4], text: String(player.gold) + " G" },
        { label: rowLabels[5], text: player.location },
        { label: rowLabels[6], text: status.label, className: "cell-status " + status.cls },
        { label: rowLabels[7], text: formatClearTime(player.clearMs) },
      ];
      for (const cell of values) {
        const td = document.createElement("td");
        td.setAttribute("data-label", cell.label);
        td.textContent = cell.text;
        if (cell.className) td.className = cell.className;
        tr.appendChild(td);
      }
      fragment.appendChild(tr);
    });
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
    setSummary(String(snapshot.players.length), formatTimestamp(snapshot.generatedAt));
    if (snapshot.players.length === 0) {
      setView("empty");
      return;
    }
    setView("fresh");
  };
  const handleRefreshFailure = () => {
    if (state.hasSuccessfulSnapshot) {
      setView("stale");
      setSummary(String(state.players.length), formatTimestamp(state.lastGeneratedAt));
      return;
    }
    renderPlayers([]);
    setSummary("--", "--:--:--");
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
  setSummary("--", "--:--:--");
  setView("loading");
  renderPlayers([]);
  void refresh();
</script>
</body>
</html>`;
