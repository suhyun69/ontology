import { useCallback, useEffect, useState } from "react";
import { listObjectTypes } from "./api.ts";
import type { ObjectType, ObjectTypeSummary } from "./api.ts";
import { AppSidebar } from "./AppSidebar.tsx";
import type { AppId } from "./AppSidebar.tsx";
import { BatchWorkspace } from "./BatchWorkspace.tsx";
import { ObjectExplorer } from "./ObjectExplorer.tsx";
import { OntologyManager } from "./OntologyManager.tsx";

/**
 * 셸(shell): 앱 레일과, 그 중 선택된 앱.
 *
 * 타입 목록은 두 앱이 똑같은 걸 보여주기 때문에 여기(셸)에 둔다 — 앱을
 * 전환해도 다시 불러오지 않고, Ontology Manager에서 이름을 바꾸면
 * 리로드 없이 Explorer의 레일에도 바로 반영된다.
 */
export function App() {
  const [app, setApp] = useState<AppId>("ontology-manager");
  const [types, setTypes] = useState<ObjectTypeSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    listObjectTypes()
      .then(({ types: loaded }) => {
        if (!cancelled) setTypes(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleObjectTypeSaved = useCallback((objectType: ObjectType) => {
    setTypes((current) =>
      current.map((type) =>
        type.api_name === objectType.api_name ? { ...type, ...objectType } : type,
      ),
    );
  }, []);

  return (
    <div className="ox-shell">
      <AppSidebar active={app} onSelect={setApp} />

      <div className="ox-app">
        {app === "ontology-manager" ? (
          <OntologyManager
            types={types}
            loadError={loadError}
            onObjectTypeSaved={handleObjectTypeSaved}
          />
        ) : app === "object-explorer" ? (
          <ObjectExplorer types={types} loadError={loadError} />
        ) : (
          <BatchWorkspace loadError={loadError} />
        )}
      </div>
    </div>
  );
}
