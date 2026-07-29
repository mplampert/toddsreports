// First-run sanity check. Hit /api/test after deploy to confirm the token works
// and to SEE the real field names on your account's invoices/transactions.
// If daily-snapshot ever errors, this is where you diagnose it.
import { printavoQuery, REVENUE_BASIS } from "../../lib/printavo.mjs";

export default async () => {
  const out = { basis: REVENUE_BASIS, checks: {} };

  // 1) account query — proves auth headers are accepted.
  try {
    const data = await printavoQuery(`query { account { id companyName } }`);
    out.checks.account = { ok: true, data: data.account };
  } catch (err) {
    out.checks.account = { ok: false, error: err.message };
  }

  // 2) one invoice — shows the exact money/date field names to map in CONFIG.
  try {
    const data = await printavoQuery(`
      query { invoices(first: 1, sortOn: CREATED_AT_DESC) {
        nodes { id createdAt total }
      } }`);
    out.checks.invoiceSample = { ok: true, data: data.invoices };
  } catch (err) {
    out.checks.invoiceSample = { ok: false, error: err.message };
  }

  // 3) one transaction — for the "collected" basis option.
  try {
    const data = await printavoQuery(`
      query { transactions(first: 1) {
        nodes { id createdAt amount }
      } }`);
    out.checks.transactionSample = { ok: true, data: data.transactions };
  } catch (err) {
    out.checks.transactionSample = { ok: false, error: err.message };
  }

  const allOk = Object.values(out.checks).every((c) => c.ok);
  return new Response(JSON.stringify(out, null, 2), {
    status: allOk ? 200 : 502,
    headers: { "content-type": "application/json" },
  });
};
