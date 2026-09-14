-- The manufacturing ontology: instance data plus the metadata describing it.
--
-- Two layers live side by side in one schema:
--
--   instance tables   the brewery's actual rows (tanks, batches, ...). Ids are
--                     text so object keys stay human-readable (T-12, B-2105),
--                     and foreign keys between them match those text ids.
--
--   metadata tables   the ontology itself — which object types exist, what
--                     properties and links they have, what actions can be run.
--                     These use generated UUID keys and the three-identifier
--                     pattern: `id` (stable, internal), `api_name` (stable,
--                     external, referenced by clients), `name` (display text,
--                     freely editable without breaking anything).
--
-- Column names are snake_case throughout, because unquoted identifiers fold to
-- lowercase in Postgres; the metadata carries the camelCase api_name that
-- clients see, so the mapping is recorded rather than guessed.
--
-- Re-runnable: the schema is dropped and rebuilt, so every object below is
-- recreated from scratch. Anything written into manufacturing.* is lost.

DROP SCHEMA IF EXISTS manufacturing CASCADE;
CREATE SCHEMA manufacturing;

SET search_path TO manufacturing;

-- ========================================================= instance tables

-- Referenced tables come first so the foreign keys below resolve.

CREATE TABLE operator (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  certifications text[] NOT NULL DEFAULT '{}',
  shift          text CHECK (shift IN ('day', 'swing', 'night'))
);

CREATE TABLE recipe (
  id                   text PRIMARY KEY,
  name                 text NOT NULL,
  -- Sampled curve: [{"day": 0, "gravity": 1.048}, ...].
  target_sugar_curve   jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(target_sugar_curve) = 'array'),
  fermentation_days    integer NOT NULL CHECK (fermentation_days > 0),
  required_ingredients text[] NOT NULL DEFAULT '{}',
  notes                text
);

CREATE TABLE tank (
  id                  text PRIMARY KEY,
  name                text NOT NULL,
  -- Litres.
  capacity            numeric(10, 2) NOT NULL CHECK (capacity > 0),
  status              text NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'fermenting', 'cleaning', 'maintenance')),
  -- Degrees Celsius; null until a sensor reports.
  current_temperature numeric(5, 2),
  commissioned_at     timestamptz
);

CREATE TABLE line (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  status          text NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'running', 'paused', 'maintenance')),
  commissioned_at timestamptz
);

CREATE TABLE batch (
  id                  text PRIMARY KEY,
  recipe_id           text NOT NULL REFERENCES recipe (id),
  -- Litres.
  target_volume       numeric(10, 2) NOT NULL CHECK (target_volume > 0),
  status              text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'fermenting', 'conditioning', 'bottled', 'cancelled')),
  planned_start       timestamptz,
  -- Degrees Plato.
  current_sugar_level numeric(6, 2) CHECK (current_sugar_level >= 0),
  current_temperature numeric(5, 2),
  days_fermenting     integer NOT NULL DEFAULT 0 CHECK (days_fermenting >= 0),
  assigned_tank_id    text REFERENCES tank (id),
  assigned_operator_id text REFERENCES operator (id),
  last_operator_note  text
);

CREATE INDEX batch_recipe_id_idx ON batch (recipe_id);
CREATE INDEX batch_assigned_tank_id_idx ON batch (assigned_tank_id);
CREATE INDEX batch_assigned_operator_id_idx ON batch (assigned_operator_id);

-- A tank holds at most one in-flight batch at a time.
CREATE UNIQUE INDEX batch_active_tank_idx ON batch (assigned_tank_id)
  WHERE assigned_tank_id IS NOT NULL AND status IN ('fermenting', 'conditioning');

CREATE TABLE bottling_run (
  id                   text PRIMARY KEY,
  batch_id             text NOT NULL REFERENCES batch (id),
  line_id              text NOT NULL REFERENCES line (id),
  planned_start        timestamptz,
  status               text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'paused', 'done', 'aborted')),
  assigned_operator_id text REFERENCES operator (id)
);

CREATE INDEX bottling_run_batch_id_idx ON bottling_run (batch_id);
CREATE INDEX bottling_run_line_id_idx ON bottling_run (line_id);

CREATE TABLE quality_test (
  id          text PRIMARY KEY,
  batch_id    text NOT NULL REFERENCES batch (id),
  test_date   timestamptz NOT NULL DEFAULT now(),
  ph          numeric(4, 2) CHECK (ph BETWEEN 0 AND 14),
  -- Degrees Plato.
  sugar_level numeric(6, 2) CHECK (sugar_level >= 0),
  notes       text,
  -- Free text rather than a foreign key: tests are sometimes signed off by an
  -- external lab that has no operator row.
  tested_by   text
);

CREATE INDEX quality_test_batch_id_idx ON quality_test (batch_id);

-- Maintenance targets either a tank or a line, so target_id cannot be a plain
-- foreign key. target_type names the object type it points at; Postgres will
-- not enforce that reference, so the application has to.
CREATE TABLE maintenance_log (
  id           text PRIMARY KEY,
  target_type  text NOT NULL CHECK (target_type IN ('Tank', 'Line')),
  target_id    text NOT NULL,
  type         text NOT NULL
    CHECK (type IN ('cleaning', 'repair', 'inspection', 'calibration')),
  status       text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  notes        text
);

CREATE INDEX maintenance_log_target_idx ON maintenance_log (target_type, target_id);

-- ========================================================= metadata tables

CREATE TABLE object_type (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable external handle. Clients address the type by this, never by id or name.
  api_name         text NOT NULL UNIQUE,
  -- Display text. Editable without breaking any client.
  name             text NOT NULL,
  description      text,
  status           text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'experimental', 'deprecated')),
  visibility       text NOT NULL DEFAULT 'normal'
    CHECK (visibility IN ('normal', 'prominent', 'hidden')),
  point_of_contact text,
  edits_enabled    boolean NOT NULL DEFAULT true,
  -- Where the instance rows live.
  schema           text NOT NULL DEFAULT 'manufacturing',
  datasource_table text NOT NULL
);

CREATE TABLE property (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type_id    uuid NOT NULL REFERENCES object_type (id) ON DELETE CASCADE,
  -- Unique per object type, not globally: every type has an `id`, most have a
  -- `status`. A property is only ever addressed in the context of its type.
  api_name          text NOT NULL,
  name              text NOT NULL,
  data_type         text NOT NULL
    CHECK (data_type IN ('string', 'integer', 'double', 'boolean',
                         'timestamp', 'date', 'string_array', 'json')),
  required          boolean NOT NULL DEFAULT false,
  -- The property shown when an instance is rendered as a single line.
  is_title          boolean NOT NULL DEFAULT false,
  is_primary_key    boolean NOT NULL DEFAULT false,
  datasource_column text NOT NULL,
  UNIQUE (object_type_id, api_name)
);

-- Exactly one title and one primary key per object type.
CREATE UNIQUE INDEX property_one_title_idx ON property (object_type_id) WHERE is_title;
CREATE UNIQUE INDEX property_one_pk_idx ON property (object_type_id) WHERE is_primary_key;

CREATE TABLE link (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Forward direction: how the source type names the target.
  api_name         text NOT NULL,
  name             text NOT NULL,
  -- Reverse direction: how the target type names the source. One row carries
  -- both halves so the pair cannot drift apart.
  inverse_api_name text NOT NULL,
  inverse_name     text NOT NULL,
  source_type_id   uuid NOT NULL REFERENCES object_type (id) ON DELETE CASCADE,
  target_type_id   uuid NOT NULL REFERENCES object_type (id) ON DELETE CASCADE,
  -- The foreign key column on the source that realises the link.
  via_property_id  uuid NOT NULL REFERENCES property (id) ON DELETE CASCADE,
  cardinality      text NOT NULL
    CHECK (cardinality IN ('one_to_one', 'one_to_many', 'many_to_one', 'many_to_many')),
  UNIQUE (source_type_id, api_name),
  UNIQUE (target_type_id, inverse_api_name)
);

CREATE TABLE action_type (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type_id   uuid NOT NULL REFERENCES object_type (id) ON DELETE CASCADE,
  api_name         text NOT NULL,
  name             text NOT NULL,
  description      text,
  -- JSON Schema validated against the request body before the action runs.
  parameter_schema jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(parameter_schema) = 'object'),
  UNIQUE (object_type_id, api_name)
);

-- What actually ran. The *_api_name columns are snapshots taken at write time:
-- an action or type can be renamed or dropped afterwards, and the log still has
-- to say what was invoked. The id columns therefore null out rather than cascade.
CREATE TABLE audit_log (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type_id       uuid REFERENCES action_type (id) ON DELETE SET NULL,
  action_api_name      text NOT NULL,
  target_type_id       uuid REFERENCES object_type (id) ON DELETE SET NULL,
  target_type_api_name text NOT NULL,
  -- The instance id the action ran against, e.g. B-2105.
  target_id            text NOT NULL,
  actor                text NOT NULL,
  params               jsonb NOT NULL DEFAULT '{}'::jsonb,
  result               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_target_idx ON audit_log (target_type_api_name, target_id);
CREATE INDEX audit_log_created_at_idx ON audit_log (created_at DESC);

-- ==================================================== metadata: object types

INSERT INTO object_type (api_name, name, description, point_of_contact, datasource_table) VALUES
  ('Tank', 'Tank', 'A fermentation vessel.', 'brewing-ops@brewery.example', 'tank'),
  ('Line', 'Bottling Line', 'A bottling line on the packaging floor.', 'packaging@brewery.example', 'line'),
  ('Batch', 'Batch', 'A production run of one recipe, from planning to bottling.', 'brewing-ops@brewery.example', 'batch'),
  ('BottlingRun', 'Bottling Run', 'A batch scheduled onto a bottling line.', 'packaging@brewery.example', 'bottling_run'),
  ('MaintenanceLog', 'Maintenance Log', 'Maintenance work against a tank or a line.', 'facilities@brewery.example', 'maintenance_log'),
  ('Operator', 'Operator', 'A person on the brewing or packaging floor.', 'people-ops@brewery.example', 'operator'),
  ('Recipe', 'Recipe', 'The specification a batch is brewed against.', 'brewing-ops@brewery.example', 'recipe'),
  ('QualityTest', 'Quality Test', 'A lab measurement taken against a batch.', 'qa@brewery.example', 'quality_test');

-- ====================================================== metadata: properties

-- api_name is the camelCase handle clients use; datasource_column is the
-- snake_case column it reads from. Types with a `name` column title on it;
-- the rest fall back to their id.
INSERT INTO property (object_type_id, api_name, name, data_type, required, is_title, is_primary_key, datasource_column)
SELECT ot.id, p.api_name, p.name, p.data_type, p.required, p.is_title, p.is_primary_key, p.datasource_column
FROM (VALUES
  -- Tank
  ('Tank', 'id', 'ID', 'string', true, false, true, 'id'),
  ('Tank', 'name', 'Name', 'string', true, true, false, 'name'),
  ('Tank', 'capacity', 'Capacity (L)', 'double', true, false, false, 'capacity'),
  ('Tank', 'status', 'Status', 'string', true, false, false, 'status'),
  ('Tank', 'currentTemperature', 'Current Temperature (°C)', 'double', false, false, false, 'current_temperature'),
  ('Tank', 'commissionedAt', 'Commissioned At', 'timestamp', false, false, false, 'commissioned_at'),

  -- Line
  ('Line', 'id', 'ID', 'string', true, false, true, 'id'),
  ('Line', 'name', 'Name', 'string', true, true, false, 'name'),
  ('Line', 'status', 'Status', 'string', true, false, false, 'status'),
  ('Line', 'commissionedAt', 'Commissioned At', 'timestamp', false, false, false, 'commissioned_at'),

  -- Batch
  ('Batch', 'id', 'ID', 'string', true, true, true, 'id'),
  ('Batch', 'recipeId', 'Recipe ID', 'string', true, false, false, 'recipe_id'),
  ('Batch', 'targetVolume', 'Target Volume (L)', 'double', true, false, false, 'target_volume'),
  ('Batch', 'status', 'Status', 'string', true, false, false, 'status'),
  ('Batch', 'plannedStart', 'Planned Start', 'timestamp', false, false, false, 'planned_start'),
  ('Batch', 'currentSugarLevel', 'Current Sugar Level (°P)', 'double', false, false, false, 'current_sugar_level'),
  ('Batch', 'currentTemperature', 'Current Temperature (°C)', 'double', false, false, false, 'current_temperature'),
  ('Batch', 'daysFermenting', 'Days Fermenting', 'integer', true, false, false, 'days_fermenting'),
  ('Batch', 'assignedTankId', 'Assigned Tank ID', 'string', false, false, false, 'assigned_tank_id'),
  ('Batch', 'assignedOperatorId', 'Assigned Operator ID', 'string', false, false, false, 'assigned_operator_id'),
  ('Batch', 'lastOperatorNote', 'Last Operator Note', 'string', false, false, false, 'last_operator_note'),

  -- BottlingRun
  ('BottlingRun', 'id', 'ID', 'string', true, true, true, 'id'),
  ('BottlingRun', 'batchId', 'Batch ID', 'string', true, false, false, 'batch_id'),
  ('BottlingRun', 'lineId', 'Line ID', 'string', true, false, false, 'line_id'),
  ('BottlingRun', 'plannedStart', 'Planned Start', 'timestamp', false, false, false, 'planned_start'),
  ('BottlingRun', 'status', 'Status', 'string', true, false, false, 'status'),
  ('BottlingRun', 'assignedOperatorId', 'Assigned Operator ID', 'string', false, false, false, 'assigned_operator_id'),

  -- MaintenanceLog
  ('MaintenanceLog', 'id', 'ID', 'string', true, true, true, 'id'),
  ('MaintenanceLog', 'targetType', 'Target Type', 'string', true, false, false, 'target_type'),
  ('MaintenanceLog', 'targetId', 'Target ID', 'string', true, false, false, 'target_id'),
  ('MaintenanceLog', 'type', 'Type', 'string', true, false, false, 'type'),
  ('MaintenanceLog', 'status', 'Status', 'string', true, false, false, 'status'),
  ('MaintenanceLog', 'startedAt', 'Started At', 'timestamp', true, false, false, 'started_at'),
  ('MaintenanceLog', 'completedAt', 'Completed At', 'timestamp', false, false, false, 'completed_at'),
  ('MaintenanceLog', 'notes', 'Notes', 'string', false, false, false, 'notes'),

  -- Operator
  ('Operator', 'id', 'ID', 'string', true, false, true, 'id'),
  ('Operator', 'name', 'Name', 'string', true, true, false, 'name'),
  ('Operator', 'certifications', 'Certifications', 'string_array', true, false, false, 'certifications'),
  ('Operator', 'shift', 'Shift', 'string', false, false, false, 'shift'),

  -- Recipe
  ('Recipe', 'id', 'ID', 'string', true, false, true, 'id'),
  ('Recipe', 'name', 'Name', 'string', true, true, false, 'name'),
  ('Recipe', 'targetSugarCurve', 'Target Sugar Curve', 'json', true, false, false, 'target_sugar_curve'),
  ('Recipe', 'fermentationDays', 'Fermentation Days', 'integer', true, false, false, 'fermentation_days'),
  ('Recipe', 'requiredIngredients', 'Required Ingredients', 'string_array', true, false, false, 'required_ingredients'),
  ('Recipe', 'notes', 'Notes', 'string', false, false, false, 'notes'),

  -- QualityTest
  ('QualityTest', 'id', 'ID', 'string', true, true, true, 'id'),
  ('QualityTest', 'batchId', 'Batch ID', 'string', true, false, false, 'batch_id'),
  ('QualityTest', 'testDate', 'Test Date', 'timestamp', true, false, false, 'test_date'),
  ('QualityTest', 'ph', 'pH', 'double', false, false, false, 'ph'),
  ('QualityTest', 'sugarLevel', 'Sugar Level (°P)', 'double', false, false, false, 'sugar_level'),
  ('QualityTest', 'notes', 'Notes', 'string', false, false, false, 'notes'),
  ('QualityTest', 'testedBy', 'Tested By', 'string', false, false, false, 'tested_by')
) AS p (object_api_name, api_name, name, data_type, required, is_title, is_primary_key, datasource_column)
JOIN object_type ot ON ot.api_name = p.object_api_name;

-- =========================================================== metadata: links

-- Each row carries both directions. via_property_id is resolved against the
-- source type, so the link is anchored to a column that actually exists.
INSERT INTO link (api_name, name, inverse_api_name, inverse_name, source_type_id, target_type_id, via_property_id, cardinality)
SELECT l.api_name, l.name, l.inverse_api_name, l.inverse_name, src.id, tgt.id, p.id, l.cardinality
FROM (VALUES
  ('Batch', 'assignedTank', 'Assigned Tank', 'assignedBatches', 'Assigned Batches', 'Tank', 'assignedTankId', 'many_to_one'),
  ('Batch', 'assignedOperator', 'Assigned Operator', 'assignedBatches', 'Assigned Batches', 'Operator', 'assignedOperatorId', 'many_to_one'),
  ('Batch', 'recipe', 'Recipe', 'batches', 'Batches', 'Recipe', 'recipeId', 'many_to_one'),
  ('BottlingRun', 'batch', 'Batch', 'bottlingRuns', 'Bottling Runs', 'Batch', 'batchId', 'many_to_one'),
  ('BottlingRun', 'line', 'Line', 'bottlingRuns', 'Bottling Runs', 'Line', 'lineId', 'many_to_one'),
  ('QualityTest', 'batch', 'Batch', 'qualityTests', 'Quality Tests', 'Batch', 'batchId', 'many_to_one')
) AS l (source_api_name, api_name, name, inverse_api_name, inverse_name, target_api_name, via_property_api_name, cardinality)
JOIN object_type src ON src.api_name = l.source_api_name
JOIN object_type tgt ON tgt.api_name = l.target_api_name
JOIN property p ON p.object_type_id = src.id AND p.api_name = l.via_property_api_name;

-- ==================================================== metadata: action types

INSERT INTO action_type (object_type_id, api_name, name, description, parameter_schema)
SELECT ot.id,
       'deferStart',
       'Defer Start',
       'Postpone the batch''s planned start date',
       '{
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "properties": {
            "newPlannedStart": {
              "type": "string",
              "format": "date-time",
              "description": "The new planned start, as an ISO 8601 datetime."
            }
          },
          "required": ["newPlannedStart"],
          "additionalProperties": false
        }'::jsonb
FROM object_type ot
WHERE ot.api_name = 'Batch';

-- ================================================================ test data

-- Just enough to exercise a read route and the link traversals above.

INSERT INTO tank (id, name, capacity, status, current_temperature, commissioned_at) VALUES
  ('T-12', 'Tank 12', 5000.00, 'fermenting', 11.40, '2021-03-02T09:00:00Z');

INSERT INTO recipe (id, name, target_sugar_curve, fermentation_days, required_ingredients, notes) VALUES
  ('REC-LAGER-V3', 'Helles Lager v3',
   '[{"day": 0,  "gravity": 1.048},
     {"day": 3,  "gravity": 1.032},
     {"day": 7,  "gravity": 1.018},
     {"day": 12, "gravity": 1.011},
     {"day": 18, "gravity": 1.009}]'::jsonb,
   18,
   '{"pilsner malt", "hallertau hops", "lager yeast W-34/70", "brewing water"}',
   'Hold at 11°C through day 12, then free rise for the diacetyl rest.');

INSERT INTO operator (id, name, certifications, shift) VALUES
  ('OP-PARK-KW', 'Park Kyungwon', '{"forklift", "confined space", "cellar operations"}', 'day');

-- Note the two different units in play: the recipe curve is sampled as specific
-- gravity, while current_sugar_level is degrees Plato. At day 8 the curve
-- interpolates to roughly 1.0166 SG, which is (1.0166 - 1) * 1000 / 4 ≈ 4.15 °P.
INSERT INTO batch (
  id, recipe_id, target_volume, status, planned_start,
  current_sugar_level, current_temperature, days_fermenting,
  assigned_tank_id, assigned_operator_id, last_operator_note
) VALUES
  ('B-2105', 'REC-LAGER-V3', 4800.00, 'fermenting', '2026-09-06T07:00:00Z',
   4.15, 11.40, 8,
   'T-12', 'OP-PARK-KW', 'Krausen dropped overnight; gravity tracking the curve.');
