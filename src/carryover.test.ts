import { describe, expect, it } from "vitest";
import {
  addLocalDays,
  nextDailyRunAt,
  planMowingCarryover,
  executeMowingCarryover,
  type GraphqlExecutor,
  type MowingCarryoverAction
} from "./carryover.js";

const timeZone = "America/Indiana/Indianapolis";
const crew = ["VXNlcjE=", "VXNlcjI=", "VXNlcjM="];
const clientId = "Q2xpZW50";
const action: MowingCarryoverAction = {
  type: "jobber.carryoverMowing", clientId,
  requiredAssigneeIds: crew, excludedJobNumbers: [227],
  timeZone, maxMoves: 15
};
const now = new Date("2026-11-05T03:30:00Z"); // Nov 4, 10:30pm EST

function visit(id: string, jobNumber: number, date = "2026-11-04T05:00:00Z", changes: Record<string, unknown> = {}) {
  return {
    id, startAt: date, endAt: new Date(Date.parse(date) + 86_399_000).toISOString(), isComplete: false,
    assignedUsers: { nodes: crew.map(id => ({ id })) },
    job: { id: "Sm9i" + jobNumber, jobNumber, title: "Mowing", client: { id: clientId, name: "Kyle Tom" } },
    ...changes
  };
}

function job(id: string, noteText?: string, completion?: string) {
  return {
    id, notes: { nodes: noteText ? [{ __typename: "JobNote", createdAt: "2026-11-04T18:00:00Z", message: noteText }] : [], pageInfo: { hasNextPage: false } },
    visits: { nodes: completion ? [{ startAt: completion, isComplete: true }] : [], pageInfo: { hasNextPage: false } }
  };
}

function fakeGraphql(visits: ReturnType<typeof visit>[], details = new Map<string, ReturnType<typeof job>>()) {
  let writes = 0;
  const graphql: GraphqlExecutor = async (query, variables = {}) => {
    if (query.includes("CarryoverVisits")) return {
      data: { visits: { nodes: visits, pageInfo: { hasNextPage: false, endCursor: null } } }
    };
    if (query.includes("CarryoverJob")) {
      const id = variables.id as string;
      return { data: { job: details.get(id) ?? job(id) } };
    }
    if (query.includes("CarryoverRecheck")) {
      return { data: { visits: { nodes: visits.filter(v => v.id === (variables.ids as string[])[0]) } } };
    }
    if (query.includes("CarryoverMove")) {
      writes++;
      const id = /id: "([^"]+)"/.exec(query)?.[1];
      const v = visits.find(v => v.id === id);
      if (!v) throw new Error("Missing visit");
      v.startAt = "2026-11-05T05:00:00Z";
      v.endAt = "2026-11-06T04:59:59Z";
      return { data: { visitEditSchedule: { userErrors: [], visit: { id, startAt: v.startAt, endAt: v.startAt } } } };
    }
    throw new Error("Unexpected GraphQL operation");
  };
  return { graphql, getWrites: () => writes };
}

describe("nightly local scheduling", () => {
  it("schedules 10:30pm in Indiana and preserves the local hour across DST", () => {
    expect(new Date(nextDailyRunAt("22:30", timeZone, Date.parse("2026-10-31T22:00:00Z"))).toISOString())
      .toBe("2026-11-01T02:30:00.000Z");
    expect(new Date(nextDailyRunAt("22:30", timeZone, Date.parse("2026-11-01T02:31:00Z"))).toISOString())
      .toBe("2026-11-02T03:30:00.000Z");
    expect(new Date(nextDailyRunAt("22:30", timeZone, Date.parse("2026-11-05T03:31:00Z"))).toISOString())
      .toBe("2026-11-06T03:30:00.000Z");
    expect(addLocalDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});

describe("Kyle mowing carryover", () => {
  it("limits the plan to incomplete mowing visits for the exact client and crew", async () => {
    const visits = [
      visit("dmlzaXQx", 206),
      visit("dmlzaXQy", 207, "2026-11-04T05:00:00Z", { isComplete: true }),
      visit("dmlzaXQz", 208, "2026-11-04T05:00:00Z", { assignedUsers: { nodes: [{ id: crew[0] }] } }),
      visit("dmlzaXQ0", 209, "2026-11-04T05:00:00Z", { job: { id: "Sm9i209", jobNumber: 209, title: "Landscaping", client: { id: clientId, name: "Kyle Tom" } } }),
      visit("dmlzaXQ1", 210, "2026-11-04T05:00:00Z", { job: { id: "Sm9i210", jobNumber: 210, title: "Mowing", client: { id: "OTHER", name: "Other" } } }),
      visit("dmlzaXQ2", 211, "2026-11-05T05:00:00Z")
    ];
    const { graphql } = fakeGraphql(visits);
    const result = await planMowingCarryover(action, graphql, now);
    expect(result.moves.map(v => v.jobNumber)).toEqual([206]);
    expect(result.toDate).toBe("2026-11-05");
  });

  it("skips excluded, duplicate, unresolved and permanent do-not-mow properties", async () => {
    const visits = [
      visit("dmlzaXQx", 227),
      visit("dmlzaXQy", 206),
      visit("dmlzaXQz", 206, "2026-11-05T05:00:00Z"),
      visit("dmlzaXQ0", 243),
      visit("dmlzaXQ1", 240),
      visit("dmlzaXQ2", 241)
    ];
    const details = new Map([
      ["Sm9i243", job("Sm9i243", "Still doing roofing")],
      ["Sm9i240", job("Sm9i240", "This was house he said he didn't want us mowing")],
      ["Sm9i241", job("Sm9i241", "Gate is locked, can't get in")]
    ]);
    const { graphql } = fakeGraphql(visits, details);
    const result = await planMowingCarryover(action, graphql, now);
    expect(result.moves).toHaveLength(0);
    expect(result.skipped).toHaveLength(5);
    expect(result.skipped.map(v => v.reason)).toContain("Do-not-mow instruction in job notes");
  });

  it("skips timed appointments instead of replacing their time window", async () => {
    const v = visit("dmlzaXQx", 206, "2026-11-04T15:00:00Z", { endAt: "2026-11-04T16:00:00Z" });
    const { graphql } = fakeGraphql([v]);
    const plan = await planMowingCarryover(action, graphql, now);
    expect(plan.moves).toHaveLength(0);
    expect(plan.skipped[0].reason).toMatch(/all-day/);
  });

  it("does not carry over a temporarily blocked job without a later completed visit", async () => {
    const v = visit("dmlzaXQx", 234);
    const details = new Map([["Sm9i234", job("Sm9i234", "Dogs out in yard", "2026-11-03T05:00:00Z")]]);
    const { graphql } = fakeGraphql([v], details);
    const result = await planMowingCarryover(action, graphql, now);
    expect(result.skipped).toHaveLength(1);
  });

  it("rechecks completion before mutation and never moves an already completed visit", async () => {
    const v = visit("dmlzaXQx", 206);
    const { graphql, getWrites } = fakeGraphql([v]);
    const events: Record<string, unknown>[] = [];
    const guarded: GraphqlExecutor = async (query, variables) => {
      if (query.includes("CarryoverRecheck")) v.isComplete = true;
      return graphql(query, variables);
    };
    const result = await executeMowingCarryover(action, guarded, async event => { events.push(event); }, "automation", "run", now);
    expect(result.moved).toHaveLength(0);
    expect(result.recheckSkipped).toHaveLength(1);
    expect(getWrites()).toBe(0);
    expect(events).toHaveLength(0);
  });

  it("moves eligible visits once, then is idempotent", async () => {
    const v = visit("dmlzaXQx", 206);
    const { graphql, getWrites } = fakeGraphql([v]);
    const events: Record<string, unknown>[] = [];
    const audit = async (event: Record<string, unknown>) => { events.push(event); };
    const first = await executeMowingCarryover(action, graphql, audit, "automation", "run", now);
    expect(first.moved).toEqual(["dmlzaXQx"]);
    expect(getWrites()).toBe(1);
    expect(events.map(e => e.action)).toEqual(["carryover_move_attempt", "carryover_move_succeeded"]);
    const second = await executeMowingCarryover(action, graphql, audit, "automation", "run2", now);
    expect(second.moved).toEqual([]);
    expect(getWrites()).toBe(1);
  });

  it("aborts before any writes if the approved move cap is exceeded", async () => {
    const lots = Array.from({ length: 3 }, (_, i) => visit("dmlzaXQ" + i, i + 300));
    const { graphql, getWrites } = fakeGraphql(lots);
    await expect(executeMowingCarryover({ ...action, maxMoves: 2 }, graphql, async () => {}, "automation", "run", now))
      .rejects.toThrow(/exceeding the approved limit/);
    expect(getWrites()).toBe(0);
  });
});
