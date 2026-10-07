import { useCallback, useEffect, useState } from "react";
import { Alignment, Callout, Navbar, NonIdealState, Spinner, Tag } from "@blueprintjs/core";
import { loadObjectType, patchObjectType } from "./api.ts";
import type { ObjectType, ObjectTypeSummary, ObjectTypeUpdate, TypeDetail } from "./api.ts";
import { TypeDetailView } from "./TypeDetail.tsx";
import { TypeRail } from "./TypeRail.tsx";

type OntologyManagerProps = {
  types: readonly ObjectTypeSummary[];
  loadError: string | null;
  /** 저장된 행을 위로 올려보고해서, 공유 타입 목록이 리네임을 따라가게 한다. */
  onObjectTypeSaved: (objectType: ObjectType) => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function OntologyManager({ types, loadError, onObjectTypeSaved }: OntologyManagerProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<TypeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 로드할 때마다, 그리고 저장이 거부될 때마다 바뀐다 — 그래서 인라인
  // 에디터들이 입력하던 값을 버리고 서버가 실제로 들고 있는 값으로 다시 렌더링한다.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setSelected((current) => current ?? types[0]?.api_name ?? null);
  }, [types]);

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
      .catch((caught: unknown) => {
        if (!cancelled) setError(errorMessage(caught));
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
          onObjectTypeSaved(objectType);
        })
        .catch((caught: unknown) => {
          setSaveError(errorMessage(caught));
          setRevision((n) => n + 1);
        })
        .finally(() => setSaving(false));
    },
    [selected, onObjectTypeSaved],
  );

  const shownError = loadError ?? error;
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
          {shownError !== null ? (
            <Callout intent="danger" icon="error" title="Could not reach the ontology API">
              {shownError}
              <p className="om-callout-hint">
                Start it with <code>pnpm dev</code> from the repository root, then reload.
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
