import { useCallback, useEffect, useState } from "react";
import { listObjectTypes } from "./api.ts";
import type { ObjectType, ObjectTypeSummary } from "./api.ts";
import { AppSidebar } from "./AppSidebar.tsx";
import type { AppId } from "./AppSidebar.tsx";
import { BatchWorkspace } from "./BatchWorkspace.tsx";
import { ObjectExplorer } from "./ObjectExplorer.tsx";
import { OntologyManager } from "./OntologyManager.tsx";

/**
 * The shell: an app rail, and whichever app it has selected.
 *
 * The type list lives here because both apps show the same one, so switching
 * between them does not refetch it -- and a rename in the Ontology Manager is
 * reflected in the Explorer's rail without a reload.
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
