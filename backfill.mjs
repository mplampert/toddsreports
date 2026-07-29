// Scheduled function — runs every day and records YESTERDAY's revenue.
//
// Schedule is UTC. 05:15 UTC == 00:15 EST / 01:15 EDT, i.e. always just after
// midnight in New York year-round. We aggregate the *previous* full ET day, so
// the exact firing minute doesn't matter.
import { revenueForDay, ymdDaysAgo } from "../../lib/printavo.mjs";
import { mergeDays } from "../../lib/store.mjs";

export const config = {
  schedule: "15 5 * * *",
};

export default async () => {
  const day = ymdDaysAgo(1); // yesterday, America/New_York
  try {
    const revenue = await revenueForDay(day);
    await mergeDays({ [day]: revenue });
    console.log(`[daily-snapshot] ${day} revenue = ${revenue}`);
    return new Response(JSON.stringify({ ok: true, day, revenue }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error(`[daily-snapshot] FAILED for ${day}:`, err.message);
    return new Response(JSON.stringify({ ok: false, day, error: err.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};
