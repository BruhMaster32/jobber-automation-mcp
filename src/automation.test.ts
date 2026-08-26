import { afterAll, beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.PORT = "8080";
  process.env.PUBLIC_BASE_URL = "http://localhost:8080";
  process.env.MCP_PATH_TOKEN = "mcp-test-token-that-is-longer-than-thirty-two-bytes";
  process.env.SETUP_KEY = "setup-test-key-that-is-longer-than-thirty-two-bytes";
  process.env.JOBBER_CLIENT_ID = "7b19a96d-e880-4dcd-8de4-adc49f6b9bf8";
  process.env.JOBBER_CLIENT_SECRET = "test-client-secret-not-real";
  process.env.JOBBER_GRAPHQL_VERSION = "2025-04-16";
  process.env.DATABASE_PATH = `/tmp/jobber-mcp-test-${process.pid}.sqlite`;
  process.env.ENABLE_AUTOMATION_WORKER = "false";
});

describe("automation lifecycle", () => {
  it("creates, previews, activates, runs, pauses, and records history", async () => {
    const store = await import("./store.js");
    const engine = await import("./automation.js");
    const created = store.createAutomation({
      name: "Test automation",
      description: "Exercises the safe local action.",
      status: "draft",
      approvalPolicy: "always",
      trigger: { type: "manual" },
      actions: [{ type: "log.message", message: "Test completed" }]
    });

    expect(store.getAutomation(created.id)?.status).toBe("draft");
    const preview = await engine.runAutomation(created.id, "preview");
    expect(preview.status).toBe("previewed");

    store.updateAutomation(created.id, { status: "active", nextRunAt: null });
    const executed = await engine.runAutomation(created.id, "manual");
    expect(executed.status).toBe("succeeded");
    expect(store.listAutomationRuns(created.id)).toHaveLength(2);

    store.updateAutomation(created.id, { status: "paused", nextRunAt: null });
    await expect(engine.runAutomation(created.id, "manual")).rejects.toThrow("Only active automations");
    expect(store.deleteAutomation(created.id)).toBe(true);
  });
});

afterAll(async () => {
  const store = await import("./store.js");
  store.closeDatabase();
});
