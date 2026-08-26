import { requireMutation, requireQuery } from "./graphql-safety.js";
import { jobberGraphql } from "./jobber.js";
import {
  createAutomationRun,
  finishAutomationRun,
  getAutomation,
  listDueAutomations,
  updateAutomation,
  writeAudit,
  type Automation,
  type AutomationAction,
  type AutomationRun
} from "./store.js";

export function nextRunAt(automation: Pick<Automation, "trigger" | "status">, from = Date.now()): number | null {
  if (automation.status !== "active" || automation.trigger.type === "manual") return null;
  return from + automation.trigger.everyMinutes * 60_000;
}

export function previewAutomation(automation: Automation) {
  return {
    automationId: automation.id,
    name: automation.name,
    status: automation.status,
    approvalPolicy: automation.approvalPolicy,
    trigger: automation.trigger,
    nextRunAt: automation.nextRunAt,
    actions: automation.actions.map((action, index) => ({
      step: index + 1,
      type: action.type,
      effect: describeAction(action),
      changesJobber: action.type === "jobber.mutation"
    })),
    warnings: [
      ...(automation.actions.some(action => action.type === "jobber.mutation") ? ["This automation can change Jobber data."] : []),
      ...(automation.approvalPolicy === "always" ? ["Scheduled mutations will be blocked until the approval policy is changed to preapproved."] : [])
    ]
  };
}

function describeAction(action: AutomationAction): string {
  if (action.type === "log.message") return `Record a log message: ${action.message}`;
  if (action.type === "jobber.query") return "Run a read-only Jobber GraphQL query.";
  return "Run a Jobber GraphQL mutation.";
}

export async function runAutomation(
  automationId: string,
  source: AutomationRun["source"],
  confirmation?: string
): Promise<{ runId: string; status: AutomationRun["status"]; output: unknown }> {
  const automation = getAutomation(automationId);
  if (!automation) throw new Error("Automation not found.");
  if (source !== "preview" && automation.status !== "active") throw new Error("Only active automations can run.");

  const run = createAutomationRun(automation.id, source);
  if (source === "preview") {
    const output = previewAutomation(automation);
    finishAutomationRun(run.id, "previewed", output, null);
    return { runId: run.id, status: "previewed", output };
  }

  const hasMutation = automation.actions.some(action => action.type === "jobber.mutation");
  const approved = automation.approvalPolicy === "preapproved" || confirmation === "I CONFIRM THIS AUTOMATION RUN";
  if (hasMutation && !approved) {
    const output = { blocked: true, reason: "This run contains a Jobber mutation and needs approval." };
    finishAutomationRun(run.id, "blocked", output, null);
    return { runId: run.id, status: "blocked", output };
  }

  try {
    const steps: unknown[] = [];
    for (const [index, action] of automation.actions.entries()) {
      if (action.type === "log.message") {
        await writeAudit({ action: "automation_log", automationId, runId: run.id, message: action.message });
        steps.push({ step: index + 1, type: action.type, message: action.message });
      } else if (action.type === "jobber.query") {
        requireQuery(action.query);
        const response = await jobberGraphql(action.query, action.variables ?? {});
        steps.push({ step: index + 1, type: action.type, response });
      } else {
        requireMutation(action.mutation, "I CONFIRM THIS JOBBER CHANGE");
        await writeAudit({ action: "automation_mutation_attempt", automationId, runId: run.id, mutation: action.mutation, variables: action.variables ?? {} });
        const response = await jobberGraphql(action.mutation, action.variables ?? {});
        steps.push({ step: index + 1, type: action.type, response });
      }
    }
    const output = { steps };
    finishAutomationRun(run.id, "succeeded", output, null);
    await writeAudit({ action: "automation_run_succeeded", automationId, runId: run.id, source });
    return { runId: run.id, status: "succeeded", output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishAutomationRun(run.id, "failed", null, message);
    await writeAudit({ action: "automation_run_failed", automationId, runId: run.id, source, error: message });
    throw error;
  }
}

let workerTimer: NodeJS.Timeout | undefined;
let workerBusy = false;

export function startAutomationWorker(pollSeconds: number): void {
  if (workerTimer) return;
  const tick = async () => {
    if (workerBusy) return;
    workerBusy = true;
    try {
      for (const automation of listDueAutomations()) {
        updateAutomation(automation.id, { nextRunAt: nextRunAt(automation) });
        try {
          await runAutomation(automation.id, "scheduler");
        } catch (error) {
          console.error(`Automation ${automation.id} failed:`, error);
        }
      }
    } finally {
      workerBusy = false;
    }
  };
  workerTimer = setInterval(() => void tick(), pollSeconds * 1000);
  workerTimer.unref();
  void tick();
}

export function stopAutomationWorker(): void {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = undefined;
}
