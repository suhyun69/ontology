import { useEffect, useMemo, useState } from "react";
import {
  Alignment,
  Callout,
  Card,
  Classes,
  HTMLSelect,
  HTMLTable,
  Navbar,
  NonIdealState,
  Section,
  SectionCard,
  Spinner,
  Switch,
  Tag,
} from "@blueprintjs/core";
import type { Intent } from "@blueprintjs/core";
import { listInstances } from "./api.ts";
import type { Instance } from "./api.ts";
import { BatchDetail } from "./BatchDetail.tsx";
import { deviationFor, tanksServicedSince, toNumber } from "./batchAnalysis.ts";
import type { Deviation, DeviationBand, SugarCurve } from "./batchAnalysis.ts";
import { courseNow, courseNowAnchor, daysBeforeCourseNow } from "./courseNow.ts";

/** How far back "recent" reaches for tank maintenance. */
const MAINTENANCE_WINDOW_DAYS = 7;

const FERMENTING = "fermenting";

const BAND_INTENT: Record<DeviationBand, Intent> = {
  "on-track": "success",
  slipping: "warning",
  "off-target": "danger",
};

type BatchRow = {
  id: string;
  status: string;
  recipeId: string | null;
  recipeName: string;
  daysFermenting: number | null;
  tankId: string | null;
  tankName: string | null;
  deviation: Deviation | null;
  /** This batch's tank was serviced inside the window. */
  tankServicedRecently: boolean;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

// ------------------------------------------------------------------- data

function buildRows(
  batches: readonly Instance[],
  recipes: readonly Instance[],
  tanks: readonly Instance[],
  maintenance: readonly Instance[],
): BatchRow[] {
  const recipeById = new Map(recipes.map((recipe) => [String(recipe["id"]), recipe]));
  const tankById = new Map(tanks.map((tank) => [String(tank["id"]), tank]));

  const now = courseNow();
  const serviced = tanksServicedSince(
    maintenance,
    daysBeforeCourseNow(MAINTENANCE_WINDOW_DAYS),
    now,
  );

  return batches.map((batch) => {
    const recipeId = text(batch["recipeId"]);
    const recipe = recipeId === null ? undefined : recipeById.get(recipeId);
    const curve = (recipe?.["targetSugarCurve"] ?? null) as SugarCurve | null;

    const tankId = text(batch["assignedTankId"]);
    const tank = tankId === null ? undefined : tankById.get(tankId);

    return {
      id: String(batch["id"]),
      status: String(batch["status"] ?? ""),
      recipeId,
      recipeName: text(recipe?.["name"]) ?? recipeId ?? "—",
      daysFermenting: toNumber(batch["daysFermenting"]),
      tankId,
      tankName: text(tank?.["name"]),
      deviation: deviationFor(
        curve,
        toNumber(batch["daysFermenting"]),
        toNumber(batch["currentSugarLevel"]),
      ),
      tankServicedRecently: tankId !== null && serviced.has(tankId),
    };
  });
}

// ------------------------------------------------------------------- view

type BatchWorkspaceProps = {
  loadError: string | null;
};

export function BatchWorkspace({ loadError }: BatchWorkspaceProps) {
  const [rows, setRows] = useState<BatchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState("");
  const [tank, setTank] = useState("");
  const [behindOnly, setBehindOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // The table needs its batches, the curves to read them against, tank names
    // to label them, and the maintenance history behind the third metric.
    Promise.all([
      listInstances("batch"),
      listInstances("recipe"),
      listInstances("tank"),
      listInstances("maintenanceLog"),
    ])
      .then(([batches, recipes, tanks, maintenance]) => {
        if (cancelled) return;
        setRows(buildRows(batches.instances, recipes.instances, tanks.instances, maintenance.instances));
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const fermenting = useMemo(
    () => (rows ?? []).filter((row) => row.status === FERMENTING),
    [rows],
  );

  const statuses = useMemo(
    () => [...new Set((rows ?? []).map((row) => row.status))].sort(),
    [rows],
  );

  const tankOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows ?? []) {
      if (row.tankId !== null) seen.set(row.tankId, row.tankName ?? row.tankId);
    }
    return [...seen].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const visible = useMemo(
    () =>
      (rows ?? []).filter((row) => {
        if (status !== "" && row.status !== status) return false;
        if (tank !== "" && row.tankId !== tank) return false;
        if (behindOnly && row.deviation?.behind !== true) return false;
        return true;
      }),
    [rows, status, tank, behindOnly],
  );

  const selectedRow = (rows ?? []).find((row) => row.id === selected);
  const shownError = loadError ?? error;

  if (shownError !== null) {
    return (
      <Shell>
        <Callout intent="danger" icon="error" title="Could not reach the ontology API">
          {shownError}
          <p className="om-callout-hint">
            Start it with <code>pnpm dev</code> from the repository root, then reload.
          </p>
        </Callout>
      </Shell>
    );
  }

  if (rows === null) {
    return (
      <Shell>
        <NonIdealState icon={<Spinner />} title="Loading batches…" />
      </Shell>
    );
  }

  const behindCount = fermenting.filter((row) => row.deviation?.behind === true).length;
  const servicedCount = fermenting.filter((row) => row.tankServicedRecently).length;

  return (
    <Shell>
      <div className="bw-metrics">
        <Metric label="Fermenting Batches" value={fermenting.length} detail="status is fermenting" />
        <Metric
          label="Behind Target"
          value={behindCount}
          detail={`fermenting, ${SLIPPING_LABEL} or more above the curve`}
          intent={behindCount > 0 ? "danger" : "none"}
        />
        <Metric
          label="Recent Tank Maintenance"
          value={servicedCount}
          detail={`fermenting, tank serviced in the last ${MAINTENANCE_WINDOW_DAYS} days`}
          intent={servicedCount > 0 ? "warning" : "none"}
        />
      </div>

      <div className="bw-columns">
        <Section
          title="Batches"
          icon="th"
          rightElement={
            <Tag minimal round>
              {visible.length === rows.length ? rows.length : `${visible.length} of ${rows.length}`}
            </Tag>
          }
          compact
        >
          <SectionCard>
            <div className="bw-filters">
              <label className={Classes.TEXT_MUTED}>
                Status
                <HTMLSelect
                  value={status}
                  onChange={(event) => setStatus(event.currentTarget.value)}
                  options={[{ label: "All", value: "" }, ...statuses]}
                />
              </label>

              <label className={Classes.TEXT_MUTED}>
                Tank
                <HTMLSelect
                  value={tank}
                  onChange={(event) => setTank(event.currentTarget.value)}
                  options={[
                    { label: "All", value: "" },
                    ...tankOptions.map(([id, name]) => ({ label: `${name} (${id})`, value: id })),
                  ]}
                />
              </label>

              <Switch
                className="bw-filter-toggle"
                checked={behindOnly}
                label="Behind target only"
                inline
                onChange={(event) => setBehindOnly(event.currentTarget.checked)}
              />
            </div>
          </SectionCard>

          <SectionCard padded={false}>
            <BatchTable rows={visible} selected={selected} onSelect={setSelected} />
          </SectionCard>
        </Section>

        <div className="bw-investigation">
          {selectedRow === undefined ? (
            <Section title="Investigation" icon="search-template" compact>
              <SectionCard>
                <span className={Classes.TEXT_MUTED}>Select a batch to investigate.</span>
              </SectionCard>
            </Section>
          ) : (
            <BatchDetail
              key={selectedRow.id}
              batchId={selectedRow.id}
              tankId={selectedRow.tankId}
            />
          )}
        </div>
      </div>
    </Shell>
  );
}

const SLIPPING_LABEL = "0.008";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="om-root">
      <Navbar className="om-navbar">
        <Navbar.Group align={Alignment.START}>
          <Navbar.Heading className="om-brand">Batch Investigation</Navbar.Heading>
          <Navbar.Divider />
          <Tag minimal icon="time">
            {courseNowAnchor === null
              ? "real clock"
              : `as of ${courseNow().toLocaleDateString()}`}
          </Tag>
        </Navbar.Group>
      </Navbar>

      <div className="om-body">
        <main className="om-main">{children}</main>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  intent = "none",
}: {
  label: string;
  value: number;
  detail: string;
  intent?: Intent;
}) {
  return (
    <Card className="bw-metric">
      <div className={`bw-metric-label ${Classes.TEXT_MUTED}`}>{label}</div>
      <div className={`bw-metric-value ${intent === "none" ? "" : Classes.intentClass(intent)}`}>
        {value}
      </div>
      <div className={`bw-metric-detail ${Classes.TEXT_MUTED}`}>{detail}</div>
    </Card>
  );
}

// ------------------------------------------------------------------ table

function BatchTable({
  rows,
  selected,
  onSelect,
}: {
  rows: readonly BatchRow[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  if (rows.length === 0) {
    return <NonIdealState icon="filter" title="No batches match these filters" />;
  }

  return (
    <HTMLTable className="bw-table" compact interactive striped>
      <thead>
        <tr>
          <th>Batch</th>
          <th>Recipe</th>
          <th>Sugar vs target</th>
          <th>Days</th>
          <th>Tank</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            className={row.id === selected ? "bw-row-selected" : undefined}
            onClick={() => onSelect(row.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(row.id);
              }
            }}
          >
            <td className="om-mono">{row.id}</td>
            <td>{row.recipeName}</td>
            <td>
              <SugarCell deviation={row.deviation} />
            </td>
            <td>{row.daysFermenting ?? <Muted>—</Muted>}</td>
            <td>
              {row.tankName === null ? (
                <Muted>—</Muted>
              ) : (
                <span className="bw-tank">
                  {row.tankName}
                  {row.tankServicedRecently && (
                    <Tag minimal intent="warning" icon="wrench" title="Serviced recently">
                      serviced
                    </Tag>
                  )}
                </span>
              )}
            </td>
            <td>
              <Tag minimal>{row.status}</Tag>
            </td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className={Classes.TEXT_MUTED}>{children}</span>;
}

/** Current reading, how far it sits from the curve, and the target itself. */
function SugarCell({ deviation }: { deviation: Deviation | null }) {
  if (deviation === null) return <Muted>—</Muted>;

  const sign = deviation.delta > 0 ? "+" : "";

  return (
    <span className="bw-sugar">
      <span className="om-mono">{deviation.current.toFixed(3)}</span>
      <Tag minimal intent={BAND_INTENT[deviation.band]}>
        {sign}
        {deviation.delta.toFixed(3)}
      </Tag>
      <span className={`om-mono ${Classes.TEXT_MUTED}`}>vs {deviation.target.toFixed(3)}</span>
    </span>
  );
}
