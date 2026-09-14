import { Hono } from "hono";
import { HttpError } from "../errors.ts";
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
} from "../metadata.ts";
import type { LinkRow, TypeLookup } from "../metadata.ts";

export const metaRoutes = new Hono();

// ------------------------------------------ GET /api/objects/meta/types

metaRoutes.get("/types", async (c) => {
  const types = await listObjectTypes();
  return c.json({
    count: types.length,
    types: types.map(({ objectType }) => objectType),
  });
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
