// Hand-written OpenAPI document for the four /api/objects routes. The routes
// are driven entirely by metadata at runtime (see metadata.ts), so there is no
// zod schema to generate this from — this document is kept in sync by hand.
export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Ontology API",
    version: "0.0.0",
    description: "Generic read access to object instances and the metadata describing them.",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "meta", description: "The ontology itself: object types, properties, links, actions." },
    { name: "objects", description: "Instance data for a given object type." },
    { name: "actions", description: "Invoking a declared action against one instance." },
  ],
  paths: {
    "/api/objects/meta/types": {
      get: {
        tags: ["meta"],
        summary: "List all object types",
        operationId: "listObjectTypes",
        responses: {
          "200": {
            description: "Every object type registered in any instance schema.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    count: { type: "integer" },
                    types: { type: "array", items: { $ref: "#/components/schemas/ObjectType" } },
                  },
                  required: ["count", "types"],
                },
              },
            },
          },
        },
      },
    },
    "/api/objects/meta/types/{type}": {
      get: {
        tags: ["meta"],
        summary: "Describe one object type",
        operationId: "describeObjectType",
        parameters: [{ $ref: "#/components/parameters/TypeApiName" }],
        responses: {
          "200": {
            description: "The type's properties, links (both directions) and actions.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    objectType: { $ref: "#/components/schemas/ObjectType" },
                    properties: { type: "array", items: { $ref: "#/components/schemas/Property" } },
                    links: { type: "array", items: { $ref: "#/components/schemas/LinkDescription" } },
                    actions: { type: "array", items: { $ref: "#/components/schemas/ActionType" } },
                  },
                  required: ["objectType", "properties", "links", "actions"],
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/objects/meta/types/{type}/actions": {
      get: {
        tags: ["meta"],
        summary: "List the actions declared for one object type",
        operationId: "listActionTypes",
        parameters: [{ $ref: "#/components/parameters/TypeApiName" }],
        responses: {
          "200": {
            description: "Every action_type row for this object type. A row with no handler still answers 200 here; it only 501s when invoked.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    type: { type: "string" },
                    count: { type: "integer" },
                    actions: { type: "array", items: { $ref: "#/components/schemas/ActionType" } },
                  },
                  required: ["type", "count", "actions"],
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/objects/meta/audit": {
      get: {
        tags: ["meta"],
        summary: "Query the audit log of action invocations",
        operationId: "listAuditLog",
        parameters: [
          {
            name: "targetType",
            in: "query",
            description: "Filter to one object type's api_name as recorded at the time of the action (survives a later rename or delete of the type).",
            schema: { type: "string" },
          },
          {
            name: "targetId",
            in: "query",
            description: "Filter to one instance id. Requires targetType.",
            schema: { type: "string" },
          },
          {
            name: "limit",
            in: "query",
            description: "Max entries to return (default 100, max 1000).",
            schema: { type: "integer", minimum: 0, maximum: 1000, default: 100 },
          },
          {
            name: "offset",
            in: "query",
            description: "Entries to skip.",
            schema: { type: "integer", minimum: 0, default: 0 },
          },
        ],
        responses: {
          "200": {
            description: "Matching entries, newest first.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    count: { type: "integer" },
                    limit: { type: "integer" },
                    offset: { type: "integer" },
                    entries: { type: "array", items: { $ref: "#/components/schemas/AuditLogEntry" } },
                  },
                  required: ["count", "limit", "offset", "entries"],
                },
              },
            },
          },
          "400": {
            description: "targetId was given without targetType.",
            content: {
              "application/json": {
                schema: { type: "object", properties: { error: { type: "string" } } },
              },
            },
          },
        },
      },
    },
    "/api/objects/{type}": {
      get: {
        tags: ["objects"],
        summary: "List instances of an object type",
        operationId: "listInstances",
        parameters: [
          { $ref: "#/components/parameters/TypeApiName" },
          {
            name: "limit",
            in: "query",
            description: "Max rows to return (default 100, max 1000).",
            schema: { type: "integer", minimum: 0, maximum: 1000, default: 100 },
          },
          {
            name: "offset",
            in: "query",
            description: "Rows to skip.",
            schema: { type: "integer", minimum: 0, default: 0 },
          },
          {
            name: "<propertyApiName>",
            in: "query",
            description:
              "Any other query key is matched against the type's properties and used as an equality " +
              "filter, coerced to that property's data_type (e.g. ?status=fermenting). Unknown keys, " +
              "and string[]/json properties, return 400.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "A page of instances.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    type: { type: "string" },
                    limit: { type: "integer" },
                    offset: { type: "integer" },
                    count: { type: "integer" },
                    instances: {
                      type: "array",
                      items: { type: "object", description: "Keyed by property api_name." },
                    },
                  },
                  required: ["type", "limit", "offset", "count", "instances"],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/objects/{type}/{id}": {
      get: {
        tags: ["objects"],
        summary: "Get one instance, with its links resolved one hop",
        operationId: "getInstance",
        parameters: [
          { $ref: "#/components/parameters/TypeApiName" },
          {
            name: "id",
            in: "path",
            required: true,
            description: "The instance's primary key value.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "The instance's own properties plus every link, resolved one hop in both directions.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    type: { type: "string" },
                    id: {},
                    properties: { type: "object", description: "Keyed by property api_name." },
                    links: {
                      type: "object",
                      description: "Keyed by the link's api_name (outbound) or inverse_api_name (inbound).",
                      additionalProperties: { $ref: "#/components/schemas/LinkValue" },
                    },
                  },
                  required: ["type", "id", "properties", "links"],
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/objects/{type}/{id}/audit": {
      get: {
        tags: ["objects"],
        summary: "Get one instance's audit history",
        operationId: "getInstanceAudit",
        parameters: [
          { $ref: "#/components/parameters/TypeApiName" },
          {
            name: "id",
            in: "path",
            required: true,
            description: "The instance's primary key value.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description:
              "Action invocations recorded against this instance, newest first. Only the type is " +
              "checked, not the instance -- an id with no history returns an empty list rather than " +
              "404, since audit rows are meant to outlive what they describe.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    type: { type: "string" },
                    id: { type: "string" },
                    limit: { type: "integer" },
                    count: { type: "integer" },
                    entries: { type: "array", items: { $ref: "#/components/schemas/AuditEntry" } },
                  },
                  required: ["type", "id", "limit", "count", "entries"],
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/objects/{type}/{id}/actions/{actionName}": {
      post: {
        tags: ["actions"],
        summary: "Invoke a declared action against one instance",
        operationId: "invokeAction",
        parameters: [
          { $ref: "#/components/parameters/TypeApiName" },
          {
            name: "id",
            in: "path",
            required: true,
            description: "The instance's primary key value.",
            schema: { type: "string" },
          },
          {
            name: "actionName",
            in: "path",
            required: true,
            description: "The action's api_name, e.g. deferStart.",
            schema: { type: "string" },
          },
          {
            name: "x-actor",
            in: "header",
            required: false,
            description: "Who is invoking the action, recorded on the audit row. Defaults to \"anonymous\".",
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: false,
          description:
            "Validated against the action_type's parameter_schema (JSON Schema 2020-12). An empty " +
            "body means no parameters.",
          content: {
            "application/json": {
              schema: { type: "object", description: "Shape depends on the action; see GET .../meta/types/{type}." },
            },
          },
        },
        responses: {
          "200": {
            description: "The action ran. `result` is whatever the handler returns.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ActionInvocationResult" },
              },
            },
          },
          "400": { $ref: "#/components/responses/ActionValidationError" },
          "404": {
            description: "Unknown object type, no instance with that id, or the type has no such action.",
            content: {
              "application/json": {
                schema: { type: "object", properties: { error: { type: "string" } } },
              },
            },
          },
          "409": {
            description: "The instance is not in a state the action accepts (e.g. a batch that already started).",
            content: {
              "application/json": {
                schema: { type: "object", properties: { error: { type: "string" } } },
              },
            },
          },
          "501": {
            description: "The ontology declares this action, but no handler implements it yet.",
            content: {
              "application/json": {
                schema: { type: "object", properties: { error: { type: "string" } } },
              },
            },
          },
        },
      },
    },
  },
  components: {
    parameters: {
      TypeApiName: {
        name: "type",
        in: "path",
        required: true,
        description: "The object type's api_name, e.g. batch.",
        schema: { type: "string" },
      },
    },
    responses: {
      NotFound: {
        description: "Unknown type, or no instance with that id.",
        content: {
          "application/json": {
            schema: { type: "object", properties: { error: { type: "string" } } },
          },
        },
      },
      BadRequest: {
        description: "An unknown filter key, or a filter value that does not match the property's type.",
        content: {
          "application/json": {
            schema: { type: "object", properties: { error: { type: "string" } } },
          },
        },
      },
      ActionValidationError: {
        description: "The body is not valid JSON, is not an object, or fails the action's parameter_schema.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                error: { type: "string" },
                details: {
                  type: "array",
                  description: "Present when the body failed JSON Schema validation; one entry per violation.",
                  items: {
                    type: "object",
                    properties: {
                      keyword: { type: "string" },
                      instanceLocation: { type: "string" },
                      error: { type: "string" },
                    },
                  },
                },
              },
              required: ["error"],
            },
          },
        },
      },
    },
    schemas: {
      ObjectType: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          api_name: { type: "string" },
          name: { type: "string" },
          description: { type: "string", nullable: true },
          status: { type: "string", enum: ["active", "experimental", "deprecated"] },
          visibility: { type: "string", enum: ["visible", "prominent", "hidden"] },
          point_of_contact: { type: "string", nullable: true },
          edits_enabled: { type: "boolean" },
          schema: { type: "string", description: "Postgres schema the instance rows live in. No default; every row states it." },
          datasource_table: { type: "string" },
        },
      },
      Property: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          object_type_id: { type: "string", format: "uuid" },
          api_name: { type: "string" },
          name: { type: "string" },
          data_type: {
            type: "string",
            description:
              "The schema declares no CHECK constraint on this column, so a row could in principle " +
              "name something else; these are the values the application actually understands.",
            enum: ["string", "number", "boolean", "enum", "datetime", "date", "json", "string[]"],
          },
          required: { type: "boolean" },
          is_title: { type: "boolean" },
          is_primary_key: { type: "boolean" },
          datasource_column: { type: "string" },
        },
      },
      ActionType: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          object_type_id: { type: "string", format: "uuid" },
          api_name: { type: "string" },
          name: { type: "string" },
          description: { type: "string", nullable: true },
          parameter_schema: { type: "object", description: "JSON Schema for the action's request body." },
        },
      },
      LinkDescription: {
        type: "object",
        description: "A link row with its id references expanded to api_names.",
        properties: {
          api_name: { type: "string" },
          name: { type: "string" },
          inverse_api_name: { type: "string" },
          inverse_name: { type: "string" },
          cardinality: { $ref: "#/components/schemas/Cardinality" },
          direction: { type: "string", enum: ["outbound", "inbound"] },
          effective_cardinality: {
            allOf: [{ $ref: "#/components/schemas/Cardinality" }],
            description: "cardinality as seen from this type; inverted for inbound links.",
          },
          source_type_api_name: { type: "string" },
          target_type_api_name: { type: "string" },
          via_property_api_name: { type: "string" },
          via_datasource_column: { type: "string" },
        },
      },
      LinkValue: {
        type: "object",
        description: "A link resolved one hop, as returned from an instance's detail route.",
        properties: {
          name: { type: "string" },
          direction: { type: "string", enum: ["outbound", "inbound"] },
          cardinality: { $ref: "#/components/schemas/Cardinality" },
          targetType: { type: "string" },
          value: {
            description: "A single instance, an array of instances, or null, depending on cardinality.",
            nullable: true,
          },
        },
      },
      Cardinality: {
        type: "string",
        enum: ["one_to_one", "one_to_many", "many_to_one", "many_to_many"],
      },
      AuditLogEntry: {
        type: "object",
        description:
          "One recorded action invocation. action_type_id/target_type_id are NOT NULL foreign keys " +
          "(an action_type or object_type cannot be deleted while a log row cites it); the *_api_name " +
          "columns are a snapshot taken at write time, kept alongside the ids as the readable label.",
        properties: {
          id: { type: "string", format: "uuid" },
          action_type_id: { type: "string", format: "uuid" },
          action_api_name: { type: "string" },
          target_type_id: { type: "string", format: "uuid" },
          target_type_api_name: { type: "string" },
          target_id: { type: "string" },
          actor: { type: "string" },
          params: { type: "object", nullable: true },
          result: { type: "object", nullable: true },
          created_at: { type: "string", format: "date-time" },
        },
      },
      AuditEntry: {
        type: "object",
        description:
          "One action run against an instance, as returned from its own audit history (a lighter " +
          "shape than AuditLogEntry, joined against the action's current name).",
        properties: {
          action: { type: "string", description: "The action's api_name as snapshotted when it ran." },
          actionName: { type: "string", description: "What that action is called now; may differ from `action` after a rename." },
          actor: { type: "string" },
          params: { type: "object", nullable: true },
          result: { type: "object", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      ActionInvocationResult: {
        type: "object",
        properties: {
          type: { type: "string" },
          id: {},
          action: { type: "string" },
          result: { description: "Whatever the handler returns, e.g. the updated instance." },
        },
        required: ["type", "id", "action", "result"],
      },
    },
  },
} as const;
