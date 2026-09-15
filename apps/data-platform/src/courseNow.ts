/**
 * The course's clock, in the browser.
 *
 * The API anchors its own clock to COURSE_NOW (see the ontology's clock.ts), so
 * a window this UI measures -- "in the last 7 days" -- has to be measured from
 * the same instant. Reading the real clock instead would quietly answer a
 * question about today rather than about the course's timeline, and the answer
 * would look perfectly plausible.
 *
 * Injected at build time by vite.config.ts, which reads only this one variable
 * out of the workspace .env.
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

/** Fixed at load, so the clock then advances at the ordinary rate. */
const offsetMs = anchorOffsetMs();

/** Whether a course clock is configured at all. */
export const courseClockActive = offsetMs !== 0;

/** The ISO string the clock was anchored to, for display. */
export const courseNowAnchor = __COURSE_NOW__;

export function courseNow(): Date {
  return new Date(Date.now() + offsetMs);
}

/** The instant `days` before the course's now, for a trailing window. */
export function daysBeforeCourseNow(days: number): Date {
  const from = courseNow();
  from.setDate(from.getDate() - days);
  return from;
}
