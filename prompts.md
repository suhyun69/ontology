"""
set up a pnpm workspace project for a "run ts directly" worklow. Add a tsconfig.base.json with settings turned for a "Node 26 runs TS natively" worklow and .gitignore One workspace: apps/ontology/ with its own package.json and tsconfig.json extending the base. Initialize a git repo.
"""

"""
install pg at the workspace root
"""

"""
Create a CLi script run-sql.ts at the repo root taking the path to a .sql file, connects via pg using DATABASE_URL, executes it, and reports the result. Add it as run-sql script to the root package.json, invoking via node --env-file=__.
"""

"""
claude mcp add --transport http neon --scope project "https://mcp.neon.tech/mcp?readonly=true"
"""

"""
Install hono, @hono/node-server, kysely, @cfworker/json-xhema, and pg in apps/onthology
"""

"""
In apps/ontology/src, set up index.ts with a Hono app and a /health route, and db.ts with a Kysely connection reading DATABASE_URL from the worksapce root .env. Add a dev script that runs the entry point with --watch.
"""

"""
Write a SQL file creating and populating a Postgres schema named `manufacturing`.

**Instance tables** (snake_case columns; instance-table primary keys are TEXT to hold domain IDs like `T-12`; FKs between instance tables match those text PKs):

- tank: id, name, capacity, status, current_temperature, commissioned_at
- line: id, name, status, commissioned_at
- batch: id, recipe_id (FK), target_volume, status, planned_start, current_sugar_level, current_temperature, days_fermenting, assigned_tank_id (FK), assigned_operator_id (FK), last_operator_note
- bottling_run: id, batch_id (FK), line_id (FK), planned_start, status, assigned_operator_id (FK)
- maintenance_log: id, target_type, target_id (text — polymorphic, no FK constraint), type, status, started_at, completed_at, notes
- operator: id, name, certifications (text[]), shift
- recipe: id, name, target_sugar_curve (JSONB), fermentation_days, required_ingredients (text[]), notes
- quality_test: id, batch_id (FK), test_date, ph, sugar_level, notes, tested_by

**Metadata tables** (three-identifier pattern: `id` generated UUID PK, `api_name` unique stable, `name` editable display):

- object_type: + description, status, visibility, point_of_contact, edits_enabled, schema, datasource_table
- property: + object_type_id (UUID FK), data_type, required, is_title, is_primary_key, datasource_column
- link: + inverse_api_name, inverse_name, source_type_id (UUID FK), target_type_id (UUID FK), via_property_id (UUID FK → property), cardinality
- action_type: + object_type_id (UUID FK), description, parameter_schema (JSONB)
- audit_log: + action_type_id (UUID FK), action_api_name (snapshot), target_type_id (UUID FK), target_type_api_name (snapshot), target_id (text — instance ID), actor, params (JSONB), result (JSONB), created_at. Omit api_name/name.

**Populate metadata** for all eight manufacturing types. Property rows for every column (api_name in camelCase, datasource_column in snake_case; mark `is_title` and `is_primary_key` appropriately). Link rows with inverse names:

- Batch → Tank (assignedTank / assignedBatches, via assignedTankId, many_to_one)
- Batch → Operator (assignedOperator / assignedBatches, via assignedOperatorId, many_to_one)
- Batch → Recipe (recipe / batches, via recipeId, many_to_one)
- BottlingRun → Batch (batch / bottlingRuns, via batchId, many_to_one)
- BottlingRun → Line (line / bottlingRuns, via lineId, many_to_one)
- QualityTest → Batch (batch / qualityTests, via batchId, many_to_one)

One action_type row: Batch.deferStart, description "Postpone the batch's planned start date", `parameter_schema` being a JSON Schema with `newPlannedStart` as a datetime string.

**Test data** (just enough to verify routes): one Tank `T-12`, one Recipe `REC-LAGER-V3` with a sample sugar curve, one Operator `Park Kyungwon`, one Batch `B-2105` linked to all three with status `fermenting`.
"""