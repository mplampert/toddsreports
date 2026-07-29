// ============================================================================
//  Printavo GraphQL API v2 client  —  Todd's Sporting Goods revenue pull
// ----------------------------------------------------------------------------
//  Everything you might have to ADJUST after the first real run lives in the
//  CONFIG block right below. Nothing above the dashboard needs the Printavo
//  token — it stays server-side in Netlify env vars.
//
//  Docs: https://www.printavo.com/docs/api/v2
//  Auth: 'email' + 'token' request headers (token from Printavo > My Account).
//  Rate limit: 10 requests / 5 seconds per email or IP  -> we self-throttle.
// ============================================================================

// ----------------------------- CONFIG (adjust here) -------------------------

const PRINTAVO_ENDPOINT = "https://www.printavo.com/api/v2";

// Which number counts as "revenue" for a given calendar day.
//   "invoiced"  -> sum of invoice totals for invoices dated that day (sales).
//   "collected" -> sum of payment amounts received that day (cash in).
// Default is "collected" — money actually received (paid invoices), which is
// what Todd's counts and what matches Printavo's "Revenue and Expenses" report.
// Set PRINTAVO_REVENUE_BASIS=invoiced to switch to sales-booked (invoice totals).
export const REVENUE_BASIS = process.env.PRINTAVO_REVENUE_BASIS || "collected";

// The invoice money field to sum when REVENUE_BASIS === "invoiced".
// Printavo invoices expose several money fields; "total" is the order total.
// If your account returns a GraphQL error naming this field, change it here to
// whatever the /test endpoint shows on a real invoice (e.g. "subtotal",
// "amountPaid", "amountOutstanding").
const INVOICE_TOTAL_FIELD = "total";

// The timestamp field used to bucket a record into a day.
const INVOICE_DATE_FIELD = "createdAt";
// A Printavo Payment carries `amount` and `transactionDate` (the day the money
// was received). transactions is a UNION, so these are read via an inline
// fragment (see TRANSACTIONS_QUERY); non-Payment members are ignored.
const TRANSACTION_DATE_FIELD = "transactionDate";
const TRANSACTION_AMOUNT_FIELD = "amount";

// Page size for pagination. Kept small so one day's pull is a couple requests.
const PAGE_SIZE = 25;

// ----------------------------------------------------------------------------

const EMAIL = process.env.PRINTAVO_EMAIL;
const TOKEN = process.env.PRINTAVO_TOKEN;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Self-throttle: stay comfortably under 10 req / 5s.
let lastCall = 0;
async function throttle() {
  const gap = 600; // ms between calls -> ~1.6 req/s, well under the limit
  const wait = lastCall + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

/** Low-level GraphQL POST against Printavo. Throws on transport or GraphQL errors. */
export async function printavoQuery(query, variables = {}) {
  if (!EMAIL || !TOKEN) {
    throw new Error(
      "Missing PRINTAVO_EMAIL / PRINTAVO_TOKEN environment variables."
    );
  }
  await throttle();

  const res = await fetch(PRINTAVO_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      email: EMAIL,
      token: TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Printavo returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw new Error(`Printavo HTTP ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  }
  if (json.errors) {
    // GraphQL-level errors: almost always a field name that differs on your
    // account. The message tells you exactly which field to fix in CONFIG.
    throw new Error(`Printavo GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// --- Connection shape helper ------------------------------------------------
// Printavo v2 uses the standard GraphQL connection pattern. Different objects
// have been seen with either { nodes } or { edges { node } }. We handle both.
function connectionNodes(conn) {
  if (!conn) return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
  const nodes = conn.nodes ?? (conn.edges ? conn.edges.map((e) => e.node) : []);
  const pageInfo = conn.pageInfo ?? { hasNextPage: false, endCursor: null };
  return { nodes, pageInfo };
}

// --- Date helpers (America/New_York) ---------------------------------------

/** Returns "YYYY-MM-DD" for a Date, in the given IANA timezone. */
export function ymdInTZ(date, tz = "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "YYYY-MM-DD" for N days before now, in America/New_York. */
export function ymdDaysAgo(n, tz = "America/New_York") {
  const d = new Date(Date.now() - n * 86400000);
  return ymdInTZ(d, tz);
}

/**
 * Bucket a Printavo timestamp to "YYYY-MM-DD".
 *
 * Printavo dates come back either as a plain date ("2026-05-01") or, for some
 * payments, as a full timestamp ("2026-05-01T02:00:00Z"). Printavo's own
 * reports bucket by the DATE PART exactly as stored — so we must too. We take
 * the leading YYYY-MM-DD verbatim and do NO timezone conversion: converting a
 * just-after-midnight-UTC payment to New York time would shove it back a day
 * (that was the Apr 30 / May 1 off-by-one). Only genuinely non-ISO values
 * (e.g. an epoch number) fall through to the timezone path.
 */
function toYmd(ts, tz = "America/New_York") {
  if (typeof ts === "string") {
    const m = ts.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  return ymdInTZ(new Date(ts), tz);
}

// --- The two data pulls -----------------------------------------------------
// Both paginate newest-first and stop once records fall before the window,
// so we never depend on server-side date-filter argument names we can't verify.

// NOTE: Printavo's OrderSortField enum has NO created-date option
// (valid values: CUSTOMER_DUE_AT, CUSTOMER_NAME, OWNER, STATUS, TOTAL, VISUAL_ID).
// VISUAL_ID is the invoice number, which increments over time, so sorting by it
// descending gives newest-created invoices first — which is what the early-stop
// pagination below relies on. We still bucket by the real createdAt field.
const INVOICES_QUERY = `
  query Invoices($first: Int!, $after: String) {
    invoices(first: $first, after: $after, sortOn: VISUAL_ID, sortDescending: true) {
      nodes { id ${INVOICE_DATE_FIELD} ${INVOICE_TOTAL_FIELD} }
      pageInfo { hasNextPage endCursor }
    }
  }`;

// transactions returns a TransactionUnion (members: Payment, Refund, Return,
// Expense). You can't select fields directly on a union, so we pull Payment
// fields via an inline fragment. Other members come back as just __typename and
// are ignored (they have no `amount`, so they contribute 0). This feed has NO
// date filter and NO sort argument, so the collected path reads the whole
// payment history and buckets client-side — hence the background backfill.
const TRANSACTIONS_QUERY = `
  query Transactions($first: Int!, $after: String) {
    transactions(first: $first, after: $after) {
      nodes {
        __typename
        ... on Payment { ${TRANSACTION_AMOUNT_FIELD} ${TRANSACTION_DATE_FIELD} }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

/**
 * Sum revenue per day for the inclusive date window [startYmd, endYmd].
 * Returns a Map of "YYYY-MM-DD" -> number. Days with no records are absent.
 */
export async function revenueByDay(startYmd, endYmd, tz = "America/New_York", opts = {}) {
  const invoiced = REVENUE_BASIS === "invoiced";
  const query = invoiced ? INVOICES_QUERY : TRANSACTIONS_QUERY;
  const dateField = invoiced ? INVOICE_DATE_FIELD : TRANSACTION_DATE_FIELD;
  const valueField = invoiced ? INVOICE_TOTAL_FIELD : TRANSACTION_AMOUNT_FIELD;
  const rootKey = invoiced ? "invoices" : "transactions";
  // Early-stop relies on newest-first ordering (invoices: VISUAL_ID desc;
  // transactions: newest-first by default). A short WINDOWED pull — the nightly
  // refresh — uses it to finish in a few pages. A full backfill passes
  // { readAll: true } to page everything, which is the safe source of truth
  // regardless of ordering (and can't time out — it runs as a background job).
  const earlyStop = !opts.readAll;

  const totals = new Map();
  let after = null;
  let guard = 0; // hard stop so a bad cursor can never loop forever

  while (guard++ < 4000) {
    const data = await printavoQuery(query, { first: PAGE_SIZE, after });
    const { nodes, pageInfo } = connectionNodes(data[rootKey]);
    if (nodes.length === 0) break;

    let allBeforeWindow = true;
    for (const n of nodes) {
      const ts = n[dateField];
      if (!ts) continue;
      const day = toYmd(ts, tz);
      if (day > endYmd) {
        allBeforeWindow = false; // newer than window, keep paging back
        continue;
      }
      if (day < startYmd) continue; // older than window
      allBeforeWindow = false;
      const amt = Number(n[valueField]) || 0;
      totals.set(day, (totals.get(day) || 0) + amt);
    }

    // Newest-first (invoices only): once an entire page is older than the
    // window start, stop. Never applied to the unordered transactions feed.
    if (earlyStop) {
      const oldestOnPage = nodes
        .map((n) => (n[dateField] ? toYmd(n[dateField], tz) : "9999-99-99"))
        .reduce((a, b) => (a < b ? a : b), "9999-99-99");
      if (oldestOnPage < startYmd && allBeforeWindow) break;
    }

    if (!pageInfo.hasNextPage) break;
    after = pageInfo.endCursor;
  }
  return totals;
}

/** Revenue for a single calendar day. */
export async function revenueForDay(ymd, tz = "America/New_York") {
  const map = await revenueByDay(ymd, ymd, tz);
  return map.get(ymd) || 0;
}
