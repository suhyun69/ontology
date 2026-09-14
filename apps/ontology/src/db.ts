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

// numeric columns are typed string: node-postgres hands numerics back as
// strings rather than lose precision on values that do not fit a float64.
type Numeric = string;

type Timestamp = ColumnType<Date, Date | string, Date | string>;

/**
 * jsonb holding an object. pg runs plain objects through JSON.stringify, so
 * they can be written as-is.
 */
type JsonObject<T> = ColumnType<T, T | string | undefined, T | string>;

/**
 * jsonb holding an array. Writes must be pre-stringified: pg serialises a JS
 * array as a Postgres array literal, which jsonb rejects.
 */
type JsonArray<T> = ColumnType<T, string | undefined, string>;

// ========================================================== instance tables

// One set of these exists per instance schema. The Database interface below
// keys them by "<schema>.<table>" so a query names the schema it reads.

type Shift = "day" | "swing" | "night";
type TankStatus = "idle" | "fermenting" | "cleaning" | "maintenance";
type LineStatus = "idle" | "running" | "paused" | "maintenance";
type BatchStatus = "planned" | "fermenting" | "conditioning" | "bottled" | "cancelled";
type BottlingRunStatus = "queued" | "running" | "paused" | "done" | "aborted";
type MaintenanceType = "cleaning" | "repair" | "inspection" | "calibration";
type MaintenanceStatus = "open" | "in_progress" | "done" | "cancelled";
/** Maintenance is polymorphic; target_type holds the target's object_type api_name. */
type MaintenanceTargetType = "Tank" | "Line";

/** One sample of a recipe's target gravity curve. */
export type SugarPoint = { day: number; gravity: number };

export type OperatorTable = {
  id: string;
  name: string;
  certifications: Generated<string[]>;
  shift: Shift | null;
};

export type RecipeTable = {
  id: string;
  name: string;
  target_sugar_curve: JsonArray<SugarPoint[]>;
  fermentation_days: number;
  required_ingredients: Generated<string[]>;
  notes: string | null;
};

export type TankTable = {
  id: string;
  name: string;
  /** Litres. */
  capacity: Numeric;
  status: Generated<TankStatus>;
  /** Degrees Celsius; null until a sensor reports. */
  current_temperature: Numeric | null;
  commissioned_at: Timestamp | null;
};

export type LineTable = {
  id: string;
  name: string;
  status: Generated<LineStatus>;
  commissioned_at: Timestamp | null;
};

export type BatchTable = {
  id: string;
  recipe_id: string;
  /** Litres. */
  target_volume: Numeric;
  status: Generated<BatchStatus>;
  planned_start: Timestamp | null;
  /** Degrees Plato. */
  current_sugar_level: Numeric | null;
  current_temperature: Numeric | null;
  days_fermenting: Generated<number>;
  assigned_tank_id: string | null;
  assigned_operator_id: string | null;
  last_operator_note: string | null;
};

export type BottlingRunTable = {
  id: string;
  batch_id: string;
  line_id: string;
  planned_start: Timestamp | null;
  status: Generated<BottlingRunStatus>;
  assigned_operator_id: string | null;
};

export type QualityTestTable = {
  id: string;
  batch_id: string;
  test_date: Generated<Timestamp>;
  ph: Numeric | null;
  /** Degrees Plato. */
  sugar_level: Numeric | null;
  notes: string | null;
  /** Free text, not a foreign key: an external lab has no operator row. */
  tested_by: string | null;
};

export type MaintenanceLogTable = {
  id: string;
  target_type: MaintenanceTargetType;
  /** Points at a tank or a line depending on target_type; no foreign key. */
  target_id: string;
  type: MaintenanceType;
  status: Generated<MaintenanceStatus>;
  started_at: Generated<Timestamp>;
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
export type ObjectTypeVisibility = "normal" | "prominent" | "hidden";
export type PropertyDataType =
  | "string"
  | "integer"
  | "double"
  | "boolean"
  | "timestamp"
  | "date"
  | "string_array"
  | "json";
export type Cardinality = "one_to_one" | "one_to_many" | "many_to_one" | "many_to_many";

export type ObjectTypeTable = {
  id: Generated<string>;
  /** Stable external handle. Clients address the type by this, never by id or name. */
  api_name: string;
  /** Display text; editable without breaking any client. */
  name: string;
  description: string | null;
  status: Generated<ObjectTypeStatus>;
  visibility: Generated<ObjectTypeVisibility>;
  point_of_contact: string | null;
  edits_enabled: Generated<boolean>;
  /** Postgres schema the instance rows live in. */
  schema: Generated<string>;
  datasource_table: string;
};

export type PropertyTable = {
  id: Generated<string>;
  object_type_id: string;
  /** Camel-cased handle clients use; unique within the object type, not globally. */
  api_name: string;
  name: string;
  data_type: PropertyDataType;
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
  cardinality: Cardinality;
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
  action_type_id: string | null;
  /** Snapshot: the log still has to say what ran after a rename or a delete. */
  action_api_name: string;
  target_type_id: string | null;
  target_type_api_name: string;
  /** The instance id the action ran against, e.g. B-2105. */
  target_id: string;
  actor: string;
  params: JsonObject<Record<string, unknown>>;
  result: JsonObject<Record<string, unknown>>;
  created_at: Generated<Timestamp>;
};

// ================================================================= database

/**
 * Instance schemas this app will query. Anything reaching a query builder as a
 * schema name has to be checked against this first — object_type.schema is a
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
