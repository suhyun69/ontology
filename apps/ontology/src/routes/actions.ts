import { Validator } from "@cfworker/json-schema";
import type { Schema } from "@cfworker/json-schema";
import { Hono } from "hono";
import { sql } from "kysely";
import { findActionHandler } from "../actions/registry.ts";
import type { ActionContext, ActionParams } from "../actions/types.ts";
import { HttpError } from "../errors.ts";
import { selectInstances } from "../instances.ts";
import { columnRef, findActionType, loadProperties, primaryKeyProperty, requireObjectType } from "../metadata.ts";

export const actionRoutes = new Hono();

/**
 * parameter_schema rows carry no $schema, so the draft is set here. See
 * seeds/01-manufacturing-foundation.sql.
 */
const SCHEMA_DRAFT = "2020-12";

/**
 * Until there is authentication, actions are attributed to whoever claims the
 * header. The audit row needs a value, and an obviously provisional one beats
 * silently recording every write as the same anonymous actor.
 */
const ACTOR_HEADER = "x-actor";
const DEFAULT_ACTOR = "anonymous";

/** An absent or empty body means "no parameters", not a malformed request. */
async function readParams(raw: string): Promise<ActionParams> {
  if (raw.trim() === "") {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new HttpError(400, `request body is not valid JSON: ${(error as Error).message}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "request body must be a JSON object");
  }
  return parsed as ActionParams;
}

actionRoutes.post("/:type/:id/actions/:actionName", async (c) => {
  const lookup = await requireObjectType(c.req.param("type")); // 타입 확인. :type 경로 파라미터를 메타데이터의 object_type.api_name과 매칭, 없으면 404 
  const { metaSchema, objectType } = lookup;
  const id = c.req.param("id");
  const actionName = c.req.param("actionName");

  // 인스턴스 조회
  // 그 타입의 property 행들을 불러와 PK 속성을 찾고(primaryKeyProperty), 읽기 라우트와 동일한 selectInstances()로 :id에 해당하는 행을 1개 조회. 없으면 404. 
  // 여기서 얻은 instance는 이미 api_name 기준으로 키가 매겨져 있음(예: plannedStart, snake_case 아님).
  const properties = await loadProperties(metaSchema, objectType.id);
  const key = primaryKeyProperty(objectType, properties);

  const [instance] = await selectInstances(objectType, properties, {
    conditions: [sql`${columnRef(key)} = ${id}`],
    limit: 1,
  });
  if (instance === undefined) {
    throw new HttpError(404, `no ${objectType.api_name} with ${key.api_name} ${JSON.stringify(id)}`);
  }

  // 액션 존재 확인
  // findActionType(metaSchema, objectType.id, actionName)로 그 타입에 :actionName이라는 action_type이 선언돼 있는지 확인. 없으면 404.findActionType(metaSchema, objectType.id, actionName)로 그 타입에 :actionName이라는 action_type이 선언돼 있는지 확인. 없으면 404.
  const actionType = await findActionType(metaSchema, objectType.id, actionName);
  if (actionType === undefined) {
    throw new HttpError(404, `${objectType.api_name} has no action ${actionName}`);
  }

  // 파라미터 파싱 + 검증
  // 바디가 비어있으면 {}로 간주(파라미터 없음도 정상 요청), JSON이 아니면 400, 객체가 아니면(배열/null 등) 400.
  // @cfworker/json-schema의 Validator로 그 액션의 parameter_schema(JSON Schema 2020-12, DB의 action_type.parameter_schema에 저장된 값)에 대해 검증. 실패하면 400 + details에 어떤 필드가 어떤 키워드를 위반했는지 배열로 담아줌.
  // 핵심 설계: 이 검증이 핸들러 실행보다 먼저 일어남 — 핸들러는 "스키마를 통과한 파라미터"만 보게 되고, 모양이 틀린 입력을 직접 다룰 필요가 없음.
  const params = await readParams(await c.req.text()); 
  const result = new Validator(
    actionType.parameter_schema as Schema,
    SCHEMA_DRAFT,
    false,
  ).validate(params);

  if (!result.valid) {
    throw new HttpError(
      400,
      `parameters do not match the schema for ${objectType.api_name}.${actionType.api_name}`,
      result.errors.map((e) => ({
        keyword: e.keyword,
        instanceLocation: e.instanceLocation,
        error: e.error,
      })),
    );
  }

  // 핸들러 조회
  // findActionHandler(objectType.api_name, actionType.api_name)로 "Batch.deferStart" 같은 키를 actions/registry.ts의 맵에서 찾음. 
  // 온톨로지엔 선언돼 있지만 코드에 구현이 없으면 404가 아니라 501 — "그런 액션 자체가 없다"와 "있는데 서버가 아직 안 만들었다"를 구분.
  const handler = findActionHandler(objectType.api_name, actionType.api_name);
  if (handler === undefined) {
    throw new HttpError(
      501,
      `${objectType.api_name}.${actionType.api_name} is declared in the ontology but has no handler`,
    );
  }

  // 컨텍스트 구성 + 실행
  // ActionContext에 metaSchema, objectType, actionType, properties, 그리고 actor(요청의 x-actor 헤더, 없으면 "anonymous" — 아직 인증이 없어서 임시방편)를 담아 핸들러를 호출. 
  // 핸들러는 (instance, params, context)를 받아 비즈니스 로직을 실행하고 결과를 반환.
  const context: ActionContext = {
    metaSchema,
    objectType,
    actionType,
    properties,
    actor: c.req.header(ACTOR_HEADER) ?? DEFAULT_ACTOR,
  };

  // 응답
  // result는 핸들러가 반환한 값 그대로(현재 유일한 핸들러인 batchDeferStart는 업데이트된 인스턴스를 반환).
  return c.json({
    type: objectType.api_name,
    id: instance[key.api_name],
    action: actionType.api_name,
    result: await handler(instance, params, context),
  });

  // 이 라우트가 직접 하지 않는 것 — 핸들러(actions/manufacturing/batchDeferStart.ts)에 위임된 부분:
  // "지금 이 상태에서 이 액션을 해도 되는가"(예: 배치가 planned 상태인지) → 핸들러가 검사, 안 되면 409
  // 실제 DB 쓰기 + audit_log 기록(한 트랜잭션)
  // 비즈니스 규칙에 따른 값 검증(예: 새 시작일이 미래인지) → 400
});
