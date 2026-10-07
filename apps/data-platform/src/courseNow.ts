/**
 * 브라우저에서의 코스 시계.
 *
 * API는 자신의 시계를 COURSE_NOW에 고정한다(온톨로지의 clock.ts 참고). 그래서
 * 이 UI가 "최근 7일" 같은 기간을 측정할 때도 똑같은 시점을 기준으로 삼아야
 * 한다. 대신 실제 시계를 읽으면, 코스의 타임라인이 아니라 오늘에 대한
 * 질문에 조용히 답해버리게 되고 그 답은 겉으로는 멀쩡해 보인다.
 *
 * vite.config.ts가 빌드 시점에 주입한다 — 워크스페이스 .env에서 이 변수
 * 하나만 읽어온다.
 */
declare const __COURSE_NOW__: string | null;

function anchorOffsetMs(): number {
  if (__COURSE_NOW__ === null) return 0;

  const anchor = Date.parse(__COURSE_NOW__);
  if (Number.isNaN(anchor)) {
    console.warn(`COURSE_NOW is not a parseable date: ${__COURSE_NOW__}. Using the real clock.`);
    return 0;
  }

  return anchor - Date.now();
}

/** 로드 시점에 고정 — 그 뒤로는 시계가 정상 속도로 흘러간다. */
const offsetMs = anchorOffsetMs();

/** 코스 시계가 애초에 설정돼 있는지. */
export const courseClockActive = offsetMs !== 0;

/** 시계가 고정된 기준 ISO 문자열 — 화면 표시용. */
export const courseNowAnchor = __COURSE_NOW__;

export function courseNow(): Date {
  return new Date(Date.now() + offsetMs);
}

/** 코스의 "지금"으로부터 `days`일 전 시점 — 기간 조회용. */
export function daysBeforeCourseNow(days: number): Date {
  const from = courseNow();
  from.setDate(from.getDate() - days);
  return from;
}
