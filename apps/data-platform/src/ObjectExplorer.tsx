import { useCallback, useEffect, useRef, useState } from "react";
import { Alignment, Button, Callout, Icon, Navbar, NonIdealState, Tag } from "@blueprintjs/core";
import { listInstances, loadInstance, loadObjectType } from "./api.ts";
import type { InstanceDetail, InstancePage, ObjectTypeSummary, TypeDetail } from "./api.ts";
import { ListView } from "./ListView.tsx";
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

  // 검색 상태는 리스트가 아니라 여기(explorer)에 둔다 — 그래야 객체 하나로
  // 들어갔다 나와도 검색어가 그대로 남아있다.
  const [query, setQuery] = useState("");
  const [searchAllTypes, setSearchAllTypes] = useState(false);
  // 타입별 인스턴스 — 전체 타입을 가로지르는 검색일 때만 채워진다.
  const [allPages, setAllPages] = useState<Record<string, InstancePage>>({});
  const requestedInstances = useRef<Set<string>>(new Set());
  // 액션이 지금 보여주는 인스턴스를 바꾼 뒤, 스택은 그대로 둔 채 현재 뷰만
  // 다시 가져오고 싶을 때 이 값을 올린다.
  const [reloadToken, setReloadToken] = useState(0);

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

  const requestInstances = useCallback((type: string) => {
    if (requestedInstances.current.has(type)) return;
    requestedInstances.current.add(type);

    listInstances(type)
      .then((loaded) => setAllPages((current) => ({ ...current, [type]: loaded })))
      .catch(() => {
        requestedInstances.current.delete(type);
      });
  }, []);

  // 전체 타입을 가로지르는 검색은 모든 타입의 행과 메타데이터가 필요하다.
  // 토글이 켜졌을 때만 가져오므로, 평소 케이스는 여전히 지금 보고 있는 타입
  // 하나만 요청하는 비용으로 끝난다.
  useEffect(() => {
    if (!searchAllTypes) return;

    for (const type of types) {
      requestMeta(type.api_name);
      requestInstances(type.api_name);
    }
  }, [searchAllTypes, types, requestMeta, requestInstances]);

  // 빈 패널 대신 첫 번째 타입으로 바로 진입.
  useEffect(() => {
    const first = types[0];
    if (first !== undefined) {
      setStack((current) => (current.length === 0 ? [{ kind: "list", type: first.api_name }] : current));
    }
  }, [types]);

  // 다른 뷰로 이동하면 화면에 있던 걸 지운다 — 그래야 새 제목 밑에 옛날
  // 행이 보이는 일이 없다. reload는 일부러 이렇게 하지 않는다: 제자리에서
  // 갱신해서, 새 데이터가 도착하는 동안 detail과 그 위에 열린 다이얼로그가
  // 계속 마운트된 상태로 남아있게 한다.
  useEffect(() => {
    setPage(null);
    setDetail(null);
  }, [view]);

  // 스택 맨 위가 보여주는 걸 가져온다.
  useEffect(() => {
    if (view === undefined) return;

    let cancelled = false;
    setViewError(null);
    requestMeta(view.type);

    if (view.kind === "list") {
      listInstances(view.type)
        .then((loaded) => {
          if (!cancelled) setPage(loaded);
        })
        .catch((error: unknown) => {
          if (!cancelled) setViewError(errorMessage(error));
        });
    } else {
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
  }, [view, requestMeta, reloadToken]);

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
            <ListView
              types={types}
              selectedType={view.type}
              meta={meta}
              instances={page?.instances ?? null}
              allPages={allPages}
              query={query}
              onQueryChange={setQuery}
              searchAllTypes={searchAllTypes}
              onSearchAllTypesChange={setSearchAllTypes}
              onOpen={(type, id) => push({ kind: "detail", type, id })}
            />
          ) : (
            <ObjectDetail
              meta={meta[view.type]}
              detail={detail}
              linkMeta={meta}
              onOpen={(type, id) => push({ kind: "detail", type, id })}
              onActionCompleted={() => setReloadToken((token) => token + 1)}
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
