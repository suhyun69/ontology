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

// ------------------------------------------------------------- instances

/** An instance row, keyed by property api_name. Values are whatever the column holds. */
export type Instance = Record<string, unknown>;

export type InstancePage = {
  type: string;
  limit: number;
  offset: number;
  count: number;
  instances: Instance[];
};

/**
 * One link followed from an instance.
 *
 * `value` is an array when this end of the link is plural, a single instance
 * when it is not, and null when the foreign key is unset -- the server has
 * already applied the cardinality, so nothing here has to guess.
 */
export type ResolvedLink = {
  name: string;
  direction: "outbound" | "inbound";
  cardinality: string;
  targetType: string;
  value: Instance | Instance[] | null;
};

export type InstanceDetail = {
  type: string;
  id: unknown;
  properties: Instance;
  /** Keyed by the link's api_name, as seen from this instance. */
  links: Record<string, ResolvedLink>;
};

/**
 * A failed call, carrying whatever machine-readable context came with it.
 *
 * The action route reports a schema mismatch as `details`: one entry per
 * violated keyword, which says a good deal more than the summary message.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

/**
 * Calls the API, turning a non-2xx into a throw.
 *
 * The server reports failures as `{ error, details? }` (see index.ts onError),
 * so that message is preferred over the bare status -- it is the one written
 * for a human to read.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const body = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
    const message =
      "error" in body ? String(body["error"]) : `${response.status} ${response.statusText}`;
    throw new ApiError(message, response.status, body["details"] ?? null);
  }

  return payload as T;
}

export function listObjectTypes(): Promise<{ count: number; types: ObjectTypeSummary[] }> {
  return request("/api/objects/meta/types");
}

export function loadObjectType(apiName: string): Promise<TypeDetail> {
  return request(`/api/objects/meta/types/${encodeURIComponent(apiName)}`);
}

export function listInstances(type: string): Promise<InstancePage> {
  return request(`/api/objects/${encodeURIComponent(type)}`);
}

export function loadInstance(type: string, id: string): Promise<InstanceDetail> {
  return request(`/api/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
}

export type ActionResult = {
  type: string;
  id: unknown;
  action: string;
  result: unknown;
};

/**
 * Runs an action against one instance.
 *
 * The body is the parameters themselves, flat -- the route parses the whole
 * body as the parameter object and validates it against the action's
 * parameter_schema, so anything wrapped around them would fail that check.
 *
 * x-actor is what the audit row records. There is no authentication yet and
 * the route falls back to "anonymous", so naming the app at least says which
 * surface a change came through.
 */
export function runAction(
  type: string,
  id: string,
  actionName: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const path = `/api/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}/actions/${encodeURIComponent(actionName)}`;

  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-actor": "object-explorer" },
    body: JSON.stringify(params),
  });
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
