/**
 * 프로세스 시계를 COURSE_NOW에 고정한다.
 *
 * 온톨로지의 데이터는 오늘 날짜가 아니라 내러티브 타임라인 위에 있어서,
 * "이 날짜가 미래인가?"를 묻는 핸들러는 바로 그 타임라인을 기준으로 물어야
 * 한다 — 실제 시계를 쓰면 시드된 planned start들이 과거로 흘러가버려서,
 * 그 값을 기준으로 가드를 거는 액션들이 더는 도달 불가능해진다.
 *
 * 이 모듈을 import하면 오버라이드가 설치된다. 호출하는 함수가 아니라
 * import의 부작용(side effect)으로 설치되는 이유는, 다른 모듈이 시간을
 * 읽을 기회를 갖기 전에 먼저 자리잡아야 하기 때문 — index.ts가 이걸 제일
 * 먼저 import하는 이유도 그래서다.
 *
 * "지금"을 묻는 두 가지 방법만 리다이렉트된다:
 *
 *   Date.now()   -> 고정된 시각
 *   new Date()   -> 고정된 시각
 *   new Date(v)  -> 전과 똑같이 그대로 파싱
 *
 * offset은 시작 시점에 딱 한 번 고정되므로, 그 뒤로는 시계가 멈추지 않고
 * 정상 속도로 흘러간다.
 */

const ANCHOR_VAR = "COURSE_NOW";

/** 오버라이드가 들어가기 전에 미리 잡아둔다 — 그래야 바뀐 시계가 실제 시계를 읽을 수 있다. */
const RealDate = Date;

/**
 * 고정된 시각이 실제 시각으로부터 얼마나 떨어져 있는지. 앵커가 설정 안 돼
 * 있으면 null.
 *
 * COURSE_NOW가 없으면 실제 시계를 그대로 둔다 — 오버라이드는 옵트인이다.
 * 파싱할 수 없는 값은 결함으로 취급한다: 실제 시간으로 조용히 폴백하면
 * 겉으론 동작한 것처럼 보이면서 서버가 조용히 엉뚱한 타임라인으로 돌게 된다.
 */
function anchorOffsetMs(): number | null {
  const raw = process.env[ANCHOR_VAR];
  if (raw === undefined || raw.trim() === "") {
    return null;
  }

  const anchor = RealDate.parse(raw);
  if (Number.isNaN(anchor)) {
    throw new Error(
      `${ANCHOR_VAR} is not a date this runtime can parse: ${JSON.stringify(raw)}. ` +
        `Use an ISO 8601 instant, e.g. 2026-04-30T09:00:00Z.`,
    );
  }

  return anchor - RealDate.now();
}

const offsetMs = anchorOffsetMs();

if (offsetMs !== null) {
  /**
   * 서브클래스가 아니라 프록시: Date의 나머지 모든 것 — parse, UTC,
   * prototype, instanceof, 상속 — 은 그대로 동작하고, 아래 두 트랩만 다르게 움직인다.
   */
  const AnchoredDate = new Proxy(RealDate, {
    construct(target, args, newTarget) {
      // 인자가 있다는 건 호출자가 특정 순간을 명시한다는 뜻이지, "지금"을
      // 묻는 게 아니다.
      return args.length === 0
        ? Reflect.construct(target, [RealDate.now() + offsetMs], newTarget)
        : Reflect.construct(target, args, newTarget);
    },

    get(target, property, receiver) {
      if (property === "now") {
        return () => RealDate.now() + offsetMs;
      }
      return Reflect.get(target, property, receiver);
    },
  });

  globalThis.Date = AnchoredDate;

  const drift = Math.round(offsetMs / 1000);
  console.log(
    `clock anchored to ${ANCHOR_VAR}=${new Date().toISOString()} ` +
      `(${drift >= 0 ? "+" : ""}${drift}s from real time)`,
  );
}

/** 보정하면 안 되는 곳을 위한, 진짜 벽시계 시각. */
export function realNow(): number {
  return RealDate.now();
}
