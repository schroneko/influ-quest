import { JSON_HEADERS, handleChat, readChatRequestEnvelope } from "./play.js";

const SESSION_STORAGE_KEY = "session";
export const SESSION_TTL_MS = 21600000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const serviceUnavailable = () =>
  json(
    {
      ok: false,
      error: "service_unavailable",
      message: "せかいが ふあんていだ。もういちど ためしてくれ。",
    },
    503,
  );

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function normalizeSession(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  return {
    playerId: typeof value.playerId === "string" ? value.playerId : "",
    turns: Number.isInteger(value.turns) && value.turns >= 0 ? value.turns : 0,
    messages: Array.isArray(value.messages) ? value.messages : [],
    save: "save" in value ? value.save : null,
  };
}

function normalizeStoredRecord(value, now) {
  if (!isPlainObject(value)) {
    return null;
  }
  if (!Number.isFinite(value.expiresAt)) {
    return null;
  }
  const session = normalizeSession(value.session);
  if (!session) {
    return null;
  }
  if (value.expiresAt <= now) {
    return { expired: true, session: null };
  }
  return { expired: false, session };
}

export function createMemoryChatSessionStore(initialSession = null, options = {}) {
  const now = options.now ?? (() => Date.now());
  let record =
    initialSession == null
      ? null
      : {
          expiresAt: now() + SESSION_TTL_MS,
          session: normalizeSession(initialSession),
        };

  const write = async (_sessionId, session) => {
    const normalized = normalizeSession(session);
    if (!normalized) {
      throw new Error("invalid session");
    }
    record = {
      expiresAt: now() + SESSION_TTL_MS,
      session: normalized,
    };
  };

  return {
    async read() {
      if (!record) {
        return null;
      }
      const normalized = normalizeStoredRecord(record, now());
      if (!normalized || normalized.expired) {
        record = null;
        return null;
      }
      return normalized.session;
    },
    write,
  };
}

export function createDurableChatSessionStore(state, env, options = {}) {
  const now = options.now ?? (() => Date.now());

  const write = async (_sessionId, session) => {
    const normalized = normalizeSession(session);
    if (!normalized) {
      throw new Error("invalid session");
    }
    try {
      await state.storage.put(SESSION_STORAGE_KEY, {
        expiresAt: now() + SESSION_TTL_MS,
        session: normalized,
      });
    } catch {
      throw new Error("session_write_failed");
    }
  };

  return {
    async read(sessionId) {
      let stored;
      try {
        stored = await state.storage.get(SESSION_STORAGE_KEY);
      } catch {
        throw new Error("session_read_failed");
      }
      if (stored !== undefined) {
        const normalized = normalizeStoredRecord(stored, now());
        if (!normalized) {
          return null;
        }
        if (normalized.expired) {
          try {
            await state.storage.delete(SESSION_STORAGE_KEY);
          } catch {
            throw new Error("session_read_failed");
          }
          return null;
        }
        return normalized.session;
      }
      if (!env?.SESSIONS || typeof env.SESSIONS.get !== "function") {
        return null;
      }
      let legacySession;
      try {
        legacySession = await env.SESSIONS.get(`chat:${sessionId}`, "json");
      } catch {
        throw new Error("legacy_session_read_failed");
      }
      const normalizedLegacy = normalizeSession(legacySession);
      if (!normalizedLegacy) {
        return null;
      }
      await write(sessionId, normalizedLegacy);
      return normalizedLegacy;
    },
    write,
  };
}

export async function routeChatRequest(request, env) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  if (
    !env?.CHAT_SESSIONS ||
    typeof env.CHAT_SESSIONS.idFromName !== "function" ||
    typeof env.CHAT_SESSIONS.get !== "function"
  ) {
    return serviceUnavailable();
  }
  const envelope = await readChatRequestEnvelope(request);
  if (!envelope.ok) {
    return envelope.response;
  }
  const id = env.CHAT_SESSIONS.idFromName(envelope.value.sessionId);
  const stub = env.CHAT_SESSIONS.get(id);
  const headers = new Headers(request.headers);
  return stub.fetch(
    new Request("https://browser-chat.internal/session", {
      method: "POST",
      headers,
      body: envelope.value.bodyText,
    }),
  );
}

export class BrowserChatSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.queue = Promise.resolve();
  }

  fetch(request) {
    const execute = async () => {
      const envelope = await readChatRequestEnvelope(request);
      if (!envelope.ok) {
        return envelope.response;
      }
      return handleChat(
        request,
        this.env,
        undefined,
        createDurableChatSessionStore(this.state, this.env),
        envelope,
      );
    };
    const response = this.queue.then(execute, execute);
    this.queue = response.then(
      () => undefined,
      () => undefined,
    );
    return response;
  }
}
