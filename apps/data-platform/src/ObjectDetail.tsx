import {
  Button,
  Classes,
  NonIdealState,
  Section,
  SectionCard,
  Spinner,
  Tag,
  Tooltip,
} from "@blueprintjs/core";
import { useState } from "react";
import type { ActionType, Instance, InstanceDetail, ResolvedLink, TypeDetail } from "./api.ts";
import { ActionDialog } from "./ActionDialog.tsx";
import { Empty, formatValue, instanceId, instanceLabel, titleProperty } from "./format.tsx";

type ObjectDetailProps = {
  meta: TypeDetail | undefined;
  detail: InstanceDetail | null;
  /** Metadata for the types this instance links to, keyed by api_name. */
  linkMeta: Record<string, TypeDetail>;
  onOpen: (type: string, id: string) => void;
  /** Refetches this instance, once an action has changed it. */
  onActionCompleted: () => void;
};

export function ObjectDetail({
  meta,
  detail,
  linkMeta,
  onOpen,
  onActionCompleted,
}: ObjectDetailProps) {
  const [running, setRunning] = useState<ActionType | null>(null);
  if (meta === undefined || detail === null) {
    return <NonIdealState icon={<Spinner />} title="Loading object…" />;
  }

  const title = titleProperty(meta);
  const heading =
    title === undefined ? String(detail.id) : String(detail.properties[title.api_name] ?? detail.id);

  return (
    <div className="ox-detail">
      <header className="ox-detail-header">
        <div className="ox-detail-heading">
          <h1 className={Classes.HEADING}>{heading}</h1>
          <Tag minimal className="om-mono">
            {detail.type}
          </Tag>
          <Tag minimal className="om-mono">
            {String(detail.id)}
          </Tag>
        </div>

        <ActionStrip actions={meta.actions} onRun={setRunning} />
      </header>

      {running !== null && (
        <ActionDialog
          action={running}
          objectType={detail.type}
          objectId={String(detail.id)}
          onClose={() => setRunning(null)}
          onCompleted={onActionCompleted}
        />
      )}

      <div className="ox-columns">
        <Section title="Properties" icon="properties" compact>
          <SectionCard padded={false}>
            <dl className="ox-properties">
              {meta.properties.map((property) => (
                <div className="ox-property" key={property.id}>
                  <dt>{property.name}</dt>
                  <dd>{formatValue(detail.properties[property.api_name], property.data_type)}</dd>
                </div>
              ))}
            </dl>
          </SectionCard>
        </Section>

        <Section title="Links" icon="link" compact>
          <SectionCard padded={false}>
            <LinkPanel links={detail.links} linkMeta={linkMeta} onOpen={onOpen} />
          </SectionCard>
        </Section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------- action strip

/** One button per action the type declares; each opens that action's dialog. */
function ActionStrip({
  actions,
  onRun,
}: {
  actions: TypeDetail["actions"];
  onRun: (action: ActionType) => void;
}) {
  if (actions.length === 0) {
    return <span className={`ox-no-actions ${Classes.TEXT_MUTED}`}>No actions on this type</span>;
  }

  return (
    <div className="ox-actions">
      {actions.map((action) =>
        action.description === null ? (
          <Button key={action.id} variant="outlined" text={action.name} onClick={() => onRun(action)} />
        ) : (
          <Tooltip key={action.id} content={action.description} placement="bottom" compact>
            <Button variant="outlined" text={action.name} onClick={() => onRun(action)} />
          </Tooltip>
        ),
      )}
    </div>
  );
}

// ------------------------------------------------------------ link panel

/** The instances one link resolved to, always as a list. */
function targets(link: ResolvedLink): Instance[] {
  if (link.value === null) return [];
  return Array.isArray(link.value) ? link.value : [link.value];
}

function LinkPanel({
  links,
  linkMeta,
  onOpen,
}: {
  links: Record<string, ResolvedLink>;
  linkMeta: Record<string, TypeDetail>;
  onOpen: (type: string, id: string) => void;
}) {
  const entries = Object.entries(links);

  if (entries.length === 0) {
    return <div className={`ox-empty-panel ${Classes.TEXT_MUTED}`}>This type declares no links.</div>;
  }

  return (
    <div className="ox-links">
      {entries.map(([apiName, link]) => {
        const related = targets(link);
        const meta = linkMeta[link.targetType];

        return (
          <section className="ox-link-group" key={apiName}>
            <div className="ox-link-heading">
              <span className="ox-link-name">{link.name}</span>
              <Tag minimal className="om-mono">
                {link.targetType}
              </Tag>
            </div>

            {related.length === 0 ? (
              <div className="ox-link-empty">
                <Empty />
              </div>
            ) : (
              related.map((instance, index) => (
                <LinkTarget
                  key={instanceId(instance, meta) ?? index}
                  instance={instance}
                  meta={meta}
                  targetType={link.targetType}
                  onOpen={onOpen}
                />
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

function LinkTarget({
  instance,
  meta,
  targetType,
  onOpen,
}: {
  instance: Instance;
  meta: TypeDetail | undefined;
  targetType: string;
  onOpen: (type: string, id: string) => void;
}) {
  const id = instanceId(instance, meta);
  const label = instanceLabel(instance, meta);

  // Until the target type's metadata arrives there is no way to know which
  // property holds its id, so the row renders but does not yet navigate.
  if (id === undefined) {
    return <div className="ox-link-target ox-link-target-pending">{label}</div>;
  }

  return (
    <button type="button" className="ox-link-target" onClick={() => onOpen(targetType, id)}>
      <span className="ox-link-target-label">{label}</span>
      <span className={`om-mono ${Classes.TEXT_MUTED}`}>{id}</span>
    </button>
  );
}
