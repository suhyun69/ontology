import { db } from "../../db.ts";
import { HttpError } from "../../errors.ts";
import { toApiShape } from "../../instances.ts";
import type { Instance } from "../../instances.ts";
import { defineAction } from "../types.ts";
import type { ActionContext } from "../types.ts";

/**
 * 이 핸들러가 읽는 Batch의 필드. 라우트가 넘겨주는 형태 그대로 키를 잡는다 —
 * datasource_column이 아니라 property의 api_name 기준.
 */
type BatchInstance = Instance & {
  id: string;
  status: string;
  plannedStart: string | null;
};

type DeferStartParams = {
  newPlannedStart: string;
};

/**
 * 아직 시작하지 않은 배치만 시작일을 미룰 수 있다. 스키마에서는 상태값을
 * lowercase로 적는다; 전체 목록은 sql/manufacturing.sql 참고.
 */
const DEFERRABLE_STATUS = "planned";

async function deferStart(
  batch: BatchInstance,
  params: DeferStartParams,
  context: ActionContext,
): Promise<unknown> {
  // 모양(shape)은 라우트의 JSON Schema 검사에서 이미 끝났다; 남은 건 이 배치를
  // 이 날짜로 미뤄도 되는지 여부뿐이다.
  if (batch.status !== DEFERRABLE_STATUS) {
    throw new HttpError(
      409,
      `batch ${batch.id} is ${batch.status}, and only a ${DEFERRABLE_STATUS} batch can have its start deferred`,
    );
  }

  const newPlannedStart = new Date(params.newPlannedStart);
  const now = new Date();
  if (newPlannedStart.getTime() <= now.getTime()) {
    throw new HttpError(
      400,
      `newPlannedStart must be in the future, but ${newPlannedStart.toISOString()} is not after ${now.toISOString()}`,
    );
  }

  // 쓰기와 그 audit 행은 한 세트다: planned_start가 기록 없이 바뀌는 것이야말로
  // 이 로그가 존재하는 이유다.
  return await db.transaction().execute(async (trx) => {
    const updated = await trx
      .updateTable("manufacturing.batch")
      .set({ planned_start: newPlannedStart })
      .where("id", "=", batch.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    await trx
      .withSchema(context.metaSchema)
      .insertInto("audit_log")
      .values({
        // 이중 스냅샷: id는 이 행을 현재 메타데이터와 연결해주고, api_name은
        // 그 id들을 null로 만드는 리네임/삭제 이후에도 살아남는다.
        action_type_id: context.actionType.id,
        action_api_name: context.actionType.api_name,
        target_type_id: context.objectType.id,
        target_type_api_name: context.objectType.api_name,
        target_id: batch.id,
        actor: context.actor,
        params: { newPlannedStart: params.newPlannedStart },
        result: {
          previousPlannedStart: batch.plannedStart,
          plannedStart: updated.planned_start,
        },
      })
      .execute();

    return toApiShape(updated, context.properties);
  });
}

export const batchDeferStart = defineAction(deferStart);
