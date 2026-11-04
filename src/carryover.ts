import { requireMutation, requireQuery } from "./graphql-safety.js";

export type MowingCarryoverAction = {
  type: "jobber.carryoverMowing";
  clientId: string;
  requiredAssigneeIds: string[];
  excludedJobNumbers: number[];
  timeZone: string;
  maxMoves: number;
};

export type GraphqlExecutor = (query: string, variables?: Record<string, unknown>) => Promise<unknown>;
export type AuditWriter = (event: Record<string, unknown>) => Promise<void>;

type Visit = {
  id: string;
  startAt: string;
  isComplete: boolean;
  assignedUsers: { nodes: { id: string }[] };
  job: { id: string; jobNumber: number; title: string | null; client: { id: string; name: string } } | null;
};
type VisitConnection = { nodes: Visit[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
type JobDetail = {
  id: string;
  notes: { nodes: { __typename: string; createdAt?: string; message?: string }[]; pageInfo: { hasNextPage: boolean } };
  visits: { nodes: { startAt: string; isComplete: boolean }[]; pageInfo: { hasNextPage: boolean } };
};
type PlannedMove = { visitId: string; jobNumber: number; scheduledFor: string };
type SkippedVisit = { visitId: string; jobNumber: number; reason: string };
export type CarryoverPlan = {
  clientId: string;
  fromDate: string;
  toDate: string;
  moves: PlannedMove[];
  skipped: SkippedVisit[];
};

const MS_DAY = 86_400_000;
function queryVisits(after: string, before: string): string {
  return [
    "query CarryoverVisits($cursor: String) {",
    ' visits(first: 100, after: $cursor, filter: {startAt: {after: "' + after + '", before: "' + before + '"}}) {',
    "  nodes { id startAt isComplete assignedUsers(first: 10) { nodes { id } }",
    "   job { id jobNumber title client { id name } } }",
    "  pageInfo { hasNextPage endCursor }",
    " }",
    "}"
  ].join("\n");
}
const QUERY_JOB = [
  "query CarryoverJob($id: EncodedId!) {",
  " job(id: $id) { id",
  "  notes(first: 100) { nodes { __typename ... on JobNote { createdAt message } } pageInfo { hasNextPage } }",
  "  visits(first: 100) { nodes { startAt isComplete } pageInfo { hasNextPage } }",
  " }",
  "}"
].join("\n");
const QUERY_RECHECK = [
  "query CarryoverRecheck($ids: [EncodedId!]!) {",
  " visits(first: 1, filter: {ids: $ids}) {",
  "  nodes { id startAt isComplete assignedUsers(first: 10) { nodes { id } }",
  "   job { id jobNumber title client { id name } } }",
  " }",
  "}"
].join("\n");

function responseData<T>(raw: unknown, field: string): T {
  const data = (raw as { data?: Record<string, unknown> })?.data;
  if (!data || data[field] === undefined || data[field] === null) {
    throw new Error("Jobber response is missing " + field + "; no changes made.");
  }
  return data[field] as T;
}

function zonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute)
  };
}

function dayKey({ year, month, day }: { year: number; month: number; day: number }): string {
  return [String(year).padStart(4, "0"), String(month).padStart(2, "0"), String(day).padStart(2, "0")].join("-");
}

export function localDate(instant: string | number | Date, timeZone: string): string {
  return dayKey(zonedParts(new Date(instant), timeZone));
}

export function addLocalDays(date: string, days: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + days * MS_DAY).toISOString().slice(0, 10);
}

// Resolve a wall-clock time to UTC (including DST changes). A fall-back repeated
// time uses the first occurrence, preventing two runs on the same local date.
function wallClockUtc(date: string, time: string, timeZone: string): number | null {
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.parse(date + "T" + time + ":00Z");
  let guess = target;
  for (let i = 0; i < 5; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const observed = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const difference = target - observed;
    guess += difference;
    if (difference === 0) break;
  }
  const matches = [guess - 3_600_000, guess, guess + 3_600_000]
    .filter(instant => {
      const p = zonedParts(new Date(instant), timeZone);
      return dayKey(p) === date && p.hour === hour && p.minute === minute;
    });
  return matches.length ? Math.min(...matches) : null;
}

export function nextDailyRunAt(time: string, timeZone: string, from = Date.now()): number {
  const start = localDate(from, timeZone);
  for (let offset = 0; offset < 4; offset++) {
    const candidate = wallClockUtc(addLocalDays(start, offset), time, timeZone);
    if (candidate !== null && candidate > from) return candidate;
  }
  throw new Error("Unable to resolve the next daily automation time.");
}

function hasExactlyAssignedCrew(visit: Visit, requiredIds: string[]): boolean {
  const actual = visit.assignedUsers?.nodes.map(user => user.id) ?? [];
  return actual.length === requiredIds.length &&
    new Set(actual).size === actual.length &&
    requiredIds.every(id => actual.includes(id));
}

function isMowing(visit: Visit): boolean {
  return Boolean(visit.job && /\bmow(?:ing)?\b/i.test(visit.job.title ?? ""));
}

const PERMANENT_BLOCK = /(?:do\s*not\s*mow|(?:don'?t|doesn'?t|didn'?t)\s+(?:want\s+(?:us\s+)?(?:to\s+)?)?mow(?:ing)?|(?:doesn'?t|didn'?t|don'?t)\s+want\s+(?:us\s+)?(?:to\s+)?mow(?:ing)?|stop\s+mowing|no\s+longer\s+(?:mow|service)|not\s+to\s+mow)/i;
const TEMPORARY_BLOCK = /(?:construct(?:ion|ing)|roofing|roof\s+work|workers?\s+(?:outside|working)|work\s+trucks?|dogs?\s+(?:out|in\s+(?:the\s+)?yard)|locked?\s+gate|lock\s+on\s+(?:the\s+)?gate|can'?t\s+(?:get\s+(?:in|to)|access|mow)|cannot\s+(?:access|mow)|too\s+much\s+(?:stuff|debris)|too\s+tall|too\s+small\s+of\s+entrance|fence\s+(?:up|installed)|kids?\s+(?:out|outside)|someone\s+already\s+mows|already\s+mowed|says\s+he\s+mows)/i;

function safetyBlock(job: JobDetail, action: MowingCarryoverAction, today: string): string | null {
  // Fail closed if history was truncated: recent notes or later completed work
  // could be hidden in the missing pages.
  if (job.notes.pageInfo.hasNextPage || job.visits.pageInfo.hasNextPage) {
    return "Job notes or visit history exceed the review limit";
  }
  const completedDays = job.visits.nodes
    .filter(visit => visit.isComplete)
    .map(visit => localDate(visit.startAt, action.timeZone));
  const latestCompletedDay = completedDays.sort().at(-1) ?? "";
  for (const note of job.notes.nodes) {
    if (!note.message || !note.createdAt) continue;
    const noteDay = localDate(note.createdAt, action.timeZone);
    if (noteDay > today) continue;
    if (PERMANENT_BLOCK.test(note.message)) return "Do-not-mow instruction in job notes";
    if (TEMPORARY_BLOCK.test(note.message) && noteDay >= latestCompletedDay) {
      return "Unresolved access or worksite issue in job notes";
    }
  }
  return null;
}

async function fetchVisits(now: Date, action: MowingCarryoverAction, graphql: GraphqlExecutor): Promise<Visit[]> {
  const today = localDate(now, action.timeZone);
  // Query a wider UTC window, then select by local date to survive DST.
  const after = new Date(Date.parse(addLocalDays(today, -2) + "T00:00:00Z")).toISOString();
  const before = new Date(Date.parse(addLocalDays(today, 5) + "T00:00:00Z")).toISOString();
  const all: Visit[] = [];
  let cursor: string | null = null;
  const query = queryVisits(after, before);
  requireQuery(query);
  for (let page = 0; page < 20; page++) {
    const connection: VisitConnection = responseData<VisitConnection>(
      await graphql(query, { cursor }), "visits"
    );
    all.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) return all;
    if (!connection.pageInfo.endCursor) throw new Error("Jobber visit pagination did not return a cursor.");
    cursor = connection.pageInfo.endCursor;
  }
  throw new Error("Jobber has too many visits to check safely; no changes made.");
}

export async function planMowingCarryover(
  action: MowingCarryoverAction,
  graphql: GraphqlExecutor,
  now = new Date()
): Promise<CarryoverPlan> {
  if (!action.clientId || !action.requiredAssigneeIds.length ||
      new Set(action.requiredAssigneeIds).size !== action.requiredAssigneeIds.length ||
      action.maxMoves < 1 || action.maxMoves > 25 ||
      !action.requiredAssigneeIds.every(id => /^[A-Za-z0-9+/=]+$/.test(id))) {
    throw new Error("Carryover configuration is invalid.");
  }
  const today = localDate(now, action.timeZone);
  const tomorrow = addLocalDays(today, 1);
  const visits = await fetchVisits(now, action, graphql);
  const candidates = visits.filter(visit =>
    !visit.isComplete && localDate(visit.startAt, action.timeZone) === today &&
    visit.job?.client?.id === action.clientId && isMowing(visit) &&
    hasExactlyAssignedCrew(visit, action.requiredAssigneeIds)
  ).sort((a, b) => a.id.localeCompare(b.id));
  if (candidates.length > action.maxMoves) {
    throw new Error("Found " + candidates.length + " visits, exceeding the approved limit of " + action.maxMoves + "; none moved.");
  }

  const plan: CarryoverPlan = { clientId: action.clientId, fromDate: today, toDate: tomorrow, moves: [], skipped: [] };
  const details = new Map<string, JobDetail>();
  requireQuery(QUERY_JOB);
  for (const visit of candidates) {
    const job = visit.job!;
    const skip = (reason: string) => plan.skipped.push({ visitId: visit.id, jobNumber: job.jobNumber, reason });
    if (action.excludedJobNumbers.includes(job.jobNumber)) {
      skip("Excluded property or job"); continue;
    }
    if (visits.some(other => other.id !== visit.id && other.job?.id === job.id &&
      localDate(other.startAt, action.timeZone) >= today &&
      localDate(other.startAt, action.timeZone) <= addLocalDays(today, 2))) {
      skip("Another visit for this job is already scheduled"); continue;
    }
    let detail = details.get(job.id);
    if (!detail) {
      detail = responseData<JobDetail>(await graphql(QUERY_JOB, { id: job.id }), "job");
      details.set(job.id, detail);
    }
    const blocked = safetyBlock(detail, action, today);
    if (blocked) {
      skip(blocked); continue;
    }
    plan.moves.push({ visitId: visit.id, jobNumber: job.jobNumber, scheduledFor: tomorrow });
  }
  return plan;
}

export async function executeMowingCarryover(
  action: MowingCarryoverAction,
  graphql: GraphqlExecutor,
  audit: AuditWriter,
  automationId: string,
  runId: string,
  now = new Date()
): Promise<{ plan: CarryoverPlan; moved: string[]; recheckSkipped: string[] }> {
  const plan = await planMowingCarryover(action, graphql, now);
  const moved: string[] = [];
  const recheckSkipped: string[] = [];
  requireQuery(QUERY_RECHECK);
  for (const item of plan.moves) {
    // Recheck just before writing, in case an employee completed the visit.
    const latest = responseData<{ nodes: Visit[] }>(
      await graphql(QUERY_RECHECK, { ids: [item.visitId] }), "visits"
    ).nodes[0];
    if (!latest || latest.isComplete ||
        localDate(latest.startAt, action.timeZone) !== plan.fromDate ||
        latest.job?.client?.id !== action.clientId || !isMowing(latest) ||
        !hasExactlyAssignedCrew(latest, action.requiredAssigneeIds)) {
      recheckSkipped.push(item.visitId); continue;
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(item.visitId)) throw new Error("Invalid visit ID from Jobber.");
    const mutation = [
      "mutation CarryoverMove { visitEditSchedule(",
      'id: "' + item.visitId + '", ',
      'input: { startAt: { date: "' + plan.toDate + '", timezone: "' + action.timeZone + '" }, ',
      'endAt: { date: "' + plan.toDate + '", timezone: "' + action.timeZone + '" } }) {',
      "userErrors { message path } visit { id startAt endAt } } }"
    ].join("");
    requireMutation(mutation, "I CONFIRM THIS JOBBER CHANGE");
    await audit({ action: "carryover_move_attempt", automationId, runId, visitId: item.visitId, toDate: plan.toDate });
    const result = responseData<{
      userErrors: { message: string }[];
      visit: { id: string; startAt: string; endAt: string } | null;
    }>(await graphql(mutation), "visitEditSchedule");
    if (result.userErrors.length || result.visit?.id !== item.visitId ||
        localDate(result.visit.startAt, action.timeZone) !== plan.toDate) {
      throw new Error("Jobber did not confirm the carryover of visit " + item.visitId + ".");
    }
    moved.push(item.visitId);
    await audit({ action: "carryover_move_succeeded", automationId, runId, visitId: item.visitId, toDate: plan.toDate });
  }
  return { plan, moved, recheckSkipped };
}
