#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createEngine } from "./engine.js";
import { createGameServer } from "./mcp.js";
import { createDashboardReporter } from "./reporting.js";
import { loadGame, loadPlayerId, resetSave, saveGame, writeScreenHtml } from "./storage.js";

const loadedGame = loadGame();

const reporter = createDashboardReporter({
  url: process.env.INFLUENZA_QUEST_DASHBOARD_URL ?? "",
  token: process.env.INFLUENZA_QUEST_EVENT_TOKEN ?? "",
  loadPlayerId,
});

const { server, attachEngine, elicitHostOffer, refreshTools } = createGameServer({
  writeScreen: (html) => writeScreenHtml(html),
});

const engine = createEngine(loadedGame, {
  persist: () => {
    saveGame(undefined, engine.state, engine.gameLog);
  },
  report: (snapshot) => {
    reporter.report(snapshot);
  },
  toolsChanged: () => {
    refreshTools();
  },
  elicitHostOffer,
  resetSave: () => resetSave(),
});

attachEngine(engine);

const transport = new StdioServerTransport();
await server.connect(transport);
