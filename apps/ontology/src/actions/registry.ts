import { batchDeferStart } from "./manufacturing/batchDeferStart.ts";
import type { RegisteredAction } from "./types.ts";

/**
 * Handlers keyed by `${objectTypeApiName}.${actionApiName}`.
 *
 * An action_type row says an action exists and what it accepts; this map says
 * what actually runs it. A row with no entry here is a 501, not a 404 -- the
 * ontology declares it, the server just has not implemented it yet.
 */
export const actionHandlers: Record<string, RegisteredAction> = {
  "batch.deferStart": batchDeferStart,
};

export function findActionHandler(
  objectTypeApiName: string,
  actionApiName: string,
): RegisteredAction | undefined {
  return actionHandlers[`${objectTypeApiName}.${actionApiName}`];
}
