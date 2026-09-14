import { sql } from "kysely";
import type { RawBuilder } from "kysely";
import { db } from "./db.ts";
import { columnRef, instanceTable, selectColumns } from "./metadata.ts";
import type { ObjectTypeRow, PropertyRow } from "./metadata.ts";

/** An instance row, keyed by property api_name. */
export type Instance = Record<string, unknown>;

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 1000;

/**
 * Reads instances of one type.
 *
 * Table and column names come from metadata rows and are escaped on the way in
 * (see metadata.ts); every value is a bound parameter, so nothing a caller
 * sends is ever concatenated into SQL.
 */
export async function selectInstances(
  objectType: ObjectTypeRow,
  properties: readonly PropertyRow[],
  options: {
    conditions?: readonly RawBuilder<unknown>[];
    orderBy?: PropertyRow;
    limit?: number;
    offset?: number;
  } = {},
): Promise<Instance[]> {
  const conditions = options.conditions ?? [];
  const where = conditions.length > 0 ? sql.join(conditions, sql` and `) : sql`true`;
  const orderBy = options.orderBy === undefined ? sql`1` : columnRef(options.orderBy);
  const limit = options.limit ?? DEFAULT_LIMIT;
  const offset = options.offset ?? 0;

  const { rows } = await sql<Instance>`
    select ${selectColumns(properties)}
    from ${instanceTable(objectType)}
    where ${where}
    order by ${orderBy}
    limit ${limit} offset ${offset}
  `.execute(db);

  return rows;
}

/**
 * Re-keys a raw row by property api_name.
 *
 * A write returning `returningAll()` comes back in the table's own snake_case,
 * so this puts it in the same shape the read routes hand out.
 */
export function toApiShape(
  row: Record<string, unknown>,
  properties: readonly PropertyRow[],
): Instance {
  const instance: Instance = {};
  for (const property of properties) {
    instance[property.api_name] = row[property.datasource_column];
  }
  return instance;
}
