-- Brewery ontology: the 8 object types.
--
-- Identifiers are snake_case because unquoted identifiers fold to lowercase in
-- Postgres; camelCase would have to be double-quoted at every call site.
-- The mapping back to the ontology is 1:1 (currentTemp -> current_temp).
--
-- Ids are text rather than uuid so object keys stay human-readable (TANK-01,
-- BATCH-2026-014), which is how they tend to be referred to in an ontology.

-- ---------------------------------------------------------------- root types

CREATE TABLE recipe (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  ferm_days          integer NOT NULL CHECK (ferm_days > 0),
  -- Sampled curve, e.g. [{"day": 0, "gravity": 1.048}, {"day": 1, ...}].
  target_sugar_curve jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(target_sugar_curve) = 'array')
);

CREATE TABLE operator (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  certs         text[] NOT NULL DEFAULT '{}',
  current_shift text CHECK (current_shift IN ('DAY', 'SWING', 'NIGHT'))
);

CREATE TABLE tank (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  status       text NOT NULL DEFAULT 'IDLE'
    CHECK (status IN ('IDLE', 'FERMENTING', 'CLEANING', 'MAINTENANCE')),
  -- Litres.
  capacity     numeric(10, 2) NOT NULL CHECK (capacity > 0),
  -- Degrees Celsius; null until a sensor reports.
  current_temp numeric(5, 2)
);

CREATE TABLE line (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  status         text NOT NULL DEFAULT 'IDLE'
    CHECK (status IN ('IDLE', 'RUNNING', 'PAUSED', 'MAINTENANCE')),
  -- Bottles per hour.
  speed          integer CHECK (speed >= 0),
  -- FK added after bottling_run exists: line <-> bottling_run is a cycle.
  current_run_id text
);

-- ------------------------------------------------------------ process types

CREATE TABLE batch (
  id          text PRIMARY KEY,
  recipe_id   text NOT NULL REFERENCES recipe (id),
  tank_id     text REFERENCES tank (id),
  status      text NOT NULL DEFAULT 'PLANNED'
    CHECK (status IN ('PLANNED', 'FERMENTING', 'CONDITIONING', 'BOTTLED', 'CANCELLED')),
  operator_id text REFERENCES operator (id)
);

CREATE INDEX batch_recipe_id_idx ON batch (recipe_id);
CREATE INDEX batch_tank_id_idx ON batch (tank_id);
CREATE INDEX batch_operator_id_idx ON batch (operator_id);

-- A tank holds at most one active batch at a time.
CREATE UNIQUE INDEX batch_active_tank_idx ON batch (tank_id)
  WHERE tank_id IS NOT NULL AND status IN ('FERMENTING', 'CONDITIONING');

CREATE TABLE bottling_run (
  id         text PRIMARY KEY,
  batch_id   text NOT NULL REFERENCES batch (id),
  line_id    text NOT NULL REFERENCES line (id),
  status     text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'RUNNING', 'PAUSED', 'DONE', 'ABORTED')),
  started_at timestamptz
);

CREATE INDEX bottling_run_batch_id_idx ON bottling_run (batch_id);
CREATE INDEX bottling_run_line_id_idx ON bottling_run (line_id);

-- The other half of the cycle. Deferrable so a run and its line can be
-- inserted and pointed at each other inside one transaction.
ALTER TABLE line
  ADD CONSTRAINT line_current_run_id_fkey
  FOREIGN KEY (current_run_id) REFERENCES bottling_run (id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE quality_test (
  id          text PRIMARY KEY,
  batch_id    text NOT NULL REFERENCES batch (id),
  ph          numeric(4, 2) CHECK (ph BETWEEN 0 AND 14),
  -- Degrees Plato.
  sugar_level numeric(6, 2) CHECK (sugar_level >= 0),
  tested_by   text REFERENCES operator (id)
);

CREATE INDEX quality_test_batch_id_idx ON quality_test (batch_id);

-- Maintenance targets either a tank or a line, so target_id cannot be a plain
-- foreign key. target_type names which table it points into; Postgres will not
-- enforce that reference, so the application (or a trigger) has to.
CREATE TABLE maintenance_log (
  id          text PRIMARY KEY,
  target_type text NOT NULL CHECK (target_type IN ('TANK', 'LINE')),
  target_id   text NOT NULL,
  type        text NOT NULL
    CHECK (type IN ('CLEANING', 'REPAIR', 'INSPECTION', 'CALIBRATION')),
  status      text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
  started_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX maintenance_log_target_idx ON maintenance_log (target_type, target_id);
