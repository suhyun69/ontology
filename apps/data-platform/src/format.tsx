import { Classes, Tag } from "@blueprintjs/core";
import type { ReactNode } from "react";
import type { Instance, Property, TypeDetail } from "./api.ts";

/** null/없음 값을 대신 보여준다 — 빈 셀이 그냥 빈 문자열로 읽히지 않게. */
export function Empty() {
  return <span className={Classes.TEXT_MUTED}>—</span>;
}

function formatTimestamp(value: unknown, withTime: boolean): ReactNode {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value);

  return withTime ? parsed.toLocaleString() : parsed.toLocaleDateString();
}

/**
 * 선언된 data_type이 요구하는 방식대로 값을 렌더링한다.
 *
 * numeric 컬럼은 문자열로 온다 — node-postgres는 float64에 안 들어가는 값을
 * 그대로 보내지 않기 때문(API의 db.ts에 있는 Numeric 타입 참고) — 그래서
 * numeric 문자열은 파싱해서 재포맷하지 않고 온 그대로 출력한다. 파싱해버리면
 * 그 문자열이 지키려는 정밀도를 잃는 유일한 방법이 되기 때문.
 */
export function formatValue(value: unknown, dataType: string): ReactNode {
  if (value === null || value === undefined || value === "") return <Empty />;

  switch (dataType) {
    case "boolean":
      return <Tag minimal>{value === true ? "true" : "false"}</Tag>;

    case "enum":
      return <Tag minimal>{String(value)}</Tag>;

    case "datetime":
      return formatTimestamp(value, true);

    case "date":
      return formatTimestamp(value, false);

    case "number":
      return typeof value === "number" ? value.toLocaleString() : String(value);

    case "string[]": {
      if (!Array.isArray(value)) return String(value);
      if (value.length === 0) return <Empty />;
      return (
        <span className="ox-tag-row">
          {value.map((entry, index) => (
            <Tag minimal key={`${String(entry)}:${index}`}>
              {String(entry)}
            </Tag>
          ))}
        </span>
      );
    }

    case "json":
      return <pre className="ox-json">{JSON.stringify(value, null, 2)}</pre>;

    default:
      return String(value);
  }
}

// ------------------------------------------------------- 메타데이터 조회

/** 인스턴스의 id를 담고 있는 속성. */
export function primaryKeyProperty(meta: TypeDetail): Property | undefined {
  return meta.properties.find((property) => property.is_primary_key);
}

/**
 * 인스턴스 전체를 대표하는 속성.
 *
 * 타입마다 어떤 속성인지가 다르다 — Tank는 `name`으로, Batch는 자기 id로
 * 제목을 삼음 — 그래서 메타데이터에서 가져오고, title을 전혀 지정 안 한
 * 타입이면 primary key로 폴백한다.
 */
export function titleProperty(meta: TypeDetail): Property | undefined {
  return meta.properties.find((property) => property.is_title) ?? primaryKeyProperty(meta);
}

/** 모든 타입이 status를 선언하지는 않는다; 선언한 타입만 컬럼이 하나 더 생긴다. */
export function statusProperty(meta: TypeDetail): Property | undefined {
  return meta.properties.find((property) => property.api_name === "status");
}

/** 링크 목록 등에서 인스턴스 자신을 나타낼 때 어떻게 라벨링할지. */
export function instanceLabel(instance: Instance, meta: TypeDetail | undefined): string {
  if (meta === undefined) return "…";

  const title = titleProperty(meta);
  const value = title === undefined ? undefined : instance[title.api_name];
  if (value !== null && value !== undefined && value !== "") return String(value);

  return String(instanceId(instance, meta) ?? "—");
}

/** 인스턴스의 id. 타입이 primary key를 선언하지 않았으면 undefined. */
export function instanceId(instance: Instance, meta: TypeDetail | undefined): string | undefined {
  if (meta === undefined) return undefined;

  const key = primaryKeyProperty(meta);
  if (key === undefined) return undefined;

  const value = instance[key.api_name];
  return value === null || value === undefined ? undefined : String(value);
}
