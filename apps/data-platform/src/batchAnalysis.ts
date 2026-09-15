/**
 * 배치를 레시피의 목표 비중 커브에 대비해서 읽어낸다.
 *
 * 발효가 진행될수록 비중은 내려가므로, 목표보다 *위*에 있는 배치는 아직
 * 덜 진행된 것이다: 델타가 양수면 뒤처짐을 뜻하지, 앞섬이 아니다.
 */

/** 레시피의 날짜별 목표 비중, 예: {"day_1": 1.05, "day_8": 1.012}. */
export type SugarCurve = Record<string, number>;

/** 이 값 이하의 편차는 정상(on target)으로 읽는다. */
export const ON_TRACK_TOLERANCE = 0.005;

/** ON_TRACK_TOLERANCE를 넘고 이 값 이하인 편차는 slipping으로 읽는다. */
export const SLIPPING_TOLERANCE = 0.008;

export type DeviationBand = "on-track" | "slipping" | "off-target";

export type Deviation = {
  target: number;
  current: number;
  /** current - target. 양수면 배치가 커브보다 뒤처졌다는 뜻. */
  delta: number;
  /** 어느 방향이든 얼마나 벗어났는지에 따른 색상 밴드. */
  band: DeviationBand;
  /** SLIPPING_TOLERANCE 이상 뒤처짐 — `band`와 달리 방향성이 있음(한쪽만). */
  behind: boolean;
};

/**
 * 비중은 소수점 셋째 자리까지 표기되므로, 비교하기 전에 그보다 훨씬 더
 * 뒤에서 반올림한다.
 *
 * 이렇게 안 하면 1.018 - 1.013이 이진 부동소수점으로 0.005000000000000004가
 * 돼서, 허용오차에 정확히 걸쳐 있는 배치가 오차를 넘은 것처럼 보이게 된다.
 */
function round(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

export type Sample = { day: number; gravity: number };

/** 커브의 점들을 날짜 순으로. `day_<n>` 형태가 아닌 키는 무시한다. */
export function curvePoints(curve: SugarCurve): Sample[] {
  return samples(curve);
}

function samples(curve: SugarCurve): Sample[] {
  const points: Sample[] = [];

  for (const [key, gravity] of Object.entries(curve)) {
    const match = /^day_(\d+)$/.exec(key);
    if (match !== null && typeof gravity === "number") {
      points.push({ day: Number(match[1]), gravity });
    }
  }

  return points.sort((a, b) => a.day - b.day);
}

/**
 * 특정 날짜의 목표 비중.
 *
 * 레시피는 커브를 몇 개의 날짜에서만 샘플링하고, 배치가 그 날짜에 정확히
 * 걸리는 경우는 드물다. 그래서 그 사이 날짜는 앞뒤 샘플 쌍을 가로질러
 * 보간한다 — 바로 이게 샘플들을 단순 체크포인트가 아니라 "커브"로
 * 만들어주는 부분이다. 샘플링된 범위 밖은 가장 가까운 끝값을 그대로 쓴다.
 */
export function targetAt(curve: SugarCurve, day: number): number | null {
  const points = samples(curve);
  const first = points.at(0);
  const last = points.at(-1);
  if (first === undefined || last === undefined) return null;

  if (day <= first.day) return first.gravity;
  if (day >= last.day) return last.gravity;

  let previous = first;
  for (const point of points) {
    if (day <= point.day) {
      const span = point.day - previous.day;
      if (span === 0) return point.gravity;

      const ratio = (day - previous.day) / span;
      return previous.gravity + ratio * (point.gravity - previous.gravity);
    }
    previous = point;
  }

  return last.gravity;
}

function bandFor(delta: number): DeviationBand {
  const size = Math.abs(delta);
  if (size <= ON_TRACK_TOLERANCE) return "on-track";
  if (size <= SLIPPING_TOLERANCE) return "slipping";
  return "off-target";
}

/**
 * 한 배치가 자신의 커브에 비해 어떤 상태인지. 판단할 수 없으면(레시피
 * 커브가 없거나, 발효일수가 없거나, 아직 측정값이 없으면) null.
 */
export function deviationFor(
  curve: SugarCurve | null,
  day: number | null,
  current: number | null,
): Deviation | null {
  if (curve === null || day === null || current === null) return null;

  const target = targetAt(curve, day);
  if (target === null) return null;

  const delta = round(current - target);

  return {
    target,
    current,
    delta,
    band: bandFor(delta),
    // 의도적으로 한쪽 방향만 본다: 커브보다 앞서가는 배치는 뒤처진 게 아니다.
    behind: delta >= SLIPPING_TOLERANCE,
  };
}

/**
 * 특정 날짜의 목표값을 실제로 읽어낸 커브 포인트들: 그 날짜가 샘플과
 * 정확히 겹치면 그 샘플 하나, 아니면 그 사이에 걸친 양쪽 샘플, 샘플링
 * 범위 밖이면 가장 가까운 끝점.
 *
 * 목표값이 실제로 거기서 도출된 포인트들이라서, UI에서 이것들을 짚어줄
 * 가치가 있다.
 */
export function bracketingDays(curve: SugarCurve, day: number): Set<number> {
  const points = samples(curve);
  const first = points.at(0);
  const last = points.at(-1);
  if (first === undefined || last === undefined) return new Set();

  if (day <= first.day) return new Set([first.day]);
  if (day >= last.day) return new Set([last.day]);

  let previous = first;
  for (const point of points) {
    if (point.day === day) return new Set([day]);
    if (day < point.day) return new Set([previous.day, point.day]);
    previous = point;
  }

  return new Set([last.day]);
}

/** 배치가 발효를 진행해온 기간. */
export type Window = { from: Date; to: Date };

/**
 * 이 배치가 지금 탱크에 들어가 있었던 기간.
 *
 * 기록된 시작일이 있으면 그걸 기준으로 삼는다 — 배치 자신이 말하는 값이기
 * 때문. 없으면 발효일수로 대신 계산한다.
 */
export function fermentationWindow(
  plannedStart: string | null,
  daysFermenting: number | null,
  now: Date,
): Window | null {
  if (plannedStart !== null) {
    const started = Date.parse(plannedStart);
    if (!Number.isNaN(started)) return { from: new Date(started), to: now };
  }

  if (daysFermenting !== null) {
    const from = new Date(now);
    from.setDate(from.getDate() - daysFermenting);
    return { from, to: now };
  }

  return null;
}

/** 타임스탬프가 기간 안에 들어가는지. 파싱 불가능한 값은 포함 안 됨. */
export function withinWindow(stamp: unknown, window: Window | null): boolean {
  if (window === null || typeof stamp !== "string") return false;

  const at = Date.parse(stamp);
  return !Number.isNaN(at) && at >= window.from.getTime() && at <= window.to.getTime();
}

/** numeric 컬럼을 파싱한다 — API는 정밀도를 지키려고 문자열로 보낸다. */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `now`로 끝나는 기간 안에 정비받은 탱크들.
 *
 * 로그는 작업이 끝난 시각으로 날짜를 매기고, 없으면 시작 시각으로 폴백한다
 * — 아직 진행 중인 항목은 완료일이 없지만 분명 "최근"이기 때문이다.
 */
export function tanksServicedSince(
  maintenance: readonly Record<string, unknown>[],
  from: Date,
  now: Date,
): Set<string> {
  const serviced = new Set<string>();

  for (const log of maintenance) {
    if (log["targetType"] !== "tank") continue;

    const targetId = log["targetId"];
    if (typeof targetId !== "string") continue;

    const stamp = log["completedAt"] ?? log["startedAt"];
    if (typeof stamp !== "string") continue;

    const at = Date.parse(stamp);
    if (Number.isNaN(at)) continue;

    if (at >= from.getTime() && at <= now.getTime()) {
      serviced.add(targetId);
    }
  }

  return serviced;
}
