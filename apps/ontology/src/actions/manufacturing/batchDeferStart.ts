import { db } from "../../db.ts";
import { HttpError } from "../../errors.ts";
import { toApiShape } from "../../instances.ts";
import type { Instance } from "../../instances.ts";
import { defineAction } from "../types.ts";
import type { ActionContext } from "../types.ts";

/**
 * The fields of Batch this handler reads, keyed the way the route hands them
 * over: property api_name, not datasource_column.
 */
type BatchInstance = Instance & {
  id: string;
  status: string;
  plannedStart: string | null;
};

type DeferStartParams = {
  newPlannedStart: string;
};

/**
 * Only a batch that has not started yet can be deferred. See
 * seeds/01-manufacturing-foundation.sql; nothing in the schema constrains the
 * column, so the seed's vocabulary is the only definition of the status set.
 */
const DEFERRABLE_STATUS = "queued";

async function deferStart(
  batch: BatchInstance,
  params: DeferStartParams,
  context: ActionContext,
): Promise<unknown> {
  // Shape is already settled by the route's JSON Schema check; what is left is
  // whether this particular batch may be deferred to this particular date.
  if (batch.status !== DEFERRABLE_STATUS) {
    throw new HttpError(
      409,
      `batch ${batch.id} is ${batch.status}, and only a ${DEFERRABLE_STATUS} batch can have its start deferred`,
    );
  }

  const newPlannedStart = new Date(params.newPlannedStart);
  const now = new Date();
  if (newPlannedStart.getTime() <= now.getTime()) {
    throw new HttpError(
      400,
      `newPlannedStart must be in the future, but ${newPlannedStart.toISOString()} is not after ${now.toISOString()}`,
    );
  }

  // The write and its audit row go together: an unrecorded change to a planned
  // start is exactly what the log exists to prevent.
  return await db.transaction().execute(async (trx) => {
    const updated = await trx
      .updateTable("manufacturing.batch")
      .set({ planned_start: newPlannedStart })
      .where("id", "=", batch.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    await trx
      .withSchema(context.metaSchema)
      .insertInto("audit_log")
      .values({
        // Dual snapshot: the ids link the row to live metadata, the api_names
        // survive a rename or a delete that would null those ids out.
        action_type_id: context.actionType.id,
        action_api_name: context.actionType.api_name,
        target_type_id: context.objectType.id,
        target_type_api_name: context.objectType.api_name,
        target_id: batch.id,
        actor: context.actor,
        params: { newPlannedStart: params.newPlannedStart },
        result: {
          previousPlannedStart: batch.plannedStart,
          plannedStart: updated.planned_start,
        },
      })
      .execute();

    return toApiShape(updated, context.properties);
  });
}

export const batchDeferStart = defineAction(deferStart);
