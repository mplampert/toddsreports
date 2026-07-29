// Scheduled nightly refresh — runs ~00:15 ET (05:15 UTC, year-round, since we
// aggregate whole calendar days it doesn't matter that EST/EDT shifts the hour).
//
// Instead of only recording "yesterday", it re-pulls a rolling WINDOW of the
// last few weeks and rewrites those days. That way anything you back-date, edit,
// or refund within the window self-heals automatically — you don't have to press
// Backfill. It's fast because the windowed pull stops paging once it's past the
// window (newest-first), unlike the full backfill.
import { revenueByDay, ymdDaysAgo, ymdInTZ } from "../../lib/printavo.mjs";
import { mergeDays } from "../../lib/store.mjs";

export const config = {
  schedule: "15 5 * * *",
};

const WINDOW_DAYS = 21; // re-check the last 3 weeks each night

export default async () => {
  const end = ymdInTZ(new Date());
  const start = ymdDaysAgo(WINDOW_DAYS);
  try {
    const map = await revenueByDay(start, end); // windowed → early-stop, fast

    // Write EVERY day in the window, including 0 — so a day that had all its
    // payments removed/moved gets corrected too, not just days that still have some.
    const entries = {};
    for (let i = 0; i <= WINDOW_DAYS; i++) {
      const day = ymdDaysAgo(i);
      entries[day] = map.get(day) || 0;
    }
    await mergeDays(entries);
    console.log(`[nightly] refreshed ${start}..${end}`);
    return new Response(JSON.stringify({ ok: true, window: { start, end } }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error(`[nightly] FAILED:`, err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};
