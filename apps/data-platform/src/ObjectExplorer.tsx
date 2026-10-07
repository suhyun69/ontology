import { useCallback, useEffect, useRef, useState } from "react";
import { Alignment, Button, Callout, Icon, Navbar, NonIdealState, Tag } from "@blueprintjs/core";
import { listInstances, loadInstance, loadObjectType } from "./api.ts";
import type { InstanceDetail, InstancePage, ObjectTypeSummary, TypeDetail } from "./api.ts";
import { InstanceList } from "./InstanceList.tsx";
import { ObjectDetail } from "./ObjectDetail.tsx";
import { TypeRail } from "./TypeRail.tsx";

/** 내비게이션 스택의 항목 하나. */
type ExplorerView =
  | { kind: "list"; type: string }
  | { kind: "detail"; type: string; id: string };

type ObjectExplorerProps = {
  types: readonly ObjectTypeSummary[];
  loadError: string | null;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ObjectExplorer({ types, loadError }: ObjectExplorerProps) {
  // 이 스택이 곧 히스토리다: 마지막 항목이 화면에 보이고, 그 앞의 모든 항목은
  // 돌아갈 수 있는 지점이다.
  const [stack, setStack] = useState<ExplorerView[]>([]);
  const [page, setPage] = useState<InstancePage | null>(null);
  const [detail, setDetail] = useState<InstanceDetail | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);

  const [meta, setMeta] = useState<Record<string, TypeDetail>>({});
  // 이미 가져왔거나 요청 중인 타입들 — 캐시 미스가 나도 한 번만 요청되게.
  const requested = useRef<Set<string>>(new Set());

  const view = stack[stack.length - 1];

  const requestMeta = useCallback((type: string) => {
    if (requested.current.has(type)) return;
    requested.current.add(type);

    loadObjectType(type)
      .then((loaded) => setMeta((current) => ({ ...current, [type]: loaded })))
      .catch(() => {
        // 캐시에도 안 넣고 요청 표시도 지운다 — 나중 뷰가 다시 시도할 수 있게.
        requested.current.delete(type);
      });
  }, []);

  // 빈 패널 대신 첫 번째 타입으로 바로 진입.
  useEffect(() => {
    const first = types[0];
    if (first !== undefined) {
      setStack((current) => (current.length === 0 ? [{ kind: "list", type: first.api_name }] : current));
    }
  }, [types]);

  // 스택 맨 위가 보여주는 걸 가져온다.
  useEffect(() => {
    if (view === undefined) return;

    let cancelled = false;
    setViewError(null);
    requestMeta(view.type);

    if (view.kind === "list") {
      setPage(null);
      listInstances(view.type)
        .then((loaded) => {
          if (!cancelled) setPage(loaded);
        })
        .catch((error: unknown) => {
          if (!cancelled) setViewError(errorMessage(error));
        });
    } else {
      setDetail(null);
      loadInstance(view.type, view.id)
        .then((loaded) => {
          if (!cancelled) setDetail(loaded);
        })
        .catch((error: unknown) => {
          if (!cancelled) setViewError(errorMessage(error));
        });
    }

    return () => {
      cancelled = true;
    };
  }, [view, requestMeta]);

  // 링크의 타겟들은 지금 보고 있는 타입이 아니라 타겟 타입 자신의 메타데이터로
  // 라벨링되고 주소가 결정된다.
  useEffect(() => {
    if (detail === null) return;
    for (const link of Object.values(detail.links)) {
      requestMeta(link.targetType);
    }
  }, [detail, requestMeta]);

  const selectType = useCallback((type: string) => {
    // 레일 클릭은 한 단계 더 들어가는 게 아니라 새로운 출발점이다.
    setStack([{ kind: "list", type }]);
  }, []);

  const push = useCallback((next: ExplorerView) => {
    setStack((current) => [...current, next]);
  }, []);

  const truncateTo = useCallback((index: number) => {
    setStack((current) => current.slice(0, index + 1));
  }, []);

  const back = useCallback(() => {
    setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
  }, []);

  const typeName = (type: string) =>
    types.find((entry) => entry.api_name === type)?.name ?? type;

  return (
    <div className="om-root">
      <Navbar className="om-navbar">
        <Navbar.Group align={Alignment.START}>
          <Button
            icon="arrow-left"
            variant="minimal"
            disabled={stack.length <= 1}
            onClick={back}
            aria-label="Back"
          />
          <Navbar.Divider />
          <Navbar.Heading className="om-brand">Object Explorer</Navbar.Heading>
          <Navbar.Divider />
          <Breadcrumbs stack={stack} typeName={typeName} onJump={truncateTo} />
        </Navbar.Group>
      </Navbar>

      <div className="om-body">
        <TypeRail types={types} selected={view?.type ?? null} onSelect={selectType} />

        <main className="om-main">
          {loadError !== null ? (
            <Callout intent="danger" icon="error" title="Could not reach the ontology API">
              {loadError}
              <p className="om-callout-hint">
                Start it with <code>pnpm dev</code> from the repository root, then reload.
              </p>
            </Callout>
          ) : viewError !== null ? (
            <Callout intent="danger" icon="error" title="Could not load this view">
              {viewError}
            </Callout>
          ) : view === undefined ? (
            <NonIdealState icon="search-template" title="Pick an object type" />
          ) : view.kind === "list" ? (
            <InstanceList
              meta={meta[view.type]}
              page={page}
              onOpen={(id) => push({ kind: "detail", type: view.type, id })}
            />
          ) : (
            <ObjectDetail
              meta={meta[view.type]}
              detail={detail}
              linkMeta={meta}
              onOpen={(type, id) => push({ kind: "detail", type, id })}
            />
          )}
        </main>
      </div>
    </div>
  );
}

/** 스택을 렌더링 — 이전의 어떤 항목으로도 바로 점프할 수 있게. */
function Breadcrumbs({
  stack,
  typeName,
  onJump,
}: {
  stack: readonly ExplorerView[];
  typeName: (type: string) => string;
  onJump: (index: number) => void;
}) {
  return (
    <div className="ox-breadcrumbs">
      {stack.map((entry, index) => {
        const last = index === stack.length - 1;
        const label = entry.kind === "list" ? typeName(entry.type) : entry.id;

        return (
          <span className="ox-crumb" key={`${entry.kind}:${entry.type}:${entry.kind === "detail" ? entry.id : ""}:${index}`}>
            {index > 0 && <Icon icon="chevron-right" size={12} className="ox-crumb-sep" />}
            {last ? (
              <Tag minimal>{label}</Tag>
            ) : (
              <a className="ox-crumb-link" onClick={() => onJump(index)}>
                {label}
              </a>
            )}
          </span>
        );
      })}
    </div>
  );
}
