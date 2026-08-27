import { Kind, parse, type OperationDefinitionNode } from "graphql";

export function operationType(source: string): "query" | "mutation" | "subscription" {
  const document = parse(source);
  const operations = document.definitions.filter(
    (node): node is OperationDefinitionNode => node.kind === Kind.OPERATION_DEFINITION
  );
  if (operations.length !== 1) throw new Error("Exactly one GraphQL operation is required.");
  return operations[0].operation;
}

export function requireQuery(source: string): void {
  if (operationType(source) !== "query") throw new Error("This tool accepts queries only.");
}

export function requireMutation(source: string, confirmation: string): void {
  if (operationType(source) !== "mutation") throw new Error("This tool accepts mutations only.");

  const normalized = confirmation.trim().toLowerCase();

  const acceptedConfirmations = new Set([
    "i confirm this jobber change",
    "i confirm",
    "confirmed",
    "yes",
    "yes, do it",
    "do it",
    "approved",
    "i approve"
  ]);

  if (!acceptedConfirmations.has(normalized)) {
    throw new Error("Mutation blocked: explicit confirmation was not supplied.");
  }
}
