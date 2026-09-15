/**
 * Turns an action's parameter_schema into a form.
 *
 * The schema is the same JSON Schema the server validates the request against
 * (see the action route), so the fields derived here and the body built from
 * them are two views of one contract -- a field this module cannot express is
 * one the server would reject anyway.
 */

export type FieldKind = "datetime" | "string" | "enum" | "number" | "boolean";

/** Which flavour of timestamp a datetime field is; null for every other kind. */
export type DateFormat = "date-time" | "date";

export type ActionField = {
  name: string;
  kind: FieldKind;
  required: boolean;
  label: string;
  description: string | null;
  /** Allowed values, for an enum field; empty otherwise. */
  options: string[];
  dateFormat: DateFormat | null;
};

/** A form value, before it is narrowed back to what the schema asks for. */
export type FieldValue = string | number | boolean | null;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** `newPlannedStart` -> `New Planned Start`, for a schema that names no title. */
function humanize(name: string): string {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Which control a property gets.
 *
 * enum wins over type because a constrained string is a choice, not free text.
 * A timestamp is a string with a format, so that is checked before falling
 * back to a plain text field.
 */
function dateFormatOf(spec: Record<string, unknown>): DateFormat | null {
  const format = spec["format"];
  return format === "date-time" || format === "date" ? format : null;
}

function fieldKind(spec: Record<string, unknown>): FieldKind {
  if (Array.isArray(spec["enum"])) return "enum";

  const type = spec["type"];
  if (type === "number" || type === "integer") return "number";
  if (type === "boolean") return "boolean";
  if (dateFormatOf(spec) !== null) return "datetime";

  return "string";
}

export function readActionFields(schema: Record<string, unknown>): ActionField[] {
  const properties = asRecord(schema["properties"]);
  if (properties === null) return [];

  const requiredNames = Array.isArray(schema["required"])
    ? schema["required"].filter((name): name is string => typeof name === "string")
    : [];

  return Object.entries(properties).map(([name, raw]) => {
    const spec = asRecord(raw) ?? {};
    const title = spec["title"];
    const description = spec["description"];

    return {
      name,
      kind: fieldKind(spec),
      required: requiredNames.includes(name),
      label: typeof title === "string" ? title : humanize(name),
      description: typeof description === "string" ? description : null,
      options: Array.isArray(spec["enum"]) ? spec["enum"].map((option) => String(option)) : [],
      dateFormat: dateFormatOf(spec),
    };
  });
}

/** Whether a value counts as "not filled in". `false` is a real answer, not a blank. */
function isBlank(value: FieldValue | undefined): boolean {
  return value === undefined || value === null || value === "";
}

/** Required fields the form has no value for, by label, for the submit guard. */
export function missingRequired(
  fields: readonly ActionField[],
  values: Readonly<Record<string, FieldValue>>,
): string[] {
  return fields
    .filter((field) => field.required && isBlank(values[field.name]))
    .map((field) => field.label);
}

/**
 * The POST body: the parameters themselves, flat, exactly as the route reads
 * them before handing them to the handler -- no envelope around them.
 *
 * An optional field left empty is left out rather than sent as "", which the
 * schema would reject for anything that declares a format.
 */
export function toRequestBody(
  fields: readonly ActionField[],
  values: Readonly<Record<string, FieldValue>>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  for (const field of fields) {
    const value = values[field.name];
    if (isBlank(value)) continue;

    body[field.name] =
      field.kind === "datetime" && typeof value === "string"
        ? normalizeDate(value, field.dateFormat)
        : value;
  }

  return body;
}

/**
 * Puts a timestamp in the shape JSON Schema's `date-time` asks for.
 *
 * That format is RFC 3339, which requires seconds -- and a date control emits
 * only as much precision as it was asked to display, so a minute-precision
 * value like 2026-12-01T10:00+09:00 is rejected for want of ":00". Going back
 * through Date normalises the shape without moving the instant it names.
 */
function normalizeDate(value: string, format: DateFormat | null): string {
  // A `date` is a calendar day, not an instant: converting it to UTC could
  // land it on the day before.
  if (format === "date") return value.slice(0, 10);

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}
