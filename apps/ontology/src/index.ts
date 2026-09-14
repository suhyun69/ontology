import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { sql } from "kysely";
import { closeDb, db } from "./db.ts";
import { HttpError } from "./errors.ts";
import { metaRoutes } from "./routes/meta.ts";
import { objectRoutes } from "./routes/objects.ts";

const app = new Hono();

// Mounted before the instance routes: "meta" would otherwise be a candidate
// for :type, and /api/objects/meta/types would read as type "meta", id "types".
app.route("/api/objects/meta", metaRoutes);
app.route("/api/objects", objectRoutes);

app.onError((error, c) => {
  if (error instanceof HttpError) {
    return c.json({ error: error.message }, error.status);
  }
  console.error(error);
  return c.json({ error: "internal server error" }, 500);
});

// Reports process liveness and whether the database actually answers, so a
// failing health check distinguishes "server down" from "server up, db down".
app.get("/health", async (c) => {
  const startedAt = performance.now();
  try {
    await sql`select 1`.execute(db);
    return c.json({
      status: "ok",
      db: { status: "up", latencyMs: Math.round(performance.now() - startedAt) },
      uptimeSeconds: Math.round(process.uptime()),
    });
  } catch (error) {
    return c.json(
      {
        status: "degraded",
        db: { status: "down", error: error instanceof Error ? error.message : String(error) },
        uptimeSeconds: Math.round(process.uptime()),
      },
      503,
    );
  }
});

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error(`PORT must be a valid port number, got ${process.env.PORT}`);
}

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`ontology listening on http://localhost:${info.port}`);
});

// --watch restarts the process on every save, so release the port and the pool
// rather than leave the next run fighting for them.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
  });
}
