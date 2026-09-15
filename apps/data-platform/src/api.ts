// Shapes returned by apps/ontology. Metadata rows keep their snake_case column
// names on the wire, so they are spelled that way here too rather than renamed
// in a mapping layer that would have to be kept in step with the schema.

export type ObjectType = {
  id: string;
  api_name: string;
  name: string;
  description: string | null;
  status: string;
  visibility: string;
  point_of_contact: string | null;
  edits_enabled: boolean;
  schema: string;
  datasource_table: string;
};

/** An object type as the list route returns it: the row plus its row count. */
export type ObjectTypeSummary = ObjectType & { instanceCount: number };

export type Property = {
  id: string;
  api_name: string;
  name: string;
  data_type: string;
  required: boolean;
  is_title: boolean;
  is_primary_key: boolean;
  datasource_column: string;
};

/**
 * A link as seen from one end.
 *
 * `name`/`api_name` read source -> target, so an inbound link is labelled by
 * its `inverse_*` fields instead; `effective_cardinality` is already stated
 * from this type's point of view, unlike `cardinality`.
 */
export type Link = {
  id: string;
  api_name: string;
  name: string;
  inverse_api_name: string;
  inverse_name: string;
  cardinality: string;
  direction: "outbound" | "inbound";
  effective_cardinality: string;
  source_type_api_name: string;
  target_type_api_name: string;
  via_property_api_name: string;
};

export type ActionType = {
  id: string;
  api_name: string;
  name: string;
  description: string | null;
  parameter_schema: Record<string, unknown>;
};

export type TypeDetail = {
  objectType: ObjectType;
  properties: Property[];
  links: Link[];
  actions: ActionType[];
};

export type ObjectTypeUpdate = {
  name?: string;
  description?: string | null;
};

/**
 * Calls the API, turning a non-2xx into a throw.
 *
 * The server reports failures as `{ error }` (see index.ts onError), so that
 * message is preferred over the bare status -- it is the one written for a
 * human to read.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return payload as T;
}

export function listObjectTypes(): Promise<{ count: number; types: ObjectTypeSummary[] }> {
  return request("/api/objects/meta/types");
}

export function loadObjectType(apiName: string): Promise<TypeDetail> {
  return request(`/api/objects/meta/types/${encodeURIComponent(apiName)}`);
}

export function patchObjectType(
  apiName: string,
  update: ObjectTypeUpdate,
): Promise<{ objectType: ObjectType }> {
  return request(`/api/objects/meta/types/${encodeURIComponent(apiName)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(update),
  });
}
