import { useCallback, useEffect, useRef, useState } from "react";
import { Alignment, Button, Callout, Icon, Navbar, NonIdealState, Tag } from "@blueprintjs/core";
import { listInstances, loadInstance, loadObjectType } from "./api.ts";
import type { InstanceDetail, InstancePage, ObjectTypeSummary, TypeDetail } from "./api.ts";
import { ListView } from "./ListView.tsx";
import { ObjectDetail } from "./ObjectDetail.tsx";
import { TypeRail } from "./TypeRail.tsx";

/** One entry on the navigation stack. */
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
  // The stack is the history: the last entry is on screen, and everything
  // before it is somewhere to go back to.
  const [stack, setStack] = useState<ExplorerView[]>([]);
  const [page, setPage] = useState<InstancePage | null>(null);
  const [detail, setDetail] = useState<InstanceDetail | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);

  const [meta, setMeta] = useState<Record<string, TypeDetail>>({});
  // Types already fetched or in flight, so a cache miss is requested once.
  const requested = useRef<Set<string>>(new Set());

  // Search state lives here rather than in the list, so a query survives a
  // step into an object and back out again.
  const [query, setQuery] = useState("");
  const [searchAllTypes, setSearchAllTypes] = useState(false);
  // Instances per type, filled in only for a search that spans all of them.
  const [allPages, setAllPages] = useState<Record<string, InstancePage>>({});
  const requestedInstances = useRef<Set<string>>(new Set());
  // Bumped to refetch the current view without moving on the stack, after an
  // action has changed the instance being shown.
  const [reloadToken, setReloadToken] = useState(0);

  const view = stack[stack.length - 1];

  const requestMeta = useCallback((type: string) => {
    if (requested.current.has(type)) return;
    requested.current.add(type);

    loadObjectType(type)
      .then((loaded) => setMeta((current) => ({ ...current, [type]: loaded })))
      .catch(() => {
        // Left out of the cache and un-requested, so a later view retries.
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

  // A search across every type needs every type's rows and metadata. They are
  // fetched only once the toggle is on, so the common case still costs one
  // request for the type being looked at.
  useEffect(() => {
    if (!searchAllTypes) return;

    for (const type of types) {
      requestMeta(type.api_name);
      requestInstances(type.api_name);
    }
  }, [searchAllTypes, types, requestMeta, requestInstances]);

  // Land on the first type rather than an empty pane.
  useEffect(() => {
    const first = types[0];
    if (first !== undefined) {
      setStack((current) => (current.length === 0 ? [{ kind: "list", type: first.api_name }] : current));
    }
  }, [types]);

  // Moving to another view drops what was on screen, so the old rows are never
  // shown under the new heading. A reload deliberately does not do this: it
  // refreshes in place, leaving the detail -- and any dialog open over it --
  // mounted while the new data arrives.
  useEffect(() => {
    setPage(null);
    setDetail(null);
  }, [view]);

  // Fetch whatever the top of the stack is showing.
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

  // A link's targets are labelled and addressed by the target type's own
  // metadata, which is a different type from the one being shown.
  useEffect(() => {
    if (detail === null) return;
    for (const link of Object.values(detail.links)) {
      requestMeta(link.targetType);
    }
  }, [detail, requestMeta]);

  const selectType = useCallback((type: string) => {
    // A rail click is a fresh starting point, not a step deeper.
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

/** The stack, rendered so any earlier entry can be jumped back to. */
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
