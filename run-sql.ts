#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import pg from "pg";
import type { QueryResult } from "pg";

const USAGE = "usage: pnpm run-sql <path/to/file.sql>";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const arg: string | undefined = process.argv[2];
if (arg === undefined || arg === "-h" || arg === "--help") {
  fail(USAGE);
}

const connectionString: string | undefined = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString === "") {
  fail("DATABASE_URL is not set. Run this via `pnpm run-sql` so .env is loaded.");
}

const sqlPath = resolve(process.cwd(), arg);

// Relative reads better inside the repo, absolute reads better outside it.
const rel = relative(process.cwd(), sqlPath);
const displayPath = rel.startsWith("..") ? sqlPath : rel;

if (!sqlPath.endsWith(".sql")) {
  fail(`expected a .sql file, got ${displayPath}`);
}

let sql: string;
try {
  sql = await readFile(sqlPath, "utf8");
} catch (error) {
  fail(`could not read ${displayPath}: ${error instanceof Error ? error.message : String(error)}`);
}

if (sql.trim() === "") {
  fail(`${displayPath} is empty`);
}

const client = new pg.Client({ connectionString });
await client.connect();

const startedAt = performance.now();
try {
  // A file with several statements makes node-postgres return one result per statement.
  const raw: QueryResult | QueryResult[] = await client.query(sql);
  const results = Array.isArray(raw) ? raw : [raw];
  const elapsedMs = Math.round(performance.now() - startedAt);

  console.log(`${displayPath} — ${results.length} statement(s) in ${elapsedMs}ms\n`);

  results.forEach((result, index) => {
    const command = result.command || "STATEMENT";
    const rowCount = result.rowCount ?? 0;
    console.log(`[${index + 1}] ${command} — ${rowCount} row(s)`);
    if (result.rows.length > 0) {
      console.table(result.rows);
    }
  });
} catch (error) {
  // pg errors carry position/detail/hint that make a syntax error findable.
  if (error instanceof Error) {
    const { severity, code, detail, hint, position } = error as pg.DatabaseError;
    console.error(`${severity ?? "ERROR"}${code === undefined ? "" : ` ${code}`}: ${error.message}`);
    if (detail !== undefined) console.error(`detail: ${detail}`);
    if (hint !== undefined) console.error(`hint: ${hint}`);
    if (position !== undefined) console.error(`position: ${position}`);
  } else {
    console.error(String(error));
  }
  await client.end();
  process.exit(1);
}

await client.end();
