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
              "and string_array/json properties, return 400.",
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
        description: "The object type's api_name, e.g. Batch.",
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
          visibility: { type: "string", enum: ["normal", "prominent", "hidden"] },
          point_of_contact: { type: "string", nullable: true },
          edits_enabled: { type: "boolean" },
          schema: { type: "string" },
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
            enum: ["string", "integer", "double", "boolean", "timestamp", "date", "string_array", "json"],
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
