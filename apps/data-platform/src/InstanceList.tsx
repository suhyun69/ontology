import { Classes, HTMLTable, NonIdealState, Spinner, Tag } from "@blueprintjs/core";
import type { Instance, InstancePage, TypeDetail } from "./api.ts";
import { Empty, formatValue, instanceId, primaryKeyProperty, statusProperty, titleProperty } from "./format.tsx";

type InstanceListProps = {
  meta: TypeDetail | undefined;
  page: InstancePage | null;
  onOpen: (id: string) => void;
};

/**
 * 한 타입의 모든 인스턴스.
 *
 * 컬럼을 고정하지 않고 메타데이터에서 고른다 — 타입마다 뭘로 식별되는지가
 * 다르기 때문. 제목은 is_title로 표시된 속성, ID 컬럼은 그게 이미 제목이
 * 아닐 때만, status 컬럼은 그 타입이 status를 선언했을 때만 나타난다.
 */
export function InstanceList({ meta, page, onOpen }: InstanceListProps) {
  if (meta === undefined || page === null) {
    return <NonIdealState icon={<Spinner />} title="Loading instances…" />;
  }

  const title = titleProperty(meta);
  const key = primaryKeyProperty(meta);
  const status = statusProperty(meta);
  const showId = key !== undefined && key.api_name !== title?.api_name;

  if (page.instances.length === 0) {
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
        {page.instances.map((instance, index) => (
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

  // id가 없으면 열 곳이 없다 — 가져올 수도 없는 상세 뷰로 이동시키는 대신
  // 행을 그냥 비활성 상태로 둔다.
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
