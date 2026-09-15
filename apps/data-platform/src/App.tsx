import { useCallback, useEffect, useState } from "react";
import { Alignment, Callout, Navbar, NonIdealState, Spinner, Tag } from "@blueprintjs/core";
import { listObjectTypes, loadObjectType, patchObjectType } from "./api.ts";
import type { ObjectTypeSummary, ObjectTypeUpdate, TypeDetail } from "./api.ts";
import { TypeDetailView } from "./TypeDetail.tsx";
import { TypeRail } from "./TypeRail.tsx";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App() {
  const [types, setTypes] = useState<ObjectTypeSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<TypeDetail | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Changes on every load and every rejected save, so the inline editors drop
  // whatever was typed and re-render from what the server actually holds.
  const [revision, setRevision] = useState(0);

  // The rail, once. Selecting the first type gives the page something to show
  // rather than an empty panel on arrival.
  useEffect(() => {
    let cancelled = false;

    listObjectTypes()
      .then(({ types: loaded }) => {
        if (cancelled) return;
        setTypes(loaded);
        setSelected((current) => current ?? loaded[0]?.api_name ?? null);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(errorMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // The detail bundle for whichever type is selected.
  useEffect(() => {
    if (selected === null) return;

    let cancelled = false;
    setDetail(null);
    setSaveError(null);

    loadObjectType(selected)
      .then((loaded) => {
        if (cancelled) return;
        setDetail(loaded);
        setRevision((n) => n + 1);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(errorMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  const handleSave = useCallback(
    (update: ObjectTypeUpdate) => {
      if (selected === null) return;

      setSaving(true);
      setSaveError(null);

      patchObjectType(selected, update)
        .then(({ objectType }) => {
          setDetail((current) => (current === null ? current : { ...current, objectType }));
          // The rail shows the display name, so it has to follow the rename.
          setTypes((current) =>
            current.map((type) =>
              type.api_name === objectType.api_name ? { ...type, ...objectType } : type,
            ),
          );
        })
        .catch((error: unknown) => {
          setSaveError(errorMessage(error));
          setRevision((n) => n + 1);
        })
        .finally(() => setSaving(false));
    },
    [selected],
  );

  const selectedSummary = types.find((type) => type.api_name === selected);

  return (
    <div className="om-root">
      <Navbar className="om-navbar">
        <Navbar.Group align={Alignment.START}>
          <Navbar.Heading className="om-brand">Ontology Manager</Navbar.Heading>
          <Navbar.Divider />
          <Tag minimal icon="graph">
            manufacturing
          </Tag>
        </Navbar.Group>
      </Navbar>

      <div className="om-body">
        <TypeRail types={types} selected={selected} onSelect={setSelected} />

        <main className="om-main">
          {loadError !== null ? (
            <Callout intent="danger" icon="error" title="Could not reach the ontology API">
              {loadError}
              <p className="om-callout-hint">
                Start it with <code>pnpm --filter @ontology/ontology dev</code>, then reload.
              </p>
            </Callout>
          ) : detail === null ? (
            <NonIdealState
              icon={<Spinner />}
              title={types.length === 0 ? "Loading ontology…" : "Loading object type…"}
            />
          ) : (
            <TypeDetailView
              detail={detail}
              instanceCount={selectedSummary?.instanceCount ?? 0}
              revision={revision}
              saving={saving}
              saveError={saveError}
              onSave={handleSave}
              onSelectType={setSelected}
            />
          )}
        </main>
      </div>
    </div>
  );
}
