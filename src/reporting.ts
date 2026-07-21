import type { Snapshot } from "./engine.js";

type FetchLike = typeof fetch;
type TimeoutHandle = ReturnType<typeof setTimeout>;

type DashboardReporterOptions = {
  url: string;
  token: string;
  loadPlayerId: () => string;
  fetchImpl?: FetchLike;
  cooldownMs?: number;
  timeoutMs?: number;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => TimeoutHandle;
  clearSchedule?: (handle: TimeoutHandle) => void;
};

export type DashboardReporter = {
  enabled: boolean;
  report(snapshot: Snapshot): void;
  dispose(): void;
};

const disabledReporter: DashboardReporter = {
  enabled: false,
  report() {},
  dispose() {},
};

export function dashboardReportingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const url = (env.INFLUENZA_QUEST_DASHBOARD_URL ?? "").trim();
  const token = (env.INFLUENZA_QUEST_EVENT_TOKEN ?? "").trim();
  return url.length > 0 && url !== "off" && token.length > 0;
}

export function createDashboardReporter(options: DashboardReporterOptions): DashboardReporter {
  const url = options.url.trim().replace(/\/+$/, "");
  const token = options.token.trim();
  if (url.length === 0 || url === "off" || token.length === 0) {
    return disabledReporter;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const cooldownMs = options.cooldownMs ?? 5000;
  const timeoutMs = options.timeoutMs ?? 1500;
  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearSchedule = options.clearSchedule ?? ((handle) => clearTimeout(handle));
  const playerId = options.loadPlayerId();

  let lastPostedPayload = "";
  let pendingPayload = "";
  let lastPostAt = Number.NEGATIVE_INFINITY;
  let timer: TimeoutHandle | null = null;
  let sending = false;
  let lastFailedPayload = "";
  let failureCount = 0;

  const scheduleFlush = () => {
    if (timer !== null || pendingPayload.length === 0) {
      return;
    }
    const delayMs = Math.max(cooldownMs - (now() - lastPostAt), 0);
    timer = schedule(() => {
      timer = null;
      void flush();
    }, delayMs);
    if (
      typeof timer === "object" &&
      timer !== null &&
      "unref" in timer &&
      typeof timer.unref === "function"
    ) {
      timer.unref();
    }
  };

  const flush = async () => {
    if (sending || pendingPayload.length === 0) {
      return;
    }
    const waitMs = cooldownMs - (now() - lastPostAt);
    if (waitMs > 0) {
      scheduleFlush();
      return;
    }
    const payload = pendingPayload;
    pendingPayload = "";
    sending = true;
    lastPostAt = now();
    try {
      const response = await fetchImpl(`${url}/api/state`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error("dashboard rejected state");
      }
      lastPostedPayload = payload;
      lastFailedPayload = "";
      failureCount = 0;
    } catch {
      if (lastFailedPayload === payload) {
        failureCount += 1;
      } else {
        lastFailedPayload = payload;
        failureCount = 1;
      }
      if (failureCount < 2 && pendingPayload.length === 0) {
        pendingPayload = payload;
      }
    }
    sending = false;
    if (pendingPayload.length > 0 && pendingPayload !== lastPostedPayload) {
      scheduleFlush();
    }
  };

  return {
    enabled: true,
    report(snapshot) {
      const payload = JSON.stringify({ id: playerId, ...snapshot });
      if (payload === lastPostedPayload || payload === pendingPayload) {
        return;
      }
      if (payload === lastFailedPayload && failureCount >= 2) {
        return;
      }
      if (payload !== lastFailedPayload) {
        lastFailedPayload = "";
        failureCount = 0;
      }
      pendingPayload = payload;
      if (!sending && now() - lastPostAt >= cooldownMs) {
        void flush();
        return;
      }
      scheduleFlush();
    },
    dispose() {
      if (timer !== null) {
        clearSchedule(timer);
        timer = null;
      }
      pendingPayload = "";
    },
  };
}
