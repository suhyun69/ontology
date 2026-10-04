# ontology

pnpm workspace running TypeScript directly on Node (no build step). `apps/ontology` serves a generic ontology API over a Postgres (Neon) database, driven entirely by its own metadata tables.

## Setup

```bash
pnpm install
echo 'DATABASE_URL=postgres://...' >> .env
```

`DATABASE_URL` must point at a database with the `manufacturing` schema applied (see [seeds/01-manufacturing-foundation.sql](seeds/01-manufacturing-foundation.sql)):

```bash
pnpm run-sql seeds/01-manufacturing-foundation.sql
```

## Running the server

```bash
cd apps/ontology
pnpm dev     # restarts on save
pnpm start   # single run
```

Or start the API and the [web UI](#ontology-manager-web-ui) together from the repo root:

```bash
pnpm dev
```

Defaults to `http://localhost:3000` (override with `PORT`).

- `GET /health` — liveness plus a `select 1` round trip to the database.
- `GET /api/objects/meta/types`, `/api/objects/meta/types/:type` and `/api/objects/meta/types/:type/actions` — the ontology's object types, properties, links and declared actions.
- `PATCH /api/objects/meta/types/:type` — edit a type's display `name`/`description`.
- `GET /api/objects/meta/audit` — the audit log of action invocations, filterable by `targetType`/`targetId`.
- `GET /api/objects/:type` and `/api/objects/:type/:id` — instance data for any registered object type, with links resolved one hop.
- `POST /api/objects/:type/:id/actions/:actionName` — invoke a declared action (e.g. `batch.deferStart`).

## API docs

With the server running:

- Swagger UI: http://localhost:3000/api/objects/docs
- OpenAPI 3.1 document: http://localhost:3000/api/objects/openapi.json

## Ontology Manager (web UI)

`apps/data-platform` is a browser UI for browsing and lightly editing the ontology: a left rail listing every object type with its row count, and a detail panel with inline-editable name/description plus tables of properties, links and actions.

```bash
cd apps/data-platform
pnpm dev
```

Opens on `http://localhost:5173`. It calls the ontology API under `/api`, proxied by Vite to `http://localhost:3000` — so the `apps/ontology` server (see above) must already be running, or the page shows a "could not reach the ontology API" callout with the command to start it.
