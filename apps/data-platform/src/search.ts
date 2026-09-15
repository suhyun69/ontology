import type { Instance, Property, TypeDetail } from "./api.ts";

/**
 * The properties a query is matched against.
 *
 * Booleans are left out: "true" and "false" are not words anyone is looking
 * for, and matching them would make every row with a false flag answer to "a".
 */
export function searchableProperties(meta: TypeDetail): Property[] {
  return meta.properties.filter((property) => property.data_type !== "boolean");
}

/**
 * The text one property value is searched as.
 *
 * A timestamp contributes both forms -- the stored ISO string and the rendered
 * local one -- because the table shows the second and the row holds the first,
 * and a query should match what is on screen either way.
 */
function searchableText(value: unknown, dataType: string): string {
  if (value === null || value === undefined) return "";

  switch (dataType) {
    case "string[]":
      return Array.isArray(value) ? value.map((entry) => String(entry)).join(" ") : String(value);

    case "json":
      return JSON.stringify(value) ?? "";

    case "datetime":
    case "date": {
      const parsed = new Date(String(value));
      return Number.isNaN(parsed.getTime())
        ? String(value)
        : `${String(value)} ${parsed.toLocaleString()}`;
    }

    default:
      return String(value);
  }
}

/** Whether any searchable property of this instance contains `needle`. */
export function instanceMatches(instance: Instance, meta: TypeDetail, needle: string): boolean {
  if (needle === "") return true;

  return searchableProperties(meta).some((property) =>
    searchableText(instance[property.api_name], property.data_type)
      .toLowerCase()
      .includes(needle),
  );
}

/**
 * Instances of one type matching `query`.
 *
 * The query is lowercased once here rather than per property, and an empty one
 * passes everything through untouched.
 */
export function filterInstances(
  instances: readonly Instance[],
  meta: TypeDetail | undefined,
  query: string,
): Instance[] {
  const needle = query.trim().toLowerCase();
  if (meta === undefined) return [...instances];
  if (needle === "") return [...instances];

  return instances.filter((instance) => instanceMatches(instance, meta, needle));
}
