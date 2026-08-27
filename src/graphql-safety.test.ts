import { describe, expect, it } from "vitest";
import { operationType, requireMutation, requireQuery } from "./graphql-safety.js";

describe("GraphQL safety", () => {
  it("identifies queries and mutations", () => {
    expect(operationType("query { account { id } }")).toBe("query");
    expect(operationType("mutation { appDisconnect { userErrors { message } } }")).toBe("mutation");
  });
  it("blocks mutations in read tool", () => {
    expect(() => requireQuery("mutation { appDisconnect { userErrors { message } } }")).toThrow();
  });
  it("accepts approved natural mutation confirmations", () => {
    expect(() => requireMutation("mutation { appDisconnect { userErrors { message } } }", "yes")).not.toThrow();
    expect(() => requireMutation("mutation { appDisconnect { userErrors { message } } }", "Do it")).not.toThrow();
    expect(() => requireMutation("mutation { appDisconnect { userErrors { message } } }", "I CONFIRM THIS JOBBER CHANGE")).not.toThrow();
  });
  it("rejects non-confirmation text", () => {
    expect(() => requireMutation("mutation { appDisconnect { userErrors { message } } }", "maybe later")).toThrow();
  });
});
