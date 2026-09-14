import { Kysely, PostgresDialect } from "kysely";
import type { ColumnType, Generated } from "kysely";
import pg from "pg";

// DATABASE_URL comes from the workspace root .env, loaded by the runtime via
// `node --env-file=../../.env` (see the start/dev scripts). Nothing here reads
// the file itself, so anything importing this module must be launched that way.
const connectionString: string | undefined = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString === "") {
  throw new Error(
    "DATABASE_URL is not set. Run via `pnpm dev` or `pnpm start` so the workspace root .env is loaded.",
  );
}

// ------------------------------------------------------------ column helpers
//
// Mirrors sql/01-manufacturing-foundation.sql.

// numeric columns are typed string: node-postgres hands numerics back as
// strings rather than lose precision on values that do not fit a float64.
type Numeric = string;

type Timestamp = ColumnType<Date, Date | string, Date | string>;

/**
 * A text column holding one of a known set of values.
 *
 * The schema declares no CHECK constraints, so the database will accept any
 * text at all. Reads are therefore plain string -- narrowing them would let
 * TypeScript rule out a value that can really be in the column -- while writes
 * are held to the set the seed and the application actually use.
 */
type Enum<T extends string> = ColumnType<string, T, T>;

/** As Enum, for a column Postgres fills in via DEFAULT. */
type DefaultedEnum<T extends string> = ColumnType<string, T | undefined, T>;

/** jsonb holding an object; pg runs plain objects through JSON.stringify. */
type JsonObject<T> = ColumnType<T, T | string, T | string>;

/** As JsonObject, for a nullable column with no default. */
type NullableJsonObject<T> = ColumnType<T | null, T | string | null, T | string | null>;

// ========================================================== instance tables

// One set of these exists per instance schema. The Database interface below
// keys them by "<schema>.<table>" so a query names the schema it reads.

type Shift = "Day" | "Night";
type TankStatus = "idle" | "fermenting";
type LineStatus = "idle" | "running";
type BatchStatus = "queued" | "fermenting";
type BottlingRunStatus = "queued" | "running" | "done";
type MaintenanceType = "corrective" | "preventive" | "cleaning";
type MaintenanceStatus = "scheduled" | "in_progress" | "completed";
/** Maintenance is polymorphic; target_type holds the target's object_type api_name. */
type MaintenanceTargetType = "tank" | "line";

/**
 * A recipe's target gravity curve, keyed by day: {"day_1": 1.050, ...}.
 * An object rather than a list, so the days sampled vary per recipe.
 */
export type SugarCurve = Record<string, number>;

export type OperatorTable = {
  id: string;
  name: string;
  certifications: string[] | null;
  shift: Enum<Shift>;
};

export type RecipeTable = {
  id: string;
  name: string;
  target_sugar_curve: JsonObject<SugarCurve>;
  fermentation_days: number;
  required_ingredients: string[] | null;
  notes: string | null;
};

export type TankTable = {
  id: string;
  name: string;
  /** Hectolitres, per the property row's display name. */
  capacity: Numeric;
  status: Enum<TankStatus>;
  /** Degrees Celsius; null until a sensor reports. */
  current_temperature: Numeric | null;
  commissioned_at: Timestamp;
};

export type LineTable = {
  id: string;
  name: string;
  status: Enum<LineStatus>;
  commissioned_at: Timestamp;
};

export type BatchTable = {
  id: string;
  recipe_id: string;
  target_volume: Numeric | null;
  status: Enum<BatchStatus>;
  planned_start: Timestamp | null;
  /** Specific gravity, matching the recipe's curve. */
  current_sugar_level: Numeric | null;
  current_temperature: Numeric | null;
  days_fermenting: number | null;
  assigned_tank_id: string | null;
  assigned_operator_id: string | null;
  last_operator_note: string | null;
};

export type BottlingRunTable = {
  id: string;
  batch_id: string;
  line_id: string;
  planned_start: Timestamp | null;
  status: Enum<BottlingRunStatus>;
  assigned_operator_id: string | null;
};

export type QualityTestTable = {
  id: string;
  batch_id: string;
  test_date: Timestamp;
  ph: Numeric | null;
  sugar_level: Numeric | null;
  notes: string | null;
  /** Free text, not a foreign key: an external lab has no operator row. */
  tested_by: string | null;
};

export type MaintenanceLogTable = {
  id: string;
  target_type: Enum<MaintenanceTargetType>;
  /** Points at a tank or a line depending on target_type; no foreign key. */
  target_id: string;
  type: Enum<MaintenanceType>;
  status: Enum<MaintenanceStatus>;
  started_at: Timestamp | null;
  completed_at: Timestamp | null;
  notes: string | null;
};

// ========================================================== metadata tables

// Deliberately unqualified. Every instance schema carries this same set of
// metadata tables with the same shape, so the keys stay schema-agnostic and a
// query picks the schema at call time:
//
//   db.withSchema("manufacturing").selectFrom("object_type")
//
// A query that forgets withSchema resolves against the search_path instead, so
// meta routes must always set it.

export type ObjectTypeStatus = "active" | "experimental" | "deprecated";
export type ObjectTypeVisibility = "visible" | "prominent" | "hidden";
export type PropertyDataType =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "datetime"
  | "date"
  | "json"
  | "string[]";
export type Cardinality = "one_to_one" | "one_to_many" | "many_to_one" | "many_to_many";

export type ObjectTypeTable = {
  id: Generated<string>;
  /** Stable external handle. Clients address the type by this, never by id or name. */
  api_name: string;
  /** Display text; editable without breaking any client. */
  name: string;
  description: string | null;
  status: DefaultedEnum<ObjectTypeStatus>;
  visibility: DefaultedEnum<ObjectTypeVisibility>;
  point_of_contact: string | null;
  edits_enabled: Generated<boolean>;
  /** Postgres schema the instance rows live in. No default; every row states it. */
  schema: string;
  datasource_table: string;
};

export type PropertyTable = {
  id: Generated<string>;
  object_type_id: string;
  /** Camel-cased handle clients use; unique within the object type, not globally. */
  api_name: string;
  name: string;
  data_type: Enum<PropertyDataType>;
  required: Generated<boolean>;
  is_title: Generated<boolean>;
  is_primary_key: Generated<boolean>;
  /** The snake_case column on datasource_table this property reads. */
  datasource_column: string;
};

export type LinkTable = {
  id: Generated<string>;
  /** Forward direction: how the source type names the target. */
  api_name: string;
  name: string;
  /** Reverse direction: how the target type names the source. */
  inverse_api_name: string;
  inverse_name: string;
  source_type_id: string;
  target_type_id: string;
  /** The foreign key property on the source that realises the link. */
  via_property_id: string;
  cardinality: Enum<Cardinality>;
};

export type ActionTypeTable = {
  id: Generated<string>;
  object_type_id: string;
  api_name: string;
  name: string;
  description: string | null;
  /** JSON Schema validated against the request body before the action runs. */
  parameter_schema: JsonObject<Record<string, unknown>>;
};

export type AuditLogTable = {
  id: Generated<string>;
  /** NOT NULL here, so an action_type cannot be deleted while a log row cites it. */
  action_type_id: string;
  /** Snapshot: the log still reads correctly after the action is renamed. */
  action_api_name: string;
  target_type_id: string;
  target_type_api_name: string;
  /** The instance id the action ran against, e.g. B-2105. */
  target_id: string;
  actor: string;
  params: NullableJsonObject<Record<string, unknown>>;
  result: NullableJsonObject<Record<string, unknown>>;
  created_at: Generated<Timestamp>;
};

// ================================================================= database

/**
 * Instance schemas this app will query. Anything reaching a query builder as a
 * schema name has to be checked against this first -- object_type.schema is a
 * plain text column, so a bad or hostile row must not become an identifier.
 */
export const INSTANCE_SCHEMAS = ["manufacturing"] as const;

export type InstanceSchema = (typeof INSTANCE_SCHEMAS)[number];

export function isInstanceSchema(value: string): value is InstanceSchema {
  return (INSTANCE_SCHEMAS as readonly string[]).includes(value);
}

export type Database = {
  // Instance tables, qualified by the schema they live in.
  "manufacturing.tank": TankTable;
  "manufacturing.line": LineTable;
  "manufacturing.batch": BatchTable;
  "manufacturing.bottling_run": BottlingRunTable;
  "manufacturing.maintenance_log": MaintenanceLogTable;
  "manufacturing.operator": OperatorTable;
  "manufacturing.recipe": RecipeTable;
  "manufacturing.quality_test": QualityTestTable;

  // Metadata tables, reached through withSchema.
  object_type: ObjectTypeTable;
  property: PropertyTable;
  link: LinkTable;
  action_type: ActionTypeTable;
  audit_log: AuditLogTable;
};

// --------------------------------------------------------------- connection

// sslmode lives in the connection string, so no explicit ssl options here.
// Neon's pooler fronts the database, so a small local pool is plenty.
const pool = new pg.Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});

/** Drains the pool so a `--watch` restart or a shutdown does not leak connections. */
export async function closeDb(): Promise<void> {
  await db.destroy();
}
