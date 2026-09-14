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

// ------------------------------------------------------------------- schema
//
// Mirrors sql/schema.sql. Columns with a Postgres DEFAULT are Generated<T> so
// they stay optional on insert; the union types restate the CHECK constraints.
//
// numeric columns are typed string: node-postgres hands numerics back as
// strings rather than lose precision on values that do not fit a float64.

type Shift = "DAY" | "SWING" | "NIGHT";
type TankStatus = "IDLE" | "FERMENTING" | "CLEANING" | "MAINTENANCE";
type LineStatus = "IDLE" | "RUNNING" | "PAUSED" | "MAINTENANCE";
type BatchStatus = "PLANNED" | "FERMENTING" | "CONDITIONING" | "BOTTLED" | "CANCELLED";
type BottlingRunStatus = "QUEUED" | "RUNNING" | "PAUSED" | "DONE" | "ABORTED";
type MaintenanceTarget = "TANK" | "LINE";
type MaintenanceType = "CLEANING" | "REPAIR" | "INSPECTION" | "CALIBRATION";
type MaintenanceStatus = "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED";

/** One sample of a recipe's target gravity curve. */
export type SugarPoint = { day: number; gravity: number };

// Reads back parsed, but writes must be pre-stringified: pg would otherwise
// serialise a JS array as a Postgres array literal, which jsonb rejects.
type SugarCurve = ColumnType<SugarPoint[], string | undefined, string>;

type Timestamp = ColumnType<Date, Date | string, Date | string>;

export type RecipeTable = {
  id: string;
  name: string;
  ferm_days: number;
  target_sugar_curve: SugarCurve;
};

export type OperatorTable = {
  id: string;
  name: string;
  certs: Generated<string[]>;
  current_shift: Shift | null;
};

export type TankTable = {
  id: string;
  name: string;
  status: Generated<TankStatus>;
  /** Litres. */
  capacity: string;
  /** Degrees Celsius; null until a sensor reports. */
  current_temp: string | null;
};

export type LineTable = {
  id: string;
  name: string;
  status: Generated<LineStatus>;
  /** Bottles per hour. */
  speed: number | null;
  current_run_id: string | null;
};

export type BatchTable = {
  id: string;
  recipe_id: string;
  tank_id: string | null;
  status: Generated<BatchStatus>;
  operator_id: string | null;
};

export type BottlingRunTable = {
  id: string;
  batch_id: string;
  line_id: string;
  status: Generated<BottlingRunStatus>;
  started_at: Timestamp | null;
};

export type QualityTestTable = {
  id: string;
  batch_id: string;
  ph: string | null;
  /** Degrees Plato. */
  sugar_level: string | null;
  tested_by: string | null;
};

export type MaintenanceLogTable = {
  id: string;
  target_type: MaintenanceTarget;
  /** Points into tank or line depending on target_type; not a real foreign key. */
  target_id: string;
  type: MaintenanceType;
  status: Generated<MaintenanceStatus>;
  started_at: Generated<Timestamp>;
};

export type Database = {
  recipe: RecipeTable;
  operator: OperatorTable;
  tank: TankTable;
  line: LineTable;
  batch: BatchTable;
  bottling_run: BottlingRunTable;
  quality_test: QualityTestTable;
  maintenance_log: MaintenanceLogTable;
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
