import { Classes, Menu, MenuItem, Tag } from "@blueprintjs/core";
import type { ObjectTypeSummary } from "./api.ts";

type TypeRailProps = {
  types: readonly ObjectTypeSummary[];
  selected: string | null;
  onSelect: (apiName: string) => void;
};

/** The left rail: every object type, its display name, and how many rows it has. */
export function TypeRail({ types, selected, onSelect }: TypeRailProps) {
  return (
    <nav className="om-rail">
      <div className="om-rail-header">
        <span className="om-rail-title">Object types</span>
        <Tag minimal round>
          {types.length}
        </Tag>
      </div>

      <Menu className="om-rail-menu">
        {types.map((type) => (
          <MenuItem
            key={type.api_name}
            active={type.api_name === selected}
            onClick={() => onSelect(type.api_name)}
            multiline
            text={
              <span className="om-rail-item">
                <span className="om-rail-name">{type.name}</span>
                <span className={`om-rail-api ${Classes.TEXT_MUTED}`}>{type.api_name}</span>
              </span>
            }
            labelElement={
              <Tag minimal round intent={type.instanceCount === 0 ? "none" : "primary"}>
                {type.instanceCount.toLocaleString()}
              </Tag>
            }
          />
        ))}
      </Menu>
    </nav>
  );
}
