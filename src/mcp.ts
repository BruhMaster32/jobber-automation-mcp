import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { jobberGraphql } from "./jobber.js";
import { requireMutation, requireQuery } from "./graphql-safety.js";
import { nextRunAt, previewAutomation, runAutomation } from "./automation.js";
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  listAutomationRuns,
  updateAutomation,
  writeAudit
} from "./store.js";

const variablesSchema = z.record(z.string(), z.unknown()).optional();
const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("interval"), everyMinutes: z.number().int().min(1).max(525_600) })
]);
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("log.message"), message: z.string().min(1).max(2_000) }),
  z.object({ type: z.literal("jobber.query"), query: z.string().min(1), variables: variablesSchema }),
  z.object({ type: z.literal("jobber.mutation"), mutation: z.string().min(1), variables: variablesSchema })
]);

const result = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: { result: value }
});

export function buildMcpServer(): McpServer {
  const server = new McpServer(
    { name: "Jobber Automation MCP", version: "0.2.0" },
    { instructions: "Use read tools first. Never call jobber_mutation without showing Gavin the exact proposed change and receiving his explicit approval." }
  );

  server.registerTool("jobber_account", {
    description: "Verify the connected Jobber account and return its ID and name.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  }, async () => result(await jobberGraphql("query Account { account { id name } }")));

  server.registerTool("jobber_clients", {
    description: "List Jobber clients with basic contact and property information.",
    inputSchema: z.object({ first: z.number().int().min(1).max(100).default(25), after: z.string().optional() }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  }, async ({ first, after }) => result(await jobberGraphql(
    `query Clients($first: Int!, $after: String) { clients(first: $first, after: $after) { nodes { id name firstName lastName companyName phoneNumbers { number } emails { address } clientProperties { nodes { id address { street city province postalCode } } } } pageInfo { hasNextPage endCursor } totalCount } }`,
    { first, after }
  )));

  server.registerTool("jobber_jobs", {
    description: "List recent Jobber jobs and their client, property, and schedule summary.",
    inputSchema: z.object({ first: z.number().int().min(1).max(100).default(25), after: z.string().optional() }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  }, async ({ first, after }) => result(await jobberGraphql(
    `query Jobs($first: Int!, $after: String) { jobs(first: $first, after: $after) { nodes { id jobNumber title jobStatus client { id name } property { id address { street city province postalCode } } visits { totalCount } } pageInfo { hasNextPage endCursor } totalCount } }`,
    { first, after }
  )));

  server.registerTool("jobber_query", {
    description: "Run one read-only GraphQL query against Jobber when a named tool does not expose the needed field.",
    inputSchema: z.object({ query: z.string().min(1), variables: z.record(z.string(), z.unknown()).default({}) }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  }, async ({ query, variables }) => {
    requireQuery(query);
    await writeAudit({ action: "query", query, variables });
    return result(await jobberGraphql(query, variables));
  });

  server.registerTool("jobber_mutation", {
    description: "Run one Jobber GraphQL mutation. Requires the exact confirmation phrase after the user reviews the change.",
    inputSchema: z.object({
      mutation: z.string().min(1),
      variables: z.record(z.string(), z.unknown()).default({}),
      confirmation: z.literal("I CONFIRM THIS JOBBER CHANGE")
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  }, async ({ mutation, variables, confirmation }) => {
    requireMutation(mutation, confirmation);
    await writeAudit({ action: "mutation_attempt", mutation, variables });
    const response = await jobberGraphql(mutation, variables);
    await writeAudit({ action: "mutation_success", mutation, variables });
    return result(response);
  });

  server.registerTool("automation_create", {
    description: "Create a new automation in draft state. Drafts cannot run until explicitly activated.",
    inputSchema: z.object({
      name: z.string().min(1).max(120),
      description: z.string().max(2_000).default(""),
      approvalPolicy: z.enum(["always", "preapproved"]).default("always"),
      trigger: triggerSchema,
      actions: z.array(actionSchema).min(1).max(25)
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async input => {
    for (const action of input.actions) {
      if (action.type === "jobber.query") requireQuery(action.query);
      if (action.type === "jobber.mutation") requireMutation(action.mutation, "I CONFIRM THIS JOBBER CHANGE");
    }
    const automation = createAutomation({ ...input, status: "draft" });
    await writeAudit({ action: "automation_created", automationId: automation.id, name: automation.name });
    return result({ automation, preview: previewAutomation(automation) });
  });

  server.registerTool("automation_list", {
    description: "List saved automations and their current status and next scheduled run.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  }, async () => result(listAutomations()));

  server.registerTool("automation_get", {
    description: "Get one automation definition and a plain-language preview.",
    inputSchema: z.object({ id: z.string().uuid() }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  }, async ({ id }) => {
    const automation = getAutomation(id);
    if (!automation) throw new Error("Automation not found.");
    return result({ automation, preview: previewAutomation(automation) });
  });

  server.registerTool("automation_update", {
    description: "Edit an automation definition. Updating it returns it to draft so the revised behavior must be reviewed and activated.",
    inputSchema: z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(120).optional(),
      description: z.string().max(2_000).optional(),
      approvalPolicy: z.enum(["always", "preapproved"]).optional(),
      trigger: triggerSchema.optional(),
      actions: z.array(actionSchema).min(1).max(25).optional()
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ id, ...patch }) => {
    if (patch.actions) for (const action of patch.actions) {
      if (action.type === "jobber.query") requireQuery(action.query);
      if (action.type === "jobber.mutation") requireMutation(action.mutation, "I CONFIRM THIS JOBBER CHANGE");
    }
    const automation = updateAutomation(id, { ...patch, status: "draft", nextRunAt: null });
    if (!automation) throw new Error("Automation not found.");
    await writeAudit({ action: "automation_updated", automationId: id });
    return result({ automation, preview: previewAutomation(automation) });
  });

  server.registerTool("automation_activate", {
    description: "Activate a reviewed automation. Required confirmation acknowledges its complete preview and approval policy.",
    inputSchema: z.object({ id: z.string().uuid(), confirmation: z.literal("I APPROVE THIS AUTOMATION") }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  }, async ({ id }) => {
    const current = getAutomation(id);
    if (!current) throw new Error("Automation not found.");
    const active = { ...current, status: "active" as const };
    const automation = updateAutomation(id, { status: "active", nextRunAt: nextRunAt(active) });
    await writeAudit({ action: "automation_activated", automationId: id });
    return result(automation);
  });

  server.registerTool("automation_pause", {
    description: "Pause an active automation so it cannot run automatically or manually.",
    inputSchema: z.object({ id: z.string().uuid() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ id }) => {
    const automation = updateAutomation(id, { status: "paused", nextRunAt: null });
    if (!automation) throw new Error("Automation not found.");
    await writeAudit({ action: "automation_paused", automationId: id });
    return result(automation);
  });

  server.registerTool("automation_preview", {
    description: "Preview an automation without contacting Jobber or performing any action.",
    inputSchema: z.object({ id: z.string().uuid() }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  }, async ({ id }) => result(await runAutomation(id, "preview")));

  server.registerTool("automation_run_now", {
    description: "Run an active automation now. Mutation automations with approvalPolicy=always require the exact confirmation phrase.",
    inputSchema: z.object({ id: z.string().uuid(), confirmation: z.string().optional() }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  }, async ({ id, confirmation }) => result(await runAutomation(id, "manual", confirmation)));

  server.registerTool("automation_history", {
    description: "List recent preview and execution records for an automation.",
    inputSchema: z.object({ id: z.string().uuid(), limit: z.number().int().min(1).max(100).default(25) }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  }, async ({ id, limit }) => {
    if (!getAutomation(id)) throw new Error("Automation not found.");
    return result(listAutomationRuns(id, limit));
  });

  server.registerTool("automation_delete", {
    description: "Permanently delete an automation and its run history after exact confirmation.",
    inputSchema: z.object({ id: z.string().uuid(), confirmation: z.string() }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  }, async ({ id, confirmation }) => {
    if (confirmation !== `DELETE AUTOMATION ${id}`) throw new Error(`Deletion blocked. Confirmation must be: DELETE AUTOMATION ${id}`);
    const deleted = deleteAutomation(id);
    if (!deleted) throw new Error("Automation not found.");
    await writeAudit({ action: "automation_deleted", automationId: id });
    return result({ deleted: true, id });
  });

  return server;
}
