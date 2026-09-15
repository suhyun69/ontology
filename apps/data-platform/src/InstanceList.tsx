import { Classes, HTMLTable, NonIdealState, Spinner, Tag } from "@blueprintjs/core";
import type { Instance, TypeDetail } from "./api.ts";
import { Empty, formatValue, instanceId, primaryKeyProperty, statusProperty, titleProperty } from "./format.tsx";

type InstanceListProps = {
  meta: TypeDetail | undefined;
  /** Already filtered by the caller; null while still loading. */
  instances: readonly Instance[] | null;
  onOpen: (id: string) => void;
};

/**
 * Every instance of one type.
 *
 * The columns are chosen from metadata rather than fixed, because types do not
 * agree on what identifies them: the title is whichever property is flagged
 * is_title, the id column appears only when that is not already the title, and
 * status only when the type declares one.
 */
export function InstanceList({ meta, instances, onOpen }: InstanceListProps) {
  if (meta === undefined || instances === null) {
    return <NonIdealState icon={<Spinner />} title="Loading instances…" />;
  }

  const title = titleProperty(meta);
  const key = primaryKeyProperty(meta);
  const status = statusProperty(meta);
  const showId = key !== undefined && key.api_name !== title?.api_name;

  if (instances.length === 0) {
    return (
      <NonIdealState
        icon="inbox"
        title="No instances"
        description={`${meta.objectType.name} has no rows yet.`}
      />
    );
  }

  return (
    <HTMLTable className="ox-instance-table" interactive striped>
      <thead>
        <tr>
          <th>{title?.name ?? "Instance"}</th>
          {showId && <th>{key.name}</th>}
          {status !== undefined && <th>{status.name}</th>}
        </tr>
      </thead>
      <tbody>
        {instances.map((instance, index) => (
          <InstanceRow
            key={instanceId(instance, meta) ?? index}
            instance={instance}
            meta={meta}
            showId={showId}
            onOpen={onOpen}
          />
        ))}
      </tbody>
    </HTMLTable>
  );
}

function InstanceRow({
  instance,
  meta,
  showId,
  onOpen,
}: {
  instance: Instance;
  meta: TypeDetail;
  showId: boolean;
  onOpen: (id: string) => void;
}) {
  const title = titleProperty(meta);
  const key = primaryKeyProperty(meta);
  const status = statusProperty(meta);
  const id = instanceId(instance, meta);

  // Without an id there is nothing to open, so the row stays inert rather than
  // navigating to a detail view that cannot be fetched.
  const open = id === undefined ? undefined : () => onOpen(id);

  return (
    <tr
      onClick={open}
      role={open === undefined ? undefined : "button"}
      tabIndex={open === undefined ? undefined : 0}
      onKeyDown={(event) => {
        if (open !== undefined && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          open();
        }
      }}
    >
      <td className="ox-title-cell">
        {title === undefined ? <Empty /> : formatValue(instance[title.api_name], title.data_type)}
      </td>
      {showId && key !== undefined && (
        <td className={`om-mono ${Classes.TEXT_MUTED}`}>{id ?? <Empty />}</td>
      )}
      {status !== undefined && (
        <td>
          {instance[status.api_name] === null || instance[status.api_name] === undefined ? (
            <Empty />
          ) : (
            <Tag minimal>{String(instance[status.api_name])}</Tag>
          )}
        </td>
      )}
    </tr>
  );
}
