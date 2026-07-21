import { McpAgent } from "agents/mcp";
import { createEngine, type Engine } from "../../src/engine.js";
import { createGameServer } from "../../src/mcp.js";
import { createInitialState, readStoredGameData } from "../../src/state.js";
import { createBoard, writePlayerSnapshot } from "./board.js";
import { handleChat, playPage } from "./play.js";

type Env = {
  PLAYERS: unknown;
  SESSIONS: unknown;
  MCP_OBJECT: unknown;
  EVENT_ID?: string;
  EVENT_TOKEN?: string;
  EVENT_WRITE_UNTIL?: string;
  ANTHROPIC_API_KEY?: string;
  CHAT_MODEL?: string;
  PLAYER_RATE_LIMIT?: unknown;
  EVENT_RATE_LIMIT?: unknown;
  CHAT_RATE_LIMIT?: unknown;
};

type QuestAgentState = {
  save: unknown;
  playerId: string;
};

const SNAPSHOT_WRITE_COOLDOWN_MS = 2000;

export class QuestAgent extends McpAgent<Env, QuestAgentState, Record<string, never>> {
  private wiring = createGameServer();
  server = this.wiring.server;
  initialState: QuestAgentState = { save: null, playerId: "" };
  private lastSnapshotWriteAt = 0;

  async init() {
    if (!this.state.playerId) {
      this.setState({ ...this.state, playerId: crypto.randomUUID() });
    }
    const restored = readStoredGameData(this.state.save);
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
          void writePlayerSnapshot(this.env, this.state.playerId, snapshot);
        }
      },
      toolsChanged: () => {
        this.wiring.refreshTools();
      },
      elicitHostOffer: this.wiring.elicitHostOffer,
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
}

const mcpHandler = QuestAgent.serve("/mcp");
const sseHandler = QuestAgent.serveSSE("/sse");
const board = createBoard();

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
      return handleChat(request, env, ctx);
    }
    return board.fetch(request, env);
  },
};
