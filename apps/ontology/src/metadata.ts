import { sql } from "kysely";
import type { RawBuilder, Selectable } from "kysely";
import { db, INSTANCE_SCHEMAS, isInstanceSchema } from "./db.ts";
import type {
  ActionTypeTable,
  Cardinality,
  InstanceSchema,
  LinkTable,
  ObjectTypeTable,
  PropertyTable,
} from "./db.ts";
import { HttpError } from "./errors.ts";

export type ObjectTypeRow = Selectable<ObjectTypeTable>;
export type PropertyRow = Selectable<PropertyTable>;
export type LinkRow = Selectable<LinkTable>;
export type ActionTypeRow = Selectable<ActionTypeTable>;

/** An object type together with the schema whose metadata tables describe it. */
export type TypeLookup = {
  metaSchema: InstanceSchema;
  objectType: ObjectTypeRow;
};

// ------------------------------------------------------- identifier safety
//
// datasource_table and datasource_column are plain text columns, so a metadata
// row can name anything at all. Two defences, in this order:
//
//   1. the value has to look like an unquoted Postgres identifier, so a
//      malformed row fails loudly instead of reaching the database;
//   2. whatever survives goes through sql.id(), which wraps it in double
//      quotes and doubles any quote inside it.
//
// Neither is on its own the reason the routes are safe from injection -- no
// caller-supplied string ever becomes an identifier. Path and query values are
// matched against api_name to *select* a metadata row; the identifier then
// comes from that row, never from the request.

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function assertIdentifier(value: string, what: string): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new HttpError(500, `${what} is not a usable identifier: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * The schema-qualified table an object type reads from.
 *
 * object_type.schema is text like any other column, so it is checked against
 * the INSTANCE_SCHEMAS allow-list rather than trusted.
 */
export function instanceTable(objectType: ObjectTypeRow): RawBuilder<unknown> {
  if (!isInstanceSchema(objectType.schema)) {
    throw new HttpError(
      500,
      `object type ${objectType.api_name} names schema ${JSON.stringify(objectType.schema)}, ` +
        `which is not one of: ${INSTANCE_SCHEMAS.join(", ")}`,
    );
  }
  return sql.id(objectType.schema, assertIdentifier(objectType.datasource_table, "datasource_table"));
}

/**
 * `"datasource_column" as "apiName"` for each property, so rows come back
 * keyed the way clients address them.
 *
 * The alias needs no identifier check: it is an output label, and sql.id()
 * quotes it. Only the column being read has to name something real.
 */
export function selectColumns(properties: readonly PropertyRow[]): RawBuilder<unknown> {
  if (properties.length === 0) {
    throw new HttpError(500, "object type has no properties");
  }
  return sql.join(
    properties.map(
      (p) =>
        sql`${sql.id(assertIdentifier(p.datasource_column, "datasource_column"))} as ${sql.id(p.api_name)}`,
    ),
    sql`, `,
  );
}

/** A single column reference, for filters and joins. */
export function columnRef(property: PropertyRow): RawBuilder<unknown> {
  return sql.id(assertIdentifier(property.datasource_column, "datasource_column"));
}

export function primaryKeyProperty(
  objectType: ObjectTypeRow,
  properties: readonly PropertyRow[],
): PropertyRow {
  const pk = properties.find((p) => p.is_primary_key);
  if (pk === undefined) {
    throw new HttpError(500, `object type ${objectType.api_name} has no primary key property`);
  }
  return pk;
}

// -------------------------------------------------------- metadata queries
//
// Every instance schema carries its own copy of the metadata tables with the
// same shape, so these reach them through withSchema and keep their typing.
// Lookups are always by api_name -- `name` is display text and can change.

export async function findObjectType(apiName: string): Promise<TypeLookup | null> {
  for (const metaSchema of INSTANCE_SCHEMAS) {
    const objectType = await db
      .withSchema(metaSchema)
      .selectFrom("object_type")
      .selectAll()
      .where("api_name", "=", apiName)
      .executeTakeFirst();

    if (objectType !== undefined) {
      return { metaSchema, objectType };
    }
  }
  return null;
}

/** findObjectType, but a miss is a 404 rather than something to handle. */
export async function requireObjectType(apiName: string): Promise<TypeLookup> {
  const lookup = await findObjectType(apiName);
  if (lookup === null) {
    throw new HttpError(404, `unknown object type: ${apiName}`);
  }
  return lookup;
}

/**
 * The object_type columns a client may edit.
 *
 * Deliberately just the two display fields. api_name is the handle clients
 * address the type by, and schema/datasource_table decide which rows the type
 * reads -- changing any of them through a metadata edit would break live
 * callers or point the type at another table, so they are not offered here.
 */
export type ObjectTypeUpdate = {
  name?: string;
  description?: string | null;
};

export async function updateObjectType(
  metaSchema: InstanceSchema,
  id: string,
  update: ObjectTypeUpdate,
): Promise<ObjectTypeRow> {
  return await db
    .withSchema(metaSchema)
    .updateTable("object_type")
    .set(update)
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Resolves a link's endpoint, which metadata stores by id rather than api_name. */
export async function objectTypeById(
  metaSchema: InstanceSchema,
  id: string,
): Promise<ObjectTypeRow> {
  const objectType = await db
    .withSchema(metaSchema)
    .selectFrom("object_type")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();

  if (objectType === undefined) {
    throw new HttpError(500, `link points at object type ${id}, which does not exist`);
  }
  return objectType;
}

export async function listObjectTypes(): Promise<TypeLookup[]> {
  const all: TypeLookup[] = [];
  for (const metaSchema of INSTANCE_SCHEMAS) {
    const rows = await db
      .withSchema(metaSchema)
      .selectFrom("object_type")
      .selectAll()
      .orderBy("api_name")
      .execute();
    all.push(...rows.map((objectType) => ({ metaSchema, objectType })));
  }
  return all;
}

export function loadProperties(
  metaSchema: InstanceSchema,
  objectTypeId: string,
): Promise<PropertyRow[]> {
  return db
    .withSchema(metaSchema)
    .selectFrom("property")
    .selectAll()
    .where("object_type_id", "=", objectTypeId)
    .orderBy("api_name")
    .execute();
}

export function loadOutboundLinks(
  metaSchema: InstanceSchema,
  objectTypeId: string,
): Promise<LinkRow[]> {
  return db
    .withSchema(metaSchema)
    .selectFrom("link")
    .selectAll()
    .where("source_type_id", "=", objectTypeId)
    .orderBy("api_name")
    .execute();
}

export function loadInboundLinks(
  metaSchema: InstanceSchema,
  objectTypeId: string,
): Promise<LinkRow[]> {
  return db
    .withSchema(metaSchema)
    .selectFrom("link")
    .selectAll()
    .where("target_type_id", "=", objectTypeId)
    .orderBy("inverse_api_name")
    .execute();
}

export function loadActions(
  metaSchema: InstanceSchema,
  objectTypeId: string,
): Promise<ActionTypeRow[]> {
  return db
    .withSchema(metaSchema)
    .selectFrom("action_type")
    .selectAll()
    .where("object_type_id", "=", objectTypeId)
    .orderBy("api_name")
    .execute();
}

/** Actions are addressed by api_name within their object type. */
export async function findActionType(
  metaSchema: InstanceSchema,
  objectTypeId: string,
  apiName: string,
): Promise<ActionTypeRow | undefined> {
  return await db
    .withSchema(metaSchema)
    .selectFrom("action_type")
    .selectAll()
    .where("object_type_id", "=", objectTypeId)
    .where("api_name", "=", apiName)
    .executeTakeFirst();
}

export async function propertyById(
  metaSchema: InstanceSchema,
  id: string,
): Promise<PropertyRow> {
  const property = await db
    .withSchema(metaSchema)
    .selectFrom("property")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();

  if (property === undefined) {
    throw new HttpError(500, `link points at property ${id}, which does not exist`);
  }
  return property;
}

// ------------------------------------------------------------- cardinality

const INVERSE_CARDINALITY: Record<Cardinality, Cardinality> = {
  one_to_one: "one_to_one",
  one_to_many: "many_to_one",
  many_to_one: "one_to_many",
  many_to_many: "many_to_many",
};

/**
 * Narrows link.cardinality, which the schema stores as unconstrained text.
 *
 * Nothing in the database stops a row from naming something else, and guessing
 * at one would silently decide whether a link answers with an array or a single
 * object, so an unrecognised value is a fault in the metadata.
 */
export function toCardinality(value: string): Cardinality {
  if (value in INVERSE_CARDINALITY) {
    return value as Cardinality;
  }
  throw new HttpError(
    500,
    `link declares cardinality ${JSON.stringify(value)}, which is not one of: ` +
      Object.keys(INVERSE_CARDINALITY).join(", "),
  );
}

/** How the target type sees the link the source type declared. */
export function inverseCardinality(cardinality: string): Cardinality {
  return INVERSE_CARDINALITY[toCardinality(cardinality)];
}

/** Whether a side of a link holds many instances or at most one. */
export function isPlural(cardinality: string): boolean {
  const known = toCardinality(cardinality);
  return known === "one_to_many" || known === "many_to_many";
}
