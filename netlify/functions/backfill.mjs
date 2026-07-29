// One-shot history loader so the chart isn't empty on day one.
//   GET /api/backfill?days=90   (default 90, max 730)
// Pulls revenue per day for the window and merges it into the stored series.
// Safe to re-run; it overwrites those days with fresh numbers.
import { revenueByDay, ymdDaysAgo, ymdInTZ } from "../../lib/printavo.mjs";
import { mergeDays } from "../../lib/store.mjs";

export default async (req) => {
  const url = new URL(req.url);
  let days = parseInt(url.searchParams.get("days") || "90", 10);
  if (!Number.isFinite(days) || days < 1) days = 90;
  if (days > 730) days = 730;

  const start = ymdDaysAgo(days);
  const end = ymdInTZ(new Date()); // today (ET); today's partial total included

  try {
    const map = await revenueByDay(start, end);
    const entries = Object.fromEntries(map);
    await mergeDays(entries);
    return new Response(
      JSON.stringify({
        ok: true,
        window: { start, end },
        daysWithRevenue: Object.keys(entries).length,
      }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};
