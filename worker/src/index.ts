import { McpAgent } from "agents/mcp";
import { createEngine, type Engine } from "../../src/engine.js";
import { createGameServer } from "../../src/mcp.js";
import { createInitialState, readStoredGameData } from "../../src/state.js";
import { BrowserChatSession, routeChatRequest } from "./chat-session.js";
import { createBoard, isHeroNameTaken, writePlayerSnapshot } from "./board.js";
import { playPage } from "./play.js";

type Env = {
  PLAYERS: unknown;
  SESSIONS: unknown;
  MCP_OBJECT: unknown;
  CHAT_SESSIONS: unknown;
  EVENT_ID?: string;
  EVENT_TOKEN?: string;
  EVENT_WRITE_UNTIL?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  CHAT_MODEL?: string;
  PLAYER_RATE_LIMIT?: unknown;
  EVENT_RATE_LIMIT?: unknown;
  CHAT_RATE_LIMIT?: unknown;
  CHAT_IP_RATE_LIMIT?: unknown;
};

type QuestAgentState = {
  save: unknown;
  playerId: string;
};

const SNAPSHOT_WRITE_COOLDOWN_MS = 2000;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class QuestAgent extends McpAgent<Env, QuestAgentState, Record<string, never>> {
  private wiring = createGameServer();
  server = this.wiring.server;
  initialState: QuestAgentState = { save: null, playerId: "" };
  private lastSnapshotWriteAt = 0;
  private snapshotWriterActive = false;
  private queuedSnapshot:
    | Parameters<NonNullable<Parameters<typeof createEngine>[1]["report"]>>[0]
    | null = null;

  async init() {
    if (!UUID_V4_PATTERN.test(this.state.playerId)) {
      this.setState({ ...this.state, playerId: crypto.randomUUID() });
    }
    const restored = readStoredGameData(this.state.save, { preserveBattle: true });
    const loaded = restored.ok
      ? { state: restored.state, gameLog: restored.gameLog }
      : { state: createInitialState(), gameLog: [] };
    const engine: Engine = createEngine(loaded, {
      persist: () => {
        this.persistSave(engine);
      },
      report: (snapshot) => {
        this.persistSave(engine);
        const nowMs = Date.now();
        const important =
          snapshot.cleared ||
          snapshot.cheatCleared ||
          snapshot.princessCarried ||
          snapshot.dragonDefeated;
        if (important || nowMs - this.lastSnapshotWriteAt >= SNAPSHOT_WRITE_COOLDOWN_MS) {
          this.lastSnapshotWriteAt = nowMs;
          this.enqueueSnapshotWrite(snapshot);
        }
      },
      toolsChanged: () => {
        this.wiring.refreshTools();
      },
      elicitHostOffer: this.wiring.elicitHostOffer,
      isNameTaken: (name) => isHeroNameTaken(this.env, name, this.state.playerId),
    });
    this.wiring.attachEngine(engine);
  }

  private persistSave(engine: Engine) {
    this.setState({
      ...this.state,
      save: {
        version: 1,
        ...engine.state,
        gameLog: [...engine.gameLog],
        savedAt: new Date().toISOString(),
      },
    });
  }

  private enqueueSnapshotWrite(
    snapshot: Parameters<NonNullable<Parameters<typeof createEngine>[1]["report"]>>[0],
  ) {
    this.queuedSnapshot = snapshot;
    if (this.snapshotWriterActive) {
      return;
    }
    this.snapshotWriterActive = true;
    void this.flushSnapshotWrites();
  }

  private async flushSnapshotWrites() {
    while (this.queuedSnapshot) {
      const nextSnapshot = this.queuedSnapshot;
      this.queuedSnapshot = null;
      await writePlayerSnapshot(this.env, this.state.playerId, nextSnapshot);
    }
    this.snapshotWriterActive = false;
  }
}

const mcpHandler = QuestAgent.serve("/mcp");
const sseHandler = QuestAgent.serveSSE("/sse");
const board = createBoard();
export { BrowserChatSession };

export default {
  async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return mcpHandler.fetch(request, env, ctx as never);
    }
    if (url.pathname === "/sse" || url.pathname.startsWith("/sse/")) {
      return sseHandler.fetch(request, env, ctx as never);
    }
    if (url.pathname === "/play") {
      return playPage();
    }
    if (url.pathname === "/api/chat") {
      return routeChatRequest(request, env);
    }
    if (url.pathname === "/api/client-log") {
      if (request.method !== "POST") {
        return new Response(null, { status: 405 });
      }
      const body = await request.text().catch(() => "");
      console.log("client log:", body.slice(0, 1000));
      return new Response(null, { status: 204 });
    }
    return board.fetch(request, env);
  },
};
