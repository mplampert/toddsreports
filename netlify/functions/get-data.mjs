// Returns the stored revenue series as a sorted array the dashboard can chart.
// GET /api/data  ->  { basis, series: [{ date, revenue }], updatedAt }
import { readSeries } from "../../lib/store.mjs";
import { REVENUE_BASIS } from "../../lib/printavo.mjs";

export default async () => {
  const raw = await readSeries();
  const series = Object.entries(raw)
    .map(([date, revenue]) => ({ date, revenue: Number(revenue) || 0 }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return new Response(
    JSON.stringify({ basis: REVENUE_BASIS, count: series.length, series }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=300",
      },
    }
  );
};
