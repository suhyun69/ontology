/**
 * Reading a batch against its recipe's target sugar curve.
 *
 * Fermentation drives gravity down, so a batch sitting *above* its target has
 * not come far enough: a positive delta means behind, not ahead.
 */

/** A recipe's target gravity by day, e.g. {"day_1": 1.05, "day_8": 1.012}. */
export type SugarCurve = Record<string, number>;

/** Deviation at or under this reads as on target. */
export const ON_TRACK_TOLERANCE = 0.005;

/** Deviation over ON_TRACK_TOLERANCE and at or under this reads as slipping. */
export const SLIPPING_TOLERANCE = 0.008;

export type DeviationBand = "on-track" | "slipping" | "off-target";

export type Deviation = {
  target: number;
  current: number;
  /** current - target. Positive means the batch is behind its curve. */
  delta: number;
  /** Colour band, from how far off it is in either direction. */
  band: DeviationBand;
  /** Behind by SLIPPING_TOLERANCE or more -- directional, unlike `band`. */
  behind: boolean;
};

/**
 * Gravity is quoted to three decimals, so a delta is rounded well past that
 * before it is compared.
 *
 * Without this, 1.018 - 1.013 is 0.005000000000000004 in binary floating point
 * and a batch sitting exactly on the tolerance would be shown as over it.
 */
function round(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

type Sample = { day: number; gravity: number };

/** The curve's points, in day order. Keys that are not `day_<n>` are ignored. */
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
 * The target gravity on a given day.
 *
 * Recipes sample the curve at a handful of days, and batches are rarely on one
 * of them, so a day in between is interpolated across the surrounding pair --
 * that is what makes the samples a curve rather than a set of checkpoints.
 * Outside the sampled range the nearest endpoint holds.
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
 * How one batch stands against its curve, or null when that cannot be said --
 * a batch with no recipe curve, no day count, or no reading yet.
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
    // Deliberately one-sided: a batch ahead of its curve is not behind on it.
    behind: delta >= SLIPPING_TOLERANCE,
  };
}

/** Parses a numeric column, which the API sends as a string to keep precision. */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Tanks serviced within the trailing window ending at `now`.
 *
 * A log is dated by when the work finished, falling back to when it started --
 * an entry still in progress has no completion date but is certainly recent.
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
