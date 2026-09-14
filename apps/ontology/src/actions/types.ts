import type { InstanceSchema } from "../db.ts";
import type { Instance } from "../instances.ts";
import type { ActionTypeRow, ObjectTypeRow, PropertyRow } from "../metadata.ts";

/** Action parameters, already validated against the action's parameter_schema. */
export type ActionParams = Record<string, unknown>;

/** Everything a handler needs beyond the instance and its parameters. */
export type ActionContext = {
  /** Schema whose metadata tables describe this type, and where audit_log lives. */
  metaSchema: InstanceSchema;
  objectType: ObjectTypeRow;
  actionType: ActionTypeRow;
  /** Properties of objectType, for re-keying a written row by api_name. */
  properties: readonly PropertyRow[];
  /** Who invoked it; recorded on the audit row. */
  actor: string;
};

/**
 * A handler as its implementation writes it: concrete instance and parameter
 * types, so the business logic reads real fields rather than unknowns.
 */
export type ActionHandler<TInstance extends Instance, TParams extends ActionParams> = (
  instance: TInstance,
  params: TParams,
  context: ActionContext,
) => Promise<unknown>;

/** A handler as the registry stores it, where those types are not yet known. */
export type RegisteredAction = ActionHandler<Instance, ActionParams>;

/**
 * Registers a typed handler.
 *
 * The route guarantees both shapes before it dispatches: the instance was
 * selected from this type's own property rows, and the parameters passed
 * cfworker validation against parameter_schema. Neither guarantee is
 * expressible in RegisteredAction's type, so the narrowing happens once here
 * rather than being re-asserted inside every handler.
 */
export function defineAction<TInstance extends Instance, TParams extends ActionParams>(
  handler: ActionHandler<TInstance, TParams>,
): RegisteredAction {
  return handler as RegisteredAction;
}
