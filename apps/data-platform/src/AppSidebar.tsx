import { Button, Tooltip } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/core";

/** The apps this shell can show. */
export type AppId = "ontology-manager" | "object-explorer" | "batch-workspace";

type AppEntry = {
  id: AppId;
  label: string;
  icon: IconName;
};

export const APPS: readonly AppEntry[] = [
  { id: "ontology-manager", label: "Ontology Manager", icon: "cube" },
  { id: "object-explorer", label: "Object Explorer", icon: "search-template" },
  { id: "batch-workspace", label: "Batch Investigation Workspace", icon: "lab-test" },
];

type AppSidebarProps = {
  active: AppId;
  onSelect: (app: AppId) => void;
};

/**
 * The outermost rail: one icon per app.
 *
 * Icon-only, so the name lives in a tooltip rather than taking width from the
 * app beside it.
 */
export function AppSidebar({ active, onSelect }: AppSidebarProps) {
  return (
    <nav className="ox-app-rail">
      {APPS.map((app) => (
        <Tooltip key={app.id} content={app.label} placement="right" compact>
          <Button
            large
            variant="minimal"
            icon={app.icon}
            active={app.id === active}
            aria-label={app.label}
            onClick={() => onSelect(app.id)}
          />
        </Tooltip>
      ))}
    </nav>
  );
}
