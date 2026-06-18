/**
 * Pure recurrence helper shared by the scheduled-email (src/lib/mail/scheduled.ts)
 * and scheduled-task (src/lib/agents/scheduledTasks.ts) runners. No IO — given a
 * UTC instant and a recurrence cadence it returns the next occurrence as a Date.
 *
 * Semantics (anchored to the stored UTC instant, see migration 0014):
 *   - daily   → +1 calendar day, same time-of-day.
 *   - weekly  → +7 days (same weekday + time).
 *   - monthly → same day-of-month next month at the same time; if that day does
 *               not exist (e.g. the 31st in February) it CLAMPS to the last day
 *               of the target month.
 *
 * Timezone note (v1 limitation): occurrences are computed by adding calendar
 * units to the stored UTC instant via the UTC date accessors. DST drift across a
 * monthly boundary is accepted and intentionally not corrected here.
 */

/** Recurrence cadence stored on a scheduled row. `none` = fire once. */
export type Recurrence = "none" | "daily" | "weekly" | "monthly";

/** The repeating cadences — every `Recurrence` except `none`. */
export type RepeatingRecurrence = Exclude<Recurrence, "none">;

/** True when a recurrence value actually repeats (i.e. is not `none`). */
export function isRecurring(recurrence: Recurrence): recurrence is RepeatingRecurrence {
  return recurrence !== "none";
}

/** Last day-of-month (1-31) for a given UTC year/month. `month` is 0-indexed. */
function lastDayOfMonth(year: number, month: number): number {
  // Day 0 of the *next* month is the last day of `month` (UTC).
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Compute the next occurrence strictly after `from` for a repeating cadence.
 * The result is always a new Date — `from` is never mutated.
 */
export function nextOccurrence(from: Date, recurrence: RepeatingRecurrence): Date {
  if (recurrence === "daily") {
    const next = new Date(from.getTime());
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  if (recurrence === "weekly") {
    const next = new Date(from.getTime());
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }

  // monthly — advance the month, clamping the day to the target month's length
  // so e.g. Jan 31 → Feb 28/29 and Jan 30 → Feb clamp, rather than overflowing
  // into the following month.
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  const day = from.getUTCDate();

  const targetMonthIndex = month + 1; // may be 12 → Date.UTC rolls to next year
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const clampedDay = Math.min(day, lastDayOfMonth(targetYear, targetMonth));

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      clampedDay,
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
}
