# ontology

pnpm workspace running TypeScript directly on Node (no build step). `apps/ontology` serves a generic ontology API over a Postgres (Neon) database, driven entirely by its own metadata tables.

## Setup

```bash
pnpm install
echo 'DATABASE_URL=postgres://...' >> .env
```

`DATABASE_URL` must point at a database with the `manufacturing` schema applied (see [sql/manufacturing.sql](sql/manufacturing.sql)):

```bash
pnpm run-sql sql/manufacturing.sql
```

## Running the server

```bash
cd apps/ontology
pnpm dev     # restarts on save
pnpm start   # single run
```

Defaults to `http://localhost:3000` (override with `PORT`).

- `GET /health` — liveness plus a `select 1` round trip to the database.
- `GET /api/objects/meta/types` and `/api/objects/meta/types/:type` — the ontology's object types, properties, links and actions.
- `GET /api/objects/:type` and `/api/objects/:type/:id` — instance data for any registered object type, with links resolved one hop.

## API docs

With the server running:

- Swagger UI: http://localhost:3000/api/objects/docs
- OpenAPI 3.1 document: http://localhost:3000/api/objects/openapi.json
