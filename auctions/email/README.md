# Email ingestion (Gmail)

Fetches broker/listing-agent emails from Gmail and turns them into canonical
listings via **deterministic per-sender parsers**. AI never reads email at
runtime — it is used once per sender, at dev time, to author the parser from
dumped samples.

```
Gmail API → gmail.js → fetch_emails.js → registry.js → parsers/<slug>.js
          → auctions/listings/*.json → enrich → SQLite → dashboard
```

## One-time Gmail setup

1. [console.cloud.google.com](https://console.cloud.google.com) → create/select a project
2. APIs & Services → Library → enable **Gmail API**
3. APIs & Services → Credentials → Create credentials → **OAuth client ID → Desktop app**
4. Download the JSON → save as `auctions/email/credentials.json` (gitignored)
5. `npm run email:auth` — opens a browser, writes `token.json` (gitignored)

## Fetching (on-demand)

- Dashboard: **Fetch Emails** button in the sidebar (calls `POST /api/email/fetch`)
- CLI: `npm run email:fetch` or
  `node auctions/email/fetch_emails.js [--sender all] [--max-messages 50] [--since 7d] [--no-enrich] [--force]`

Every processed Gmail message is recorded in the `email_messages` table
(status `parsed | no_parser | no_listings | archived | error`), so fetches are
incremental and idempotent, and parser breakage is visible via
`GET /api/email/status`.

**Processed messages are moved to Gmail Trash** (recoverable ~30 days — never
permanently deleted) only *after* their outcome row is committed, and only for
`parsed/no_listings/archived`; `error` messages stay in the inbox so a broken
parser keeps its evidence. `--keep` disables trashing;
`--listings-since 90d` archives (records + trashes) older messages without
creating listings. The `email_messages` row is the dedup guardrail: even if a
trash call fails, the message is never reprocessed, and leftover processed
messages are swept to trash on the next run.

## Adding a new sender (the one-time-AI loop)

1. **Dump samples**: `node auctions/email/sample.js --from <address> --max 5`
   → `samples/<slug>/` (gitignored; contains raw email content)
2. **Author the parser**: ask Claude (dev-time, in the editor) to write
   `parsers/<slug>.js` from the samples. Contract:
   ```js
   export const meta = { slug, displayName, addresses: [...], assetClass };
   export function matches(msg);  // usually: address match
   export function parse(msg);    // deterministic → canonical record[] (0..n)
   ```
   Rules: no network, no AI; run prices through `saneMoney()` / `saneCapRate()`
   from `auctions/schema.js`; set `listing_type: 'sale'`, a `sale: {...}` block,
   an `email: {...}` provenance block, and `listing.id = source_id`
   (URL-derived when possible, else address hash).
3. **Fixtures**: copy 2-3 samples into `fixtures/<slug>/` (committed — scrub
   anything sensitive) so the parser has regression coverage.
4. **Register** the parser in `registry.js`.
5. **Test**: `node auctions/email/test_parsers.js`

Note: `parsers/cushman_wakefield.js` was authored against *synthetic* fixtures
to prove the plumbing — re-author it from real samples after the first
`sample.js` run.

Registered senders (2026-07-18): cushman_wakefield, marcus_millichap,
auction_com_email (archive-only — same inventory as the auction_com scraper),
boulder_group (incl. Crexi-campaign blasts filtered by display name),
colliers_central_valley, elevate_net_lease, kiser_group, wallet_wise (hotels),
cbre_rcm, visintainer_group. See PROVIDERS.md for per-sender notes.

Gotcha: `sample.js` slugs the dump directory from the address local part, so
`info@cwmultifamily.com` and `info@elevatenla.ccsend.com` both land in
`samples/info/` — pass `--out` when the local part is generic.

## Files

| file | purpose |
|---|---|
| `gmail.js` | Gmail API client + MIME decode → normalized message shape |
| `auth.js` | one-time interactive OAuth (`npm run email:auth`) |
| `registry.js` | sender → parser routing; register new parsers here |
| `parsers/<slug>.js` | deterministic per-sender parsers |
| `fetch_emails.js` | orchestrator CLI (`--from-fixtures <dir>` = offline mode) |
| `sample.js` | dump raw samples for parser authoring |
| `test_parsers.js` | runs every parser against its fixtures |
| `fixtures/<slug>/` | committed normalized-message JSONs (regression tests) |
| `samples/`, `credentials.json`, `token.json` | gitignored |

## Detail enrichment

Email blasts are thin; each provider has a detail fetcher that backfills from
its portal (both support `--enrich` to re-run enrichment after merging and
`--id <n>` for one listing):

- **C&W** — `npm run cw:details`: `multifamily.cushwake.com/Listings/<source_id>`
  is public, server-rendered HTML. Merges street address, zip, coordinates,
  units, property type, description. OM documents are behind a login +
  confidentiality agreement and are not fetched.
- **M&M** — `npm run mm:details`: resolves each email's tracking link
  (302 → `rimarketplace.com/auction/<rim_id>`, cached in provider_details),
  then hits RIM's JSON API (`POST /api/authenticate` for an anonymous Bearer
  token, `POST /api/auction {propertyId}`). Merges street/zip/county, bidding
  start/end dates, auction type (Absolute/Reserve), bid increment, reserve,
  buyer's premium, year built, property type, sold status; rewrites `url` to
  the canonical RIM page.
