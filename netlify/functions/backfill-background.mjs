// BACKGROUND function — the "-background" suffix tells Netlify to return 202 to
// the caller immediately and let this run up to 15 minutes. That's required
// because Printavo's payments feed (transactions) has NO date filter and NO
// sort, so to get "collected per day" we page the ENTIRE payment history and
// bucket it ourselves — which can take a couple minutes on a long history and
// would time out a normal 10-second function.
//
// It REPLACES the stored series (not merge), so re-running also wipes any stale
// data from an earlier basis (e.g. the old invoiced numbers).
import { revenueByDay, ymdInTZ, REVENUE_BASIS } from "../../lib/printavo.mjs";
import { writeSeries } from "../../lib/store.mjs";

export default async () => {
  const end = ymdInTZ(new Date());
  const start = "2000-01-01"; // effectively "all history"
  try {
    const map = await revenueByDay(start, end);
    const series = Object.fromEntries(map);
    await writeSeries(series);
    console.log(`[backfill] basis=${REVENUE_BASIS} wrote ${Object.keys(series).length} days`);
    return new Response(
      JSON.stringify({ ok: true, basis: REVENUE_BASIS, days: Object.keys(series).length }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    console.error("[backfill] FAILED:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};
