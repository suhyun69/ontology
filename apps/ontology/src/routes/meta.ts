import { Hono } from "hono";
import { HttpError } from "../errors.ts";
import { countInstances } from "../instances.ts";
import {
  findObjectType,
  inverseCardinality,
  listObjectTypes,
  loadActions,
  loadInboundLinks,
  loadOutboundLinks,
  loadProperties,
  objectTypeById,
  propertyById,
  requireObjectType,
  updateObjectType,
} from "../metadata.ts";
import type { LinkRow, ObjectTypeUpdate, TypeLookup } from "../metadata.ts";

export const metaRoutes = new Hono();

// ------------------------------------------ GET /api/objects/meta/types

// instanceCount rides along with the list because the only thing that wants a
// type list generally wants to say how big each one is, and counting eight
// tables here beats eight round trips from the client.
metaRoutes.get("/types", async (c) => {
  const types = await listObjectTypes();
  const summaries = await Promise.all(
    types.map(async ({ objectType }) => ({
      ...objectType,
      instanceCount: await countInstances(objectType),
    })),
  );

  return c.json({ count: summaries.length, types: summaries });
});

// ------------------------------------ GET /api/objects/meta/types/:type

/**
 * Expands a link's id references into api_names, so the bundle describes the
 * ontology in the same vocabulary clients use to address it.
 */
async function describeLink(
  lookup: TypeLookup,
  link: LinkRow,
  direction: "outbound" | "inbound",
) {
  const [sourceType, targetType, viaProperty] = await Promise.all([
    objectTypeById(lookup.metaSchema, link.source_type_id),
    objectTypeById(lookup.metaSchema, link.target_type_id),
    propertyById(lookup.metaSchema, link.via_property_id),
  ]);

  return {
    ...link,
    direction,
    // `cardinality` above is the stored value, always read source -> target.
    // Inbound links are traversed the other way, so this is the one that says
    // whether *this* type sees many or at most one.
    effective_cardinality:
      direction === "outbound" ? link.cardinality : inverseCardinality(link.cardinality),
    source_type_api_name: sourceType.api_name,
    target_type_api_name: targetType.api_name,
    via_property_api_name: viaProperty.api_name,
    via_datasource_column: viaProperty.datasource_column,
  };
}

metaRoutes.get("/types/:type", async (c) => {
  const apiName = c.req.param("type");
  const lookup = await findObjectType(apiName);
  if (lookup === null) {
    throw new HttpError(404, `unknown object type: ${apiName}`);
  }

  const { metaSchema, objectType } = lookup;
  const [properties, outbound, inbound, actions] = await Promise.all([
    loadProperties(metaSchema, objectType.id),
    loadOutboundLinks(metaSchema, objectType.id),
    loadInboundLinks(metaSchema, objectType.id),
    loadActions(metaSchema, objectType.id),
  ]);

  const links = await Promise.all([
    ...outbound.map((link) => describeLink(lookup, link, "outbound")),
    ...inbound.map((link) => describeLink(lookup, link, "inbound")),
  ]);

  return c.json({
    objectType,
    properties,
    links,
    actions,
  });
});

// ---------------------------------- PATCH /api/objects/meta/types/:type

/**
 * Reads an update off the request body.
 *
 * Unknown keys are refused rather than dropped: a client sending `api_name`
 * expects the type to be renamed, and silently ignoring it would report success
 * for something that did not happen.
 */
function parseObjectTypeUpdate(body: unknown): ObjectTypeUpdate {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "body must be a JSON object");
  }

  const fields = body as Record<string, unknown>;
  const unknown = Object.keys(fields).filter((key) => key !== "name" && key !== "description");
  if (unknown.length > 0) {
    throw new HttpError(
      400,
      `not editable: ${unknown.join(", ")}. Editable fields: name, description`,
    );
  }

  const update: ObjectTypeUpdate = {};

  if ("name" in fields) {
    const name = fields["name"];
    if (typeof name !== "string" || name.trim() === "") {
      throw new HttpError(400, "name must be a non-empty string");
    }
    update.name = name.trim();
  }

  if ("description" in fields) {
    const description = fields["description"];
    if (description !== null && typeof description !== "string") {
      throw new HttpError(400, "description must be a string or null");
    }
    // The column is nullable and an emptied editor means "no description", so
    // blank text is stored as NULL rather than as an empty string.
    update.description =
      description === null || description.trim() === "" ? null : description.trim();
  }

  if (Object.keys(update).length === 0) {
    throw new HttpError(400, "nothing to update: provide name and/or description");
  }

  return update;
}

metaRoutes.patch("/types/:type", async (c) => {
  const { metaSchema, objectType } = await requireObjectType(c.req.param("type"));

  const body = await c.req.json().catch(() => {
    throw new HttpError(400, "body must be valid JSON");
  });

  const updated = await updateObjectType(
    metaSchema,
    objectType.id,
    parseObjectTypeUpdate(body),
  );

  return c.json({ objectType: updated });
});
