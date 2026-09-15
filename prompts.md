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

"""
Create four Hono routes under `/api/objects` that read metadata, using `datasource_table` and `datasource_column` to construct queries.

1. Object instance routes file

- `GET /api/objects/:type` — list instances of a type. Optional query-param filters.
- `GET /api/objects/:type/:id` — get one instance with bidirectional one-hop link resolution.
  - Outbound: links where `source_type_id` matches; follow `via_property_id → datasource_column` to read the FK, then `target_type_id → datasource_table` for the target.
  - Inbound: links where `target_type_id` matches; find source instances whose FK points back.
  - Labels: `api_name`/`name` outbound, `inverse_api_name`/`inverse_name` inbound. Check `cardinality` for array vs single.

Validate a type exists in `object_type` before any work.   

2. Meta routes file
  
- `GET /api/objects/meta/types` — list all object types.
- `GET /api/objects/meta/types/:type` — bundle of one type's metadata: object_type columns, its property rows with all their columns, links in both directions, actions with `parameter_schema`.

Use api_name for lookups, never display name.

In the Kysely `Database` interface:
- Keep metadata and audit tables schema-agnostic because they will have the exact same shape for other schemas, letting you use withSchema for `meta` routes. This gives them compile-time typing.
- Add the instance tables prefixed with their schema, properly typed.

In the instance routes, validate the schema is one of our instance schemas before using it.
Prevent raw string-based SQL injection. 
"""

"""
Add an action invocation route and the first handler.

**Route:** `POST /api/objects/:type/:id/actions/:actionName` in its own route file. Look up the action in `action_type`, validate the body against `parameter_schema` with cfworker/json-schema, dispatch via a plain-object handler map keyed by `${objectTypeApiName}.${actionApiName}`. Every handler takes as input the object instance it was called on, optional params, and the action context. In the *implementations*, these arguments should be typed.

**Handler:** Batch.deferStart at `apps/ontology/src/actions/manufacturing/batchDeferStart.ts`.

Parameter: `newPlannedStart` (datetime string). Shape is already validated by the route via cfworker/json-schema; the handler does business validation and the write.

The handler should:

1. Confirm the batch's `status` is `queued` and `newPlannedStart` is in the future. Throw descriptively otherwise.
2. In one Postgres transaction: update `planned_start` on the batch, insert an audit_log row using the dual-snapshot pattern (both UUID and api_name columns populated).
3. Return the updated batch.
"""

"""
Look at 01-manufacturing-foundation.sql and if necessary update our Kysely database interface types to align with it.
"""

"""
Create an apps/data-platform workspace. package.json with `type: module`, tsconfig.json extending the base and adding JSX + DOM libs. Install @blueprintjs/core, @blueprintjs/icons, react@18, react-dom@18, @types/react@18, @types/react-dom@18, @vitejs/plugin-react, vite. Scaffold the Vite entry point — index.html, vite.config.ts, main.tsx, App.tsx with a minimal React shell. Add a dev script.
"""

"""
Build an Ontology Manager page. We want it to look visually like the attached screenshots. Use Blueprintjs components and CSS to accomplish this. In case the screenshots show something we lack data for, omit it.

Make `display_name` and `description` inline-editable (add a `PATCH /api/objects/meta/types/:type` route to update the `object_type` row).

For the links section, use a more straightforward approach to replace the interactive graph.

Add an extra left rail that lists all object types, showing display name and instance count. Clicking selects a type.
"""

"""
Build an Object Explorer with two sub-views. We want it to look visually like the three attached screenshots. Use Blueprintjs components and CSS to accomplish this. Note that all of them are a little different in layout. In our case, you need to make a single one that is sensible for any object type.

Left rail: same type list as the OM, but clicking navigates to the instance list for that type.

Instance list: fetch from `GET /api/objects/:type`. Render a table. Main column: find the property where `is_title` is true in the type metadata and use that value. Show `status` as a secondary column. Clicking a row navigates to the object detail view.

Object detail: fetch from `GET /api/objects/:type/:id` (returns properties + resolved links). Action strip across the top: a button per action from the type's action list (display name as label, description as tooltip). Don't wire up the click handlers yet, just render the buttons. Two-column layout below:

- Left, Properties: list each property with its display name from metadata. Format values by `data_type`.
- Right, Links: show resolved linked objects grouped by link name. Clicking navigates to that object's detail. Maintain a navigation stack so back works.

Also add a thin left sidebar so we can switch between our apps, each with a different icon. Our first
Ontology Manager gets a Cube icon. Use a search-template icon for this Object Explorer app.
"""

"""
Wire up the action buttons in the Object Explorer detail view. When an action button is clicked, open a Blueprint dialog. Read the action's `parameter_schema` (JSON Schema) and dynamically generate form fields:

- `datetime` -> `DateInput`
- `string` -> `InputGroup`
- `enum` -> `HTMLSelect`
- `number` -> `NumericInput`

Required fields are marked. Submit sends a POST to `/api/objects/:type/:id/actions/:actionName` with the form values. Show the result and refresh the detail view. Make sure the request body format matches the one expected by the action handler's logic.
"""

"""
Add a search bar above the instance list in the Object Explorer. When the user types a query:

1. Filter instances of the selected type by checking if any property value contains the search string.
2. Read property metadata to know which properties to search (skip booleans).
3. Filter the instance list in real-time.
4. Optional toggle: "search all types" — search across all object types, show results grouped by type.
"""

"""
Add COURSE_NOW=2026-04-30T09:00:00Z to the root .env. Then create a small TypeScript module that overrides the global Date so the current time is anchored at COURSE_NOW when the server starts and advances normally from there. Date.now() and a bare new Date() should report that anchored time, while new Date(value) still parses normally. It must be active before any route handler runs.
"""

"""
POST to localhost:3456/api/objects/batch/B-2130/actions/deferStart with newPlannedStart set to 2026-05-03T09:00:00Z
"""