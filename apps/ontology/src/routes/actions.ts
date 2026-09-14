import { Validator } from "@cfworker/json-schema";
import type { Schema } from "@cfworker/json-schema";
import { Hono } from "hono";
import { sql } from "kysely";
import { findActionHandler } from "../actions/registry.ts";
import type { ActionContext, ActionParams } from "../actions/types.ts";
import { HttpError } from "../errors.ts";
import { selectInstances } from "../instances.ts";
import { columnRef, findActionType, loadProperties, primaryKeyProperty, requireObjectType } from "../metadata.ts";

export const actionRoutes = new Hono();

/**
 * parameter_schema rows carry no $schema, so the draft is set here. See
 * sql/01-manufacturing-foundation.sql.
 */
const SCHEMA_DRAFT = "2020-12";

/**
 * Until there is authentication, actions are attributed to whoever claims the
 * header. The audit row needs a value, and an obviously provisional one beats
 * silently recording every write as the same anonymous actor.
 */
const ACTOR_HEADER = "x-actor";
const DEFAULT_ACTOR = "anonymous";

/** An absent or empty body means "no parameters", not a malformed request. */
async function readParams(raw: string): Promise<ActionParams> {
  if (raw.trim() === "") {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new HttpError(400, `request body is not valid JSON: ${(error as Error).message}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "request body must be a JSON object");
  }
  return parsed as ActionParams;
}

actionRoutes.post("/:type/:id/actions/:actionName", async (c) => {
  const lookup = await requireObjectType(c.req.param("type"));
  const { metaSchema, objectType } = lookup;
  const id = c.req.param("id");
  const actionName = c.req.param("actionName");

  const properties = await loadProperties(metaSchema, objectType.id);
  const key = primaryKeyProperty(objectType, properties);

  const [instance] = await selectInstances(objectType, properties, {
    conditions: [sql`${columnRef(key)} = ${id}`],
    limit: 1,
  });
  if (instance === undefined) {
    throw new HttpError(404, `no ${objectType.api_name} with ${key.api_name} ${JSON.stringify(id)}`);
  }

  const actionType = await findActionType(metaSchema, objectType.id, actionName);
  if (actionType === undefined) {
    throw new HttpError(404, `${objectType.api_name} has no action ${actionName}`);
  }

  // Shape first: the handler should never see parameters the ontology does not
  // describe, so this runs before dispatch and reports every failure at once.
  const params = await readParams(await c.req.text());
  const result = new Validator(
    actionType.parameter_schema as Schema,
    SCHEMA_DRAFT,
    false,
  ).validate(params);

  if (!result.valid) {
    throw new HttpError(
      400,
      `parameters do not match the schema for ${objectType.api_name}.${actionType.api_name}`,
      result.errors.map((e) => ({
        keyword: e.keyword,
        instanceLocation: e.instanceLocation,
        error: e.error,
      })),
    );
  }

  const handler = findActionHandler(objectType.api_name, actionType.api_name);
  if (handler === undefined) {
    throw new HttpError(
      501,
      `${objectType.api_name}.${actionType.api_name} is declared in the ontology but has no handler`,
    );
  }

  const context: ActionContext = {
    metaSchema,
    objectType,
    actionType,
    properties,
    actor: c.req.header(ACTOR_HEADER) ?? DEFAULT_ACTOR,
  };

  return c.json({
    type: objectType.api_name,
    id: instance[key.api_name],
    action: actionType.api_name,
    result: await handler(instance, params, context),
  });
});
