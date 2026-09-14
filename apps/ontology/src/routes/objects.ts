import { Hono } from "hono";
import { sql } from "kysely";
import type { RawBuilder } from "kysely";
import { db } from "../db.ts";
import type { Cardinality } from "../db.ts";
import { HttpError } from "../errors.ts";
import {
  columnRef,
  findObjectType,
  instanceTable,
  inverseCardinality,
  isPlural,
  loadInboundLinks,
  loadOutboundLinks,
  loadProperties,
  objectTypeById,
  primaryKeyProperty,
  propertyById,
  selectColumns,
} from "../metadata.ts";
import type { LinkRow, ObjectTypeRow, PropertyRow, TypeLookup } from "../metadata.ts";

/** An instance row, keyed by property api_name. */
type Instance = Record<string, unknown>;

type LinkView = {
  name: string;
  direction: "outbound" | "inbound";
  cardinality: Cardinality;
  targetType: string;
  value: Instance | Instance[] | null;
};

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

/** Query params that control the page rather than filter the rows. */
const PAGINATION_PARAMS = new Set(["limit", "offset"]);

export const objectRoutes = new Hono();

// ------------------------------------------------------------------ helpers

async function requireType(apiName: string): Promise<TypeLookup> {
  const lookup = await findObjectType(apiName);
  if (lookup === null) {
    throw new HttpError(404, `unknown object type: ${apiName}`);
  }
  return lookup;
}

/**
 * Reads instances of one type.
 *
 * Table and column names come from metadata rows and are escaped on the way in
 * (see metadata.ts); every value is a bound parameter, so nothing a caller
 * sends is ever concatenated into SQL.
 */
async function selectInstances(
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

function parsePositiveInteger(raw: string, what: string, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new HttpError(400, `${what} must be an integer between 0 and ${max}, got ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * Turns a query-string value into something comparable against the column.
 * The result is always a bound parameter, so this is about types, not safety.
 */
function coerceFilterValue(property: PropertyRow, raw: string): unknown {
  switch (property.data_type) {
    case "integer": {
      const value = Number(raw);
      if (!Number.isInteger(value)) {
        throw new HttpError(400, `${property.api_name} must be an integer, got ${JSON.stringify(raw)}`);
      }
      return value;
    }
    case "double": {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new HttpError(400, `${property.api_name} must be a number, got ${JSON.stringify(raw)}`);
      }
      return value;
    }
    case "boolean": {
      if (raw === "true") return true;
      if (raw === "false") return false;
      throw new HttpError(400, `${property.api_name} must be true or false, got ${JSON.stringify(raw)}`);
    }
    case "timestamp":
    case "date": {
      // Postgres parses the literal; an unparseable one is a 400, not a 500.
      if (Number.isNaN(Date.parse(raw))) {
        throw new HttpError(400, `${property.api_name} must be a date, got ${JSON.stringify(raw)}`);
      }
      return raw;
    }
    case "string_array":
    case "json":
      throw new HttpError(400, `${property.api_name} is a ${property.data_type} and cannot be filtered on`);
    default:
      return raw;
  }
}

function buildFilters(
  query: Record<string, string>,
  properties: readonly PropertyRow[],
): RawBuilder<unknown>[] {
  const byApiName = new Map(properties.map((p) => [p.api_name, p]));
  const conditions: RawBuilder<unknown>[] = [];

  for (const [key, raw] of Object.entries(query)) {
    if (PAGINATION_PARAMS.has(key)) continue;

    const property = byApiName.get(key);
    if (property === undefined) {
      // Silently ignoring a typo'd filter would quietly return the wrong page.
      throw new HttpError(
        400,
        `unknown filter: ${key}. Filterable properties: ${[...byApiName.keys()].join(", ")}`,
      );
    }
    conditions.push(sql`${columnRef(property)} = ${coerceFilterValue(property, raw)}`);
  }

  return conditions;
}

// --------------------------------------------------- GET /api/objects/:type

objectRoutes.get("/:type", async (c) => {
  const { metaSchema, objectType } = await requireType(c.req.param("type"));
  const properties = await loadProperties(metaSchema, objectType.id);

  const query = c.req.query();
  const limitRaw = query["limit"];
  const offsetRaw = query["offset"];

  const limit = limitRaw === undefined ? DEFAULT_LIMIT : parsePositiveInteger(limitRaw, "limit", MAX_LIMIT);
  const offset = offsetRaw === undefined ? 0 : parsePositiveInteger(offsetRaw, "offset", Number.MAX_SAFE_INTEGER);

  const instances = await selectInstances(objectType, properties, {
    conditions: buildFilters(query, properties),
    orderBy: primaryKeyProperty(objectType, properties),
    limit,
    offset,
  });

  return c.json({
    type: objectType.api_name,
    limit,
    offset,
    count: instances.length,
    instances,
  });
});

// ----------------------------------------------- GET /api/objects/:type/:id

/**
 * Follows a link the type declares: read the foreign key off this instance,
 * then fetch the target it points at.
 */
async function resolveOutbound(
  lookup: TypeLookup,
  link: LinkRow,
  instance: Instance,
): Promise<[string, LinkView]> {
  const viaProperty = await propertyById(lookup.metaSchema, link.via_property_id);
  const targetType = await objectTypeById(lookup.metaSchema, link.target_type_id);
  const targetProperties = await loadProperties(lookup.metaSchema, targetType.id);
  const targetKey = primaryKeyProperty(targetType, targetProperties);

  const plural = isPlural(link.cardinality);
  const view: LinkView = {
    name: link.name,
    direction: "outbound",
    cardinality: link.cardinality,
    targetType: targetType.api_name,
    value: plural ? [] : null,
  };

  // The instance is keyed by api_name, which is how the select aliased it.
  const foreignKey = instance[viaProperty.api_name];
  if (foreignKey === null || foreignKey === undefined) {
    return [link.api_name, view];
  }

  const targets = await selectInstances(targetType, targetProperties, {
    conditions: [sql`${columnRef(targetKey)} = ${foreignKey}`],
    orderBy: targetKey,
  });

  view.value = plural ? targets : (targets[0] ?? null);
  return [link.api_name, view];
}

/**
 * Follows a link some other type declares against this one: find the instances
 * whose foreign key points back here. Labelled with the link's inverse names,
 * and pluralised by the inverse cardinality.
 */
async function resolveInbound(
  lookup: TypeLookup,
  link: LinkRow,
  id: unknown,
): Promise<[string, LinkView]> {
  const viaProperty = await propertyById(lookup.metaSchema, link.via_property_id);
  const sourceType = await objectTypeById(lookup.metaSchema, link.source_type_id);
  const sourceProperties = await loadProperties(lookup.metaSchema, sourceType.id);

  const cardinality = inverseCardinality(link.cardinality);
  const sources = await selectInstances(sourceType, sourceProperties, {
    conditions: [sql`${columnRef(viaProperty)} = ${id}`],
    orderBy: primaryKeyProperty(sourceType, sourceProperties),
  });

  return [
    link.inverse_api_name,
    {
      name: link.inverse_name,
      direction: "inbound",
      cardinality,
      targetType: sourceType.api_name,
      value: isPlural(cardinality) ? sources : (sources[0] ?? null),
    },
  ];
}

objectRoutes.get("/:type/:id", async (c) => {
  const lookup = await requireType(c.req.param("type"));
  const { metaSchema, objectType } = lookup;
  const id = c.req.param("id");

  const properties = await loadProperties(metaSchema, objectType.id);
  const key = primaryKeyProperty(objectType, properties);

  const [instance] = await selectInstances(objectType, properties, {
    conditions: [sql`${columnRef(key)} = ${id}`],
    limit: 1,
  });

  if (instance === undefined) {
    throw new HttpError(404, `no ${objectType.api_name} with ${key.api_name} ${JSON.stringify(id)}`);
  }

  const [outboundLinks, inboundLinks] = await Promise.all([
    loadOutboundLinks(metaSchema, objectType.id),
    loadInboundLinks(metaSchema, objectType.id),
  ]);

  // One hop only: targets come back as their own properties, not resolved further.
  const resolved = await Promise.all([
    ...outboundLinks.map((link) => resolveOutbound(lookup, link, instance)),
    ...inboundLinks.map((link) => resolveInbound(lookup, link, instance[key.api_name])),
  ]);

  return c.json({
    type: objectType.api_name,
    id: instance[key.api_name],
    properties: instance,
    links: Object.fromEntries(resolved),
  });
});
