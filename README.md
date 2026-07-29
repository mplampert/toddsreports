# Todd's Sporting Goods — Printavo Revenue Dashboard

A static Netlify site that charts **daily revenue over time**, pulled from the
Printavo GraphQL API v2. A scheduled function records yesterday's revenue every
night; the page reads a stored snapshot and draws the trend.

## Why it's built this way (read this first)

Printavo authenticates with an `email` + `token` header pair. **That token can
never touch browser JavaScript** — anyone could read it in View Source or the
Network tab. So the token lives only in Netlify environment variables, and all
Printavo calls happen inside serverless functions. The browser only ever talks
to *your own* functions.

```
Printavo API  <—(token)—  Netlify Functions  ——(plain JSON)——>  index.html
                             │
                             └── Netlify Blobs (stored daily series)
```

## What each piece does

| File | Role |
|---|---|
| `netlify/functions/daily-snapshot.mjs` | **Scheduled** ~00:15 ET nightly. Records the prior day's revenue into Blobs. |
| `netlify/functions/get-data.mjs` | `GET /api/data` — returns the stored series for the chart. |
| `netlify/functions/backfill.mjs` | `GET /api/backfill?days=90` — loads history so the chart isn't empty on day one. |
| `netlify/functions/test-connection.mjs` | `GET /api/test` — sanity check + shows real field names. |
| `lib/printavo.mjs` | Printavo client. **All the tunable config is at the top of this file.** |
| `lib/store.mjs` | Netlify Blobs read/write. |
| `public/index.html` | The dashboard (self-contained, no external libraries). |

## Setup (~10 minutes)

1. **Get your Printavo API token.** Printavo → **My Account** → API section. Note
   the email tied to the account too.

2. **Push this folder to a GitHub repo**, then in Netlify: *Add new site → Import
   from Git → pick the repo*. Build command: none. Publish dir: `public`
   (already set in `netlify.toml`).

3. **Set environment variables** (Netlify → Site config → Environment variables):

   | Key | Value |
   |---|---|
   | `PRINTAVO_EMAIL` | the email on your Printavo account |
   | `PRINTAVO_TOKEN` | your Printavo API token |
   | `PRINTAVO_REVENUE_BASIS` | `invoiced` (default) or `collected` — optional |

4. **Deploy.** Netlify auto-detects the scheduled function from the `export const
   config = { schedule: ... }` in `daily-snapshot.mjs`. No cron setup needed.

5. **Confirm it works:** open `https://YOUR-SITE.netlify.app/api/test`. You want
   `"ok": true` on all three checks. This also prints a real invoice and
   transaction so you can see the exact field names (see *Adjusting* below).

6. **Load history:** open the site and click **Backfill history**, or hit
   `https://YOUR-SITE.netlify.app/api/backfill?days=365` once. After that the
   nightly job keeps it current on its own.

## Revenue basis — the one decision

`PRINTAVO_REVENUE_BASIS` controls what "revenue" means:

- **`invoiced`** (default) — sum of invoice totals dated that day. This is *sales*.
- **`collected`** — sum of payments received that day. This is *cash in*.

Flip it by changing the env var (or the default in `lib/printavo.mjs`). No code
changes anywhere else.

## Adjusting field names (only if `/api/test` errors)

The GraphQL queries assume the common Printavo v2 field names: invoices expose
`total` and `createdAt`; transactions expose `amount` and `createdAt`. If your
account differs, `/api/test` will either show the real field on the sample record
or return a GraphQL error naming the bad field. Fix it in **one place** — the
CONFIG block at the top of `lib/printavo.mjs`:

```js
const INVOICE_TOTAL_FIELD = "total";       // <- change if your invoices use a different money field
const INVOICE_DATE_FIELD  = "createdAt";
const TRANSACTION_AMOUNT_FIELD = "amount";
```

Redeploy and re-run `/api/test`.

## Notes & limits

- **Rate limit:** Printavo allows 10 requests / 5 seconds. The client self-throttles
  to ~1.6/sec, so a nightly snapshot (a couple requests) and even a 1-year backfill
  stay well under it. A big backfill just takes a minute.
- **Data starts accumulating from your first backfill / first nightly run.** Before
  that the chart is empty by design — there's no historical store until you load it.
- **Timezone:** the nightly job buckets revenue by **America/New_York** calendar day
  and runs at ~00:15 ET year-round (handles EST/EDT automatically).
- **Storage:** Netlify Blobs, free tier, no external database. One JSON blob holds
  the whole series.

## Local preview (optional)

```
npm install
npx netlify dev
```
Requires the Netlify CLI and the env vars set locally.
