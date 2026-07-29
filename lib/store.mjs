// Netlify Blobs persistence. One JSON blob holds the whole daily series:
//   { "YYYY-MM-DD": revenueNumber, ... }
// Daily snapshot writes one key; backfill merges many. Reads are a single get.
import { getStore } from "@netlify/blobs";

const STORE = "todds-revenue";
const KEY = "series.json";

function store() {
  return getStore(STORE);
}

export async function readSeries() {
  const data = await store().get(KEY, { type: "json" });
  return data || {};
}

export async function writeSeries(series) {
  await store().setJSON(KEY, series);
}

/** Merge day->revenue entries into the stored series and persist. */
export async function mergeDays(entries) {
  const series = await readSeries();
  for (const [day, revenue] of Object.entries(entries)) {
    series[day] = Number(revenue) || 0;
  }
  await writeSeries(series);
  return series;
}
