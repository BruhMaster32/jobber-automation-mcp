import crypto from "node:crypto";
import express from "express";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { buildMcpServer } from "./mcp.js";
import { callbackUrl, config, mcpPath } from "./config.js";
import { consumeOAuthState, createOAuthState } from "./store.js";
import { exchangeCode, jobberGraphql } from "./jobber.js";
import { startAutomationWorker, stopAutomationWorker } from "./automation.js";
import { closeDatabase } from "./store.js";

const app = express();
app.disable("x-powered-by");

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/admin/connect", async (req, res) => {
  if (req.query.key !== config.SETUP_KEY) return res.status(404).send("Not found");
  const state = crypto.randomBytes(32).toString("base64url");
  await createOAuthState(crypto.createHash("sha256").update(state).digest("hex"));
  const url = new URL("https://api.getjobber.com/api/oauth/authorize");
  url.searchParams.set("client_id", config.JOBBER_CLIENT_ID);
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

app.get("/oauth/jobber/callback", async (req, res) => {
  const code = String(req.query.code ?? "");
  const state = String(req.query.state ?? "");
  const stateHash = crypto.createHash("sha256").update(state).digest("hex");
  if (!code || !state || !(await consumeOAuthState(stateHash))) return res.status(400).send("Invalid or expired OAuth response.");
  try {
    await exchangeCode(code, callbackUrl);
    const account = await jobberGraphql("query Account { account { id name } }");
    res.type("html").send(`<h1>Jobber connected</h1><p>${escapeHtml(JSON.stringify(account))}</p><p>You may close this page.</p>`);
  } catch (error) {
    res.status(500).send(`Connection failed: ${escapeHtml(error instanceof Error ? error.message : String(error))}`);
  }
});

const mcp = toNodeHandler(createMcpHandler(() => buildMcpServer(), { legacy: "stateless" }));
app.all(mcpPath, (req, res) => void mcp(req, res));
app.use((_req, res) => res.status(404).json({ error: "not_found" }));

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!);
}

app.listen(config.PORT, "0.0.0.0", () => {
  console.log(`Jobber Automation MCP listening on port ${config.PORT}`);
});

if (config.ENABLE_AUTOMATION_WORKER) startAutomationWorker(config.AUTOMATION_POLL_SECONDS);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopAutomationWorker();
    closeDatabase();
    process.exit(0);
  });
}
