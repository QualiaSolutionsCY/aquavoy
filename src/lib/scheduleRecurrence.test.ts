import { describe, it, expect } from "vitest";
import { nextOccurrence, isRecurring } from "./scheduleRecurrence";

/**
 * Unit tests for the pure recurrence helper. Everything is computed against the
 * stored UTC instant, so assertions compare ISO strings to pin the exact instant
 * (date + time-of-day) the runner would re-queue.
 */

describe("scheduleRecurrence/nextOccurrence", () => {
  it("daily → +1 calendar day, same time-of-day", () => {
    const from = new Date("2026-06-05T09:30:00.000Z");
    expect(nextOccurrence(from, "daily").toISOString()).toBe("2026-06-06T09:30:00.000Z");
  });

  it("daily rolls over a month boundary", () => {
    const from = new Date("2026-06-30T18:00:00.000Z");
    expect(nextOccurrence(from, "daily").toISOString()).toBe("2026-07-01T18:00:00.000Z");
  });

  it("weekly → +7 days, same weekday + time", () => {
    const from = new Date("2026-06-01T19:00:00.000Z"); // a Monday
    expect(nextOccurrence(from, "weekly").toISOString()).toBe("2026-06-08T19:00:00.000Z");
  });

  it("monthly normal: Jun 5 → Jul 5, same time", () => {
    const from = new Date("2026-06-05T08:00:00.000Z");
    expect(nextOccurrence(from, "monthly").toISOString()).toBe("2026-07-05T08:00:00.000Z");
  });

  it("monthly clamp: Jan 31 → Feb 28 in a non-leap year", () => {
    const from = new Date("2026-01-31T07:00:00.000Z"); // 2026 is not a leap year
    expect(nextOccurrence(from, "monthly").toISOString()).toBe("2026-02-28T07:00:00.000Z");
  });

  it("monthly clamp: Jan 31 → Feb 29 in a leap year", () => {
    const from = new Date("2024-01-31T07:00:00.000Z"); // 2024 is a leap year
    expect(nextOccurrence(from, "monthly").toISOString()).toBe("2024-02-29T07:00:00.000Z");
  });

  it("monthly clamp: Jan 30 → Feb clamp (28 non-leap)", () => {
    const from = new Date("2026-01-30T12:00:00.000Z");
    expect(nextOccurrence(from, "monthly").toISOString()).toBe("2026-02-28T12:00:00.000Z");
  });

  it("monthly year rollover: Dec 5 → Jan 5 of the next year", () => {
    const from = new Date("2026-12-05T15:45:00.000Z");
    expect(nextOccurrence(from, "monthly").toISOString()).toBe("2027-01-05T15:45:00.000Z");
  });

  it("monthly does not mutate the input Date", () => {
    const from = new Date("2026-06-05T08:00:00.000Z");
    nextOccurrence(from, "monthly");
    expect(from.toISOString()).toBe("2026-06-05T08:00:00.000Z");
  });

  it("isRecurring distinguishes none from repeating cadences", () => {
    expect(isRecurring("none")).toBe(false);
    expect(isRecurring("daily")).toBe(true);
    expect(isRecurring("weekly")).toBe(true);
    expect(isRecurring("monthly")).toBe(true);
  });
});
