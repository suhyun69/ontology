import { Classes, Tag } from "@blueprintjs/core";
import type { ReactNode } from "react";
import type { Instance, Property, TypeDetail } from "./api.ts";

/** Stands in for a null or absent value, so an empty cell never reads as a blank string. */
export function Empty() {
  return <span className={Classes.TEXT_MUTED}>—</span>;
}

function formatTimestamp(value: unknown, withTime: boolean): ReactNode {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value);

  return withTime ? parsed.toLocaleString() : parsed.toLocaleDateString();
}

/**
 * Renders a value the way its declared data_type asks for.
 *
 * numeric columns arrive as strings -- node-postgres will not put a value that
 * does not fit a float64 through one (see the Numeric type in the API's db.ts)
 * -- so a numeric string is printed as it came rather than parsed and
 * reformatted, which would be the one way to lose the precision it protects.
 */
export function formatValue(value: unknown, dataType: string): ReactNode {
  if (value === null || value === undefined || value === "") return <Empty />;

  switch (dataType) {
    case "boolean":
      return <Tag minimal>{value === true ? "true" : "false"}</Tag>;

    case "enum":
      return <Tag minimal>{String(value)}</Tag>;

    case "datetime":
      return formatTimestamp(value, true);

    case "date":
      return formatTimestamp(value, false);

    case "number":
      return typeof value === "number" ? value.toLocaleString() : String(value);

    case "string[]": {
      if (!Array.isArray(value)) return String(value);
      if (value.length === 0) return <Empty />;
      return (
        <span className="ox-tag-row">
          {value.map((entry, index) => (
            <Tag minimal key={`${String(entry)}:${index}`}>
              {String(entry)}
            </Tag>
          ))}
        </span>
      );
    }

    case "json":
      return <pre className="ox-json">{JSON.stringify(value, null, 2)}</pre>;

    default:
      return String(value);
  }
}

// ------------------------------------------------------- metadata lookups

/** The property holding an instance's id. */
export function primaryKeyProperty(meta: TypeDetail): Property | undefined {
  return meta.properties.find((property) => property.is_primary_key);
}

/**
 * The property standing in for the whole instance.
 *
 * Types vary in which one that is -- Tank titles on `name`, Batch on its id --
 * so it comes from the metadata, falling back to the primary key for a type
 * that marks no title at all.
 */
export function titleProperty(meta: TypeDetail): Property | undefined {
  return meta.properties.find((property) => property.is_title) ?? primaryKeyProperty(meta);
}

/** Not every type declares a status; the ones that do get an extra column. */
export function statusProperty(meta: TypeDetail): Property | undefined {
  return meta.properties.find((property) => property.api_name === "status");
}

/** How an instance is labelled when it stands for itself, e.g. in a link list. */
export function instanceLabel(instance: Instance, meta: TypeDetail | undefined): string {
  if (meta === undefined) return "…";

  const title = titleProperty(meta);
  const value = title === undefined ? undefined : instance[title.api_name];
  if (value !== null && value !== undefined && value !== "") return String(value);

  return String(instanceId(instance, meta) ?? "—");
}

/** An instance's id, or undefined when the type declares no primary key. */
export function instanceId(instance: Instance, meta: TypeDetail | undefined): string | undefined {
  if (meta === undefined) return undefined;

  const key = primaryKeyProperty(meta);
  if (key === undefined) return undefined;

  const value = instance[key.api_name];
  return value === null || value === undefined ? undefined : String(value);
}
