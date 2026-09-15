import { useEffect, useState } from "react";
import {
  Callout,
  Classes,
  Collapse,
  Icon,
  NonIdealState,
  Section,
  SectionCard,
  Spinner,
  Tag,
} from "@blueprintjs/core";
import type { Intent } from "@blueprintjs/core";
import { listInstances, loadAudit, loadInstance } from "./api.ts";
import type { AuditEntry, Instance, InstanceDetail } from "./api.ts";
import {
  bracketingDays,
  curvePoints,
  deviationFor,
  fermentationWindow,
  toNumber,
  withinWindow,
} from "./batchAnalysis.ts";
import type { DeviationBand, SugarCurve, Window } from "./batchAnalysis.ts";
import { courseNow } from "./courseNow.ts";

const BAND_INTENT: Record<DeviationBand, Intent> = {
  "on-track": "success",
  slipping: "warning",
  "off-target": "danger",
};

type BatchDetailProps = {
  batchId: string;
  /** Known from the row already, so the maintenance fetch need not wait on the batch. */
  tankId: string | null;
};

type Loaded = {
  detail: InstanceDetail;
  maintenance: Instance[];
  audit: AuditEntry[];
  auditTruncated: boolean;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** A link's value as a list, whatever its cardinality. */
function linkTargets(detail: InstanceDetail, apiName: string): Instance[] {
  const link = detail.links[apiName];
  if (link === undefined || link.value === null) return [];
  return Array.isArray(link.value) ? link.value : [link.value];
}

function linkTarget(detail: InstanceDetail, apiName: string): Instance | null {
  return linkTargets(detail, apiName).at(0) ?? null;
}

function formatDate(value: unknown): string {
  const stamp = text(value);
  if (stamp === null) return "—";

  const parsed = new Date(stamp);
  return Number.isNaN(parsed.getTime()) ? stamp : parsed.toLocaleDateString();
}

// ------------------------------------------------------------------- view

export function BatchDetail({ batchId, tankId }: BatchDetailProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);

    // All three go at once: the tank is already known from the row, so the
    // maintenance query does not have to wait for the batch to come back.
    Promise.all([
      loadInstance("batch", batchId),
      tankId === null
        ? Promise.resolve(null)
        : listInstances("maintenanceLog", { targetType: "tank", targetId: tankId }),
      loadAudit("batch", batchId),
    ])
      .then(([detail, maintenance, audit]) => {
        if (cancelled) return;
        setLoaded({
          detail,
          maintenance: maintenance?.instances ?? [],
          audit: audit.entries,
          auditTruncated: audit.count >= audit.limit,
        });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [batchId, tankId]);

  if (error !== null) {
    return (
      <Callout intent="danger" icon="error" title="Could not load this batch">
        {error}
      </Callout>
    );
  }

  if (loaded === null) {
    return <NonIdealState icon={<Spinner />} title="Loading batch…" />;
  }

  const { detail, maintenance, audit, auditTruncated } = loaded;
  const props = detail.properties;

  const recipe = linkTarget(detail, "recipe");
  const tank = linkTarget(detail, "assignedTank");
  const qualityTests = linkTargets(detail, "qualityTests");

  const day = toNumber(props["daysFermenting"]);
  const curve = (recipe?.["targetSugarCurve"] ?? null) as SugarCurve | null;
  const deviation = deviationFor(curve, day, toNumber(props["currentSugarLevel"]));
  const window = fermentationWindow(text(props["plannedStart"]), day, courseNow());

  const servicedDuringFermentation = maintenance.filter((log) =>
    withinWindow(log["completedAt"] ?? log["startedAt"], window),
  ).length;

  return (
    <div className="bd-root">
      <Section title="Batch" icon="cube" collapsible collapseProps={{ defaultIsOpen: true }} compact>
        <SectionCard>
          <Facts
            rows={[
              [
                "Sugar level",
                deviation === null ? (
                  "—"
                ) : (
                  <span className="bw-sugar">
                    <span className="om-mono">{deviation.current.toFixed(3)}</span>
                    <Tag minimal intent={BAND_INTENT[deviation.band]}>
                      {deviation.delta > 0 ? "+" : ""}
                      {deviation.delta.toFixed(3)}
                    </Tag>
                    <span className={`om-mono ${Classes.TEXT_MUTED}`}>
                      vs {deviation.target.toFixed(3)}
                    </span>
                  </span>
                ),
              ],
              ["Temperature", text(props["currentTemperature"]) ?? "—"],
              ["Days fermenting", day === null ? "—" : String(day)],
              ["Planned start", formatDate(props["plannedStart"])],
              ["Last operator note", text(props["lastOperatorNote"]) ?? "—"],
            ]}
          />
        </SectionCard>
      </Section>

      <Section title="Recipe" icon="book" collapsible collapseProps={{ defaultIsOpen: true }} compact>
        <SectionCard>
          {recipe === null ? (
            <Muted>No recipe linked.</Muted>
          ) : (
            <>
              <Facts
                rows={[
                  ["Name", text(recipe["name"]) ?? "—"],
                  ["Fermentation days", String(recipe["fermentationDays"] ?? "—")],
                  ["Sensitivity notes", text(recipe["notes"]) ?? "—"],
                ]}
              />
              <CurveStrip curve={curve} day={day} target={deviation?.target ?? null} />
            </>
          )}
        </SectionCard>
      </Section>

      <Section
        title="Tank + Maintenance"
        icon="wrench"
        collapsible
        collapseProps={{ defaultIsOpen: true }}
        compact
        // Spread rather than passed as undefined: rightElement is declared
        // optional without undefined in its type, which exactOptionalPropertyTypes
        // takes at its word.
        {...(servicedDuringFermentation > 0
          ? {
              rightElement: (
                <Tag minimal intent="warning">
                  {servicedDuringFermentation} during fermentation
                </Tag>
              ),
            }
          : {})}
      >
        <SectionCard>
          {tank === null ? (
            <Muted>No tank assigned.</Muted>
          ) : (
            <Facts
              rows={[
                ["Tank", text(tank["name"]) ?? String(tank["id"] ?? "—")],
                ["Status", <Tag minimal>{String(tank["status"] ?? "—")}</Tag>],
              ]}
            />
          )}

          <MaintenanceList logs={maintenance} window={window} />
        </SectionCard>
      </Section>

      <Section
        title="Quality Tests"
        icon="lab-test"
        collapsible
        collapseProps={{ defaultIsOpen: true }}
        compact
        rightElement={<Tag minimal round>{qualityTests.length}</Tag>}
      >
        <SectionCard>
          {qualityTests.length === 0 ? (
            <Muted>No quality tests recorded.</Muted>
          ) : (
            qualityTests.map((test, index) => (
              <div className="bd-entry" key={String(test["id"] ?? index)}>
                <div className="bd-entry-head">
                  <span className="om-mono">{String(test["id"] ?? "—")}</span>
                  <span className={Classes.TEXT_MUTED}>{formatDate(test["testDate"])}</span>
                </div>
                <div className="bd-chips">
                  <Tag minimal>pH {String(test["pH"] ?? "—")}</Tag>
                  <Tag minimal>sugar {String(test["sugarLevel"] ?? "—")}</Tag>
                  <Tag minimal icon="person">
                    {text(test["testedBy"]) ?? "unattributed"}
                  </Tag>
                </div>
                {text(test["notes"]) !== null && (
                  <div className={Classes.RUNNING_TEXT}>{String(test["notes"])}</div>
                )}
              </div>
            ))
          )}
        </SectionCard>
      </Section>

      <Section
        title="Audit"
        icon="history"
        collapsible
        collapseProps={{ defaultIsOpen: false }}
        compact
        rightElement={<Tag minimal round>{audit.length}</Tag>}
      >
        <SectionCard>
          {auditTruncated && (
            <Callout intent="warning" icon="warning-sign" compact>
              Showing the most recent {audit.length}; there may be more.
            </Callout>
          )}
          {audit.length === 0 ? (
            <Muted>Nothing has run against this batch.</Muted>
          ) : (
            audit.map((entry, index) => (
              <AuditRow key={`${entry.createdAt}:${index}`} entry={entry} />
            ))
          )}
        </SectionCard>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function Muted({ children }: { children: React.ReactNode }) {
  return <span className={Classes.TEXT_MUTED}>{children}</span>;
}

function Facts({ rows }: { rows: readonly [string, React.ReactNode][] }) {
  return (
    <dl className="bd-facts">
      {rows.map(([label, value]) => (
        <div className="bd-fact" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The recipe's curve, with the points this batch's target was read from marked.
 *
 * A batch rarely sits on a sampled day, so the marked points are the pair it
 * falls between and the figure below is the interpolation across them.
 */
function CurveStrip({
  curve,
  day,
  target,
}: {
  curve: SugarCurve | null;
  day: number | null;
  target: number | null;
}) {
  if (curve === null) return null;

  const points = curvePoints(curve);
  if (points.length === 0) return null;

  const marked = day === null ? new Set<number>() : bracketingDays(curve, day);

  return (
    <div className="bd-curve">
      <div className={`bd-curve-label ${Classes.TEXT_MUTED}`}>Target sugar curve</div>
      <div className="bd-chips">
        {points.map((point) => (
          <Tag
            key={point.day}
            minimal={!marked.has(point.day)}
            intent={marked.has(point.day) ? "primary" : "none"}
          >
            day {point.day} · {point.gravity.toFixed(3)}
          </Tag>
        ))}
      </div>
      {day !== null && target !== null && (
        <div className={Classes.TEXT_MUTED}>
          Target at day {day}: <strong className="om-mono">{target.toFixed(3)}</strong>
          {marked.size > 1 && " (interpolated)"}
        </div>
      )}
    </div>
  );
}

function MaintenanceList({ logs, window }: { logs: readonly Instance[]; window: Window | null }) {
  if (logs.length === 0) {
    return (
      <div className="bd-curve">
        <Muted>No maintenance recorded for this tank.</Muted>
      </div>
    );
  }

  return (
    <div className="bd-curve">
      <div className={`bd-curve-label ${Classes.TEXT_MUTED}`}>Maintenance history</div>
      {logs.map((log, index) => {
        const stamp = log["completedAt"] ?? log["startedAt"];
        const during = withinWindow(stamp, window);

        return (
          <div className="bd-entry" key={String(log["id"] ?? index)}>
            <div className="bd-entry-head">
              <span className="om-mono">{String(log["id"] ?? "—")}</span>
              <span className={Classes.TEXT_MUTED}>{formatDate(stamp)}</span>
              {during && (
                <Tag intent="warning" icon="warning-sign" minimal>
                  During fermentation
                </Tag>
              )}
            </div>
            <div className="bd-chips">
              <Tag minimal>{String(log["type"] ?? "—")}</Tag>
              <Tag minimal>{String(log["status"] ?? "—")}</Tag>
            </div>
            {text(log["notes"]) !== null && (
              <div className={Classes.RUNNING_TEXT}>{String(log["notes"])}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One audit entry, expanding to show what it was called with and what came back. */
function AuditRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bd-entry">
      <button type="button" className="bd-audit-head" onClick={() => setOpen(!open)}>
        <Icon icon={open ? "chevron-down" : "chevron-right"} size={12} />
        <span className="bd-audit-action">{entry.actionName}</span>
        <Tag minimal icon="person">
          {entry.actor}
        </Tag>
        <span className={`${Classes.TEXT_MUTED} bd-audit-time`}>
          {new Date(entry.createdAt).toLocaleString()}
        </span>
      </button>

      <Collapse isOpen={open}>
        <div className="bd-audit-body">
          <div className={`bd-curve-label ${Classes.TEXT_MUTED}`}>
            {/* The name it ran under, which a later rename does not change. */}
            action <span className="om-mono">{entry.action}</span>
          </div>
          <div className={`bd-curve-label ${Classes.TEXT_MUTED}`}>params</div>
          <pre className="ox-json">{JSON.stringify(entry.params, null, 2)}</pre>
          {entry.result !== null && (
            <>
              <div className={`bd-curve-label ${Classes.TEXT_MUTED}`}>result</div>
              <pre className="ox-json">{JSON.stringify(entry.result, null, 2)}</pre>
            </>
          )}
        </div>
      </Collapse>
    </div>
  );
}
