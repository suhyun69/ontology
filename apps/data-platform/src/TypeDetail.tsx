import {
  Callout,
  Classes,
  EditableText,
  HTMLTable,
  Icon,
  Section,
  SectionCard,
  Spinner,
  Tag,
} from "@blueprintjs/core";
import type { Intent } from "@blueprintjs/core";
import type { ActionType, Link, ObjectTypeUpdate, Property, TypeDetail } from "./api.ts";

type TypeDetailViewProps = {
  detail: TypeDetail;
  instanceCount: number;
  /** Bumped whenever server state is reloaded, to reset the editors below. */
  revision: number;
  saving: boolean;
  saveError: string | null;
  onSave: (update: ObjectTypeUpdate) => void;
  onSelectType: (apiName: string) => void;
};

// ----------------------------------------------------------------- helpers

const STATUS_INTENT: Record<string, Intent> = {
  active: "success",
  experimental: "warning",
  deprecated: "danger",
};

/** Whether this end of a link yields a collection rather than a single object. */
function isPlural(cardinality: string): boolean {
  return cardinality === "one_to_many" || cardinality === "many_to_many";
}

function readableCardinality(cardinality: string): string {
  return cardinality.replaceAll("_", " ");
}

/**
 * Restates a link from the selected type's point of view.
 *
 * Stored links read source -> target, so an inbound one is labelled by its
 * inverse names and points back at the source.
 */
function fromHere(link: Link) {
  return link.direction === "outbound"
    ? { name: link.name, apiName: link.api_name, relatedType: link.target_type_api_name }
    : {
        name: link.inverse_name,
        apiName: link.inverse_api_name,
        relatedType: link.source_type_api_name,
      };
}

/** Parameter names a JSON Schema declares, for the actions table. */
function parameterNames(schema: Record<string, unknown>): string[] {
  const properties = schema["properties"];
  if (typeof properties !== "object" || properties === null) return [];
  return Object.keys(properties);
}

// ------------------------------------------------------------------- view

export function TypeDetailView({
  detail,
  instanceCount,
  revision,
  saving,
  saveError,
  onSave,
  onSelectType,
}: TypeDetailViewProps) {
  const { objectType, properties, links, actions } = detail;
  // Remounts the editors when the server state changes underneath them, so a
  // rejected edit falls back to what is actually stored rather than lingering.
  const editorKey = `${objectType.api_name}:${revision}`;

  return (
    <div className="om-detail">
      {saveError !== null && (
        <Callout intent="danger" icon="error" title="Could not save">
          {saveError}
        </Callout>
      )}

      <header className="om-header">
        <div className="om-header-title">
          <h1 className={Classes.HEADING}>
            <EditableText
              key={`name:${editorKey}`}
              defaultValue={objectType.name}
              placeholder="Display name"
              selectAllOnFocus
              maxLength={120}
              disabled={saving}
              onConfirm={(value) => {
                if (value.trim() !== "" && value.trim() !== objectType.name) {
                  onSave({ name: value });
                }
              }}
            />
          </h1>
          {saving && <Spinner size={16} />}
        </div>

        <div className="om-header-tags">
          <Tag minimal icon="id-number" className="om-mono">
            {objectType.api_name}
          </Tag>
          <Tag minimal intent={STATUS_INTENT[objectType.status] ?? "none"}>
            {objectType.status}
          </Tag>
          <Tag minimal icon="eye-open">
            {objectType.visibility}
          </Tag>
          <Tag minimal icon="database">
            {instanceCount.toLocaleString()} instances
          </Tag>
          {objectType.edits_enabled && (
            <Tag minimal icon="edit">
              edits enabled
            </Tag>
          )}
        </div>

        <div className={`om-description ${Classes.RUNNING_TEXT}`}>
          <EditableText
            key={`description:${editorKey}`}
            defaultValue={objectType.description ?? ""}
            placeholder="Add a description…"
            multiline
            minLines={2}
            maxLines={8}
            maxLength={1000}
            disabled={saving}
            onConfirm={(value) => {
              if (value.trim() !== (objectType.description ?? "")) {
                onSave({ description: value });
              }
            }}
          />
        </div>
      </header>

      <Section
        title="Properties"
        icon="th"
        rightElement={<Tag minimal round>{properties.length}</Tag>}
        compact
      >
        <SectionCard padded={false}>
          <PropertyTable properties={properties} />
        </SectionCard>
      </Section>

      <Section
        title="Links"
        icon="link"
        subtitle="Related object types reachable from this one"
        rightElement={<Tag minimal round>{links.length}</Tag>}
        compact
      >
        <SectionCard padded={false}>
          <LinkTable links={links} selfName={objectType.name} onSelectType={onSelectType} />
        </SectionCard>
      </Section>

      <Section
        title="Actions"
        icon="lightning"
        rightElement={<Tag minimal round>{actions.length}</Tag>}
        compact
      >
        <SectionCard padded={false}>
          <ActionTable actions={actions} />
        </SectionCard>
      </Section>

      <Section title="Datasource" icon="database" compact>
        <SectionCard>
          <span className={`om-mono ${Classes.TEXT_LARGE}`}>
            {objectType.schema}.{objectType.datasource_table}
          </span>
          <div className={Classes.TEXT_MUTED}>
            Point of contact: {objectType.point_of_contact ?? "—"}
          </div>
        </SectionCard>
      </Section>
    </div>
  );
}

// ----------------------------------------------------------------- tables

function EmptyRow({ columns, children }: { columns: number; children: string }) {
  return (
    <tr>
      <td colSpan={columns} className={`om-empty ${Classes.TEXT_MUTED}`}>
        {children}
      </td>
    </tr>
  );
}

function PropertyTable({ properties }: { properties: readonly Property[] }) {
  return (
    <HTMLTable className="om-table" compact striped>
      <thead>
        <tr>
          <th>Name</th>
          <th>API name</th>
          <th>Type</th>
          <th>Required</th>
          <th>Key</th>
          <th>Column</th>
        </tr>
      </thead>
      <tbody>
        {properties.length === 0 && <EmptyRow columns={6}>No properties.</EmptyRow>}
        {properties.map((property) => (
          <tr key={property.id}>
            <td>{property.name}</td>
            <td className="om-mono">{property.api_name}</td>
            <td>
              <Tag minimal>{property.data_type}</Tag>
            </td>
            <td>{property.required ? <Icon icon="tick" intent="success" /> : ""}</td>
            <td className="om-key-cell">
              {property.is_primary_key && (
                <Tag minimal intent="primary" icon="key">
                  primary
                </Tag>
              )}
              {property.is_title && (
                <Tag minimal icon="header">
                  title
                </Tag>
              )}
            </td>
            <td className={`om-mono ${Classes.TEXT_MUTED}`}>{property.datasource_column}</td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  );
}

/**
 * The links section, as a table rather than a graph.
 *
 * Each row reads as one sentence -- this type, the link, the type at the other
 * end -- so the shape of the ontology is legible without anything to drag.
 */
function LinkTable({
  links,
  selfName,
  onSelectType,
}: {
  links: readonly Link[];
  selfName: string;
  onSelectType: (apiName: string) => void;
}) {
  return (
    <HTMLTable className="om-table" compact striped>
      <thead>
        <tr>
          <th>Link</th>
          <th>API name</th>
          <th>Relationship</th>
          <th>Direction</th>
          <th>Via property</th>
        </tr>
      </thead>
      <tbody>
        {links.length === 0 && <EmptyRow columns={5}>No links declared.</EmptyRow>}
        {links.map((link) => {
          const here = fromHere(link);
          const plural = isPlural(link.effective_cardinality);

          return (
            <tr key={`${link.id}:${link.direction}`}>
              <td>{here.name}</td>
              <td className="om-mono">{here.apiName}</td>
              <td className="om-relationship">
                <span className={Classes.TEXT_MUTED}>{selfName}</span>
                <Icon icon="arrow-right" size={12} />
                <span className={Classes.TEXT_MUTED}>{plural ? "many" : "one"}</span>
                <a
                  className="om-type-link"
                  onClick={() => onSelectType(here.relatedType)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectType(here.relatedType);
                    }
                  }}
                >
                  {here.relatedType}
                </a>
              </td>
              <td>
                <Tag minimal icon={link.direction === "outbound" ? "arrow-right" : "arrow-left"}>
                  {readableCardinality(link.effective_cardinality)}
                </Tag>
              </td>
              <td className={`om-mono ${Classes.TEXT_MUTED}`}>{link.via_property_api_name}</td>
            </tr>
          );
        })}
      </tbody>
    </HTMLTable>
  );
}

function ActionTable({ actions }: { actions: readonly ActionType[] }) {
  return (
    <HTMLTable className="om-table" compact striped>
      <thead>
        <tr>
          <th>Name</th>
          <th>API name</th>
          <th>Description</th>
          <th>Parameters</th>
        </tr>
      </thead>
      <tbody>
        {actions.length === 0 && <EmptyRow columns={4}>No actions declared.</EmptyRow>}
        {actions.map((action) => (
          <tr key={action.id}>
            <td>{action.name}</td>
            <td className="om-mono">{action.api_name}</td>
            <td>{action.description ?? ""}</td>
            <td className="om-key-cell">
              {parameterNames(action.parameter_schema).map((name) => (
                <Tag key={name} minimal className="om-mono">
                  {name}
                </Tag>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  );
}
