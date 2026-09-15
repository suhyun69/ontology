/**
 * Anchors the process clock to COURSE_NOW.
 *
 * The ontology's data sits on a narrative timeline rather than today's, so a
 * handler asking "is this date in the future?" has to be asking about that
 * timeline -- with the real clock, seeded planned starts drift into the past
 * and actions that guard on them stop being reachable.
 *
 * Importing this module installs the override. It is a side effect rather than
 * a function to call, so that it is in place before any other module has a
 * chance to read the time; index.ts imports it first for that reason.
 *
 * Only the two ways of asking for *now* are redirected:
 *
 *   Date.now()   -> anchored
 *   new Date()   -> anchored
 *   new Date(v)  -> parsed exactly as before
 *
 * The offset is fixed once, at startup, so the clock then advances at the
 * ordinary rate rather than freezing.
 */

const ANCHOR_VAR = "COURSE_NOW";

/** Kept before the override goes in, so the shifted clock can read the real one. */
const RealDate = Date;

/**
 * How far the anchored clock sits from the real one, or null when no anchor is
 * configured.
 *
 * An absent COURSE_NOW leaves the real clock alone -- the override is opt-in.
 * One that cannot be parsed is a fault: falling back to real time would look
 * like it worked while quietly putting the server on the wrong timeline.
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
   * A proxy rather than a subclass: everything else about Date -- parse, UTC,
   * the prototype, instanceof, subclassing -- keeps working untouched, and
   * only the two traps below diverge.
   */
  const AnchoredDate = new Proxy(RealDate, {
    construct(target, args, newTarget) {
      // Arguments mean the caller is naming a moment, not asking for this one.
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

/** The true wall clock, for anything that must not be shifted. */
export function realNow(): number {
  return RealDate.now();
}
