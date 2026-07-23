import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createEngine, type Engine, type EngineIO, type ToolResult } from "./engine.js";
import { createGameServer, type GameServerOptions } from "./mcp.js";

type LoadedGame = Parameters<typeof createEngine>[0];

export type GameRuntimeOptions = {
  loadedGame: LoadedGame;
  engineOptions?: Omit<EngineIO, "toolsChanged" | "elicitHostOffer">;
  serverOptions?: GameServerOptions;
  clientName?: string;
  clientVersion?: string;
};

export type GameRuntime = {
  engine: Engine;
  listTools: () => ReturnType<Client["listTools"]>;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<ToolResult>;
  snapshotSave: () => {
    version: number;
    gameLog: string[];
    savedAt: string;
  } & Engine["state"];
  close: () => Promise<void>;
};

export async function createGameRuntime(options: GameRuntimeOptions): Promise<GameRuntime> {
  const wiring = createGameServer(options.serverOptions);
  const engine = createEngine(options.loadedGame, {
    ...options.engineOptions,
    toolsChanged: () => {
      wiring.refreshTools();
    },
    elicitHostOffer: wiring.elicitHostOffer,
  });
  wiring.attachEngine(engine);

  const client = new Client(
    {
      name: options.clientName ?? "influenza-quest-browser",
      version: options.clientVersion ?? "0.1.0",
    },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await wiring.server.connect(serverTransport);
  await client.connect(clientTransport);

  let closed = false;

  return {
    engine,
    listTools: () => client.listTools(),
    async callTool(name, args = {}) {
      const result = (await client.callTool({
        name,
        arguments: args,
      })) as CallToolResult;
      return {
        content: result.content
          .filter((item) => item.type === "text")
          .map((item) => ({ type: "text" as const, text: item.text })),
        isError: result.isError === true,
      };
    },
    snapshotSave: () => ({
      version: 1,
      ...engine.state,
      gameLog: [...engine.gameLog],
      savedAt: new Date().toISOString(),
    }),
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await client.close().catch(() => undefined);
      await wiring.server.close().catch(() => undefined);
    },
  };
}
