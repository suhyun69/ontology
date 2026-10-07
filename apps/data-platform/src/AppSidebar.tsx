import { Button, Tooltip } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/core";

/** 이 셸이 보여줄 수 있는 앱들. */
export type AppId = "ontology-manager" | "object-explorer";

type AppEntry = {
  id: AppId;
  label: string;
  icon: IconName;
};

export const APPS: readonly AppEntry[] = [
  { id: "ontology-manager", label: "Ontology Manager", icon: "cube" },
  { id: "object-explorer", label: "Object Explorer", icon: "search-template" },
];

type AppSidebarProps = {
  active: AppId;
  onSelect: (app: AppId) => void;
};

/**
 * 가장 바깥쪽 레일: 앱마다 아이콘 하나씩.
 *
 * 아이콘만 두고 이름은 툴팁으로 — 옆에 있는 앱 영역의 너비를 뺏지 않기 위해.
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
