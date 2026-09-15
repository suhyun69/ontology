import { Button, Callout, Classes, InputGroup, NonIdealState, Section, SectionCard, Spinner, Switch, Tag } from "@blueprintjs/core";
import type { Instance, InstancePage, ObjectTypeSummary, TypeDetail } from "./api.ts";
import { InstanceList } from "./InstanceList.tsx";
import { filterInstances } from "./search.ts";

type ListViewProps = {
  types: readonly ObjectTypeSummary[];
  selectedType: string;
  /** Type metadata by api_name; a type is searchable once its entry arrives. */
  meta: Record<string, TypeDetail>;
  /** Instances of the selected type, null while loading. */
  instances: readonly Instance[] | null;
  /** Instances by type, filled in only while searching across all of them. */
  allPages: Record<string, InstancePage>;
  query: string;
  onQueryChange: (query: string) => void;
  searchAllTypes: boolean;
  onSearchAllTypesChange: (value: boolean) => void;
  onOpen: (type: string, id: string) => void;
};

export function ListView(props: ListViewProps) {
  const { types, selectedType, query, onQueryChange, searchAllTypes, onSearchAllTypesChange } = props;

  const typeName = types.find((type) => type.api_name === selectedType)?.name ?? selectedType;

  return (
    <div className="ox-list-view">
      <div className="ox-search">
        <InputGroup
          className="ox-search-input"
          leftIcon="search"
          placeholder={searchAllTypes ? "Search every object type…" : `Search ${typeName}…`}
          value={query}
          onValueChange={onQueryChange}
          large
          {...(query === ""
            ? {}
            : {
                rightElement: (
                  <Button
                    icon="cross"
                    variant="minimal"
                    aria-label="Clear search"
                    onClick={() => onQueryChange("")}
                  />
                ),
              })}
        />
        <Switch
          className="ox-search-toggle"
          checked={searchAllTypes}
          label="Search all types"
          inline
          onChange={(event) => onSearchAllTypesChange(event.currentTarget.checked)}
        />
      </div>

      {searchAllTypes ? <AllTypesResults {...props} /> : <SingleTypeResults {...props} />}
    </div>
  );
}

// ------------------------------------------------------------ single type

function SingleTypeResults({ selectedType, meta, instances, query, onOpen }: ListViewProps) {
  const typeMeta = meta[selectedType];

  if (instances === null || typeMeta === undefined) {
    return <NonIdealState icon={<Spinner />} title="Loading instances…" />;
  }

  const matches = filterInstances(instances, typeMeta, query);
  const searching = query.trim() !== "";

  if (searching && matches.length === 0) {
    return <NoMatches query={query} />;
  }

  return (
    <>
      {searching && (
        <div className={`ox-result-count ${Classes.TEXT_MUTED}`}>
          {matches.length} of {instances.length} matching
        </div>
      )}
      <InstanceList
        meta={typeMeta}
        instances={matches}
        onOpen={(id) => onOpen(selectedType, id)}
      />
    </>
  );
}

// -------------------------------------------------------------- all types

/**
 * Every type's matches, grouped.
 *
 * A type contributes a group only once both its metadata and its instances
 * have arrived and something in it matches, so the page fills in as the
 * requests land rather than waiting on the slowest one.
 */
function AllTypesResults({ types, meta, allPages, query, onOpen }: ListViewProps) {
  const searching = query.trim() !== "";

  if (!searching) {
    return (
      <NonIdealState
        icon="search"
        title="Search every object type"
        description="Type a query to look across all object types at once."
      />
    );
  }

  const pending = types.filter(
    (type) => meta[type.api_name] === undefined || allPages[type.api_name] === undefined,
  );

  const groups = types
    .map((type) => {
      const typeMeta = meta[type.api_name];
      const page = allPages[type.api_name];
      if (typeMeta === undefined || page === undefined) return null;

      const matches = filterInstances(page.instances, typeMeta, query);
      return matches.length === 0 ? null : { type, typeMeta, matches };
    })
    .filter((group) => group !== null);

  const total = groups.reduce((sum, group) => sum + group.matches.length, 0);

  return (
    <>
      <div className={`ox-result-count ${Classes.TEXT_MUTED}`}>
        {total} {total === 1 ? "match" : "matches"} across {groups.length}{" "}
        {groups.length === 1 ? "type" : "types"}
        {pending.length > 0 && ` · still loading ${pending.length}`}
      </div>

      {groups.length === 0 && pending.length === 0 && <NoMatches query={query} />}

      {groups.map(({ type, typeMeta, matches }) => (
        <Section
          key={type.api_name}
          title={type.name}
          rightElement={<Tag minimal round>{matches.length}</Tag>}
          compact
        >
          <SectionCard padded={false}>
            <InstanceList
              meta={typeMeta}
              instances={matches}
              onOpen={(id) => onOpen(type.api_name, id)}
            />
          </SectionCard>
        </Section>
      ))}
    </>
  );
}

function NoMatches({ query }: { query: string }) {
  return (
    <Callout icon="search" title="No matches">
      Nothing contains <strong>{query}</strong>. Boolean properties are not searched.
    </Callout>
  );
}
