# Hackathon Radar

Every online hackathon you can actually enter, in one place — aggregated from
seven sources, deduplicated, and tracked from "interested" through "won".

Built because hackathons are scattered across a dozen platforms that don't talk
to each other, so you only find out one existed when someone posts about winning it.

- **Discover** — filter by theme, prize, deadline, duration and eligibility.
- **My tracker** — mark each one Interested / Registered / Submitted / Won / Not for me,
  with notes. Synced across your devices via Cloudflare D1.
- **Auto-refresh** — GitHub Actions re-scrapes every 2 days and commits the result;
  Cloudflare Pages redeploys on the commit.

---

## Quick start

```bash
npm install
npm run refresh   # scrape all sources -> public/data/hackathons.json (~45s)
npm run dev       # http://localhost:5173
```

The tracker works without any backend — status is kept in `localStorage` until
you configure D1 (below), at which point it syncs across devices.

---

## Sources

| Source | Method | Notes |
| --- | --- | --- |
| Devpost | Public JSON API | Largest source. Swept across online/hybrid × open/upcoming/ended. |
| Devfolio | Public search API | `application_open` and `upcoming` are the only public buckets. |
| Unstop | Public JSON API | India-heavy. Eligibility filters used to detect student-only events. |
| MLH | schema.org microdata | Student hackathons — all flagged `studentOnly`, hidden by default. |
| ETHGlobal | HTML card parse | Web3. Conferences and meetups on the same page are filtered out. |
| HackerEarth | Browser-extension JSON feed | Small; HackerEarth runs few public hackathons at a time. |
| Eventbrite | JSON-LD (`schema.org/Event`) | Via the generic adapter — see below. |

**Not included, and why:** lablab.ai, Kaggle, Taikai and Hack2skill sit behind
Cloudflare bot protection or reCAPTCHA and return a challenge page to any plain
HTTP client. DoraHacks exposes no public listing endpoint. Adding them would
need a headless browser; the scraper is deliberately dependency-free.

### Adding a source

Most event platforms publish `schema.org/Event` markup because that's what search
engines read. If yours does, just add a URL to `PAGES` in
[`scrapers/sources/generic.ts`](scrapers/sources/generic.ts) — no new code:

```ts
{ url: 'https://example.com/hackathons?page={page}', label: 'Example', pages: 3 }
```

Then run `npm run refresh:verbose` and check the per-page count. A zero means the
page renders client-side and needs a dedicated module — copy the shape of
[`devfolio.ts`](scrapers/sources/devfolio.ts) and register it in
[`sources/index.ts`](scrapers/sources/index.ts). Sources are isolated: one
failing site degrades coverage for that source only and shows a ⚠ in the UI.

---

## How the data is processed

1. **Fetch** — all sources run concurrently, each with retries and timeouts.
2. **Normalize** — every source maps into one `Hackathon` shape (`shared/types.ts`).
3. **Deduplicate** — the same event on Devpost, MLH and Unstop collapses into one
   card that links to all three. Identity is the title with boilerplate
   ("hackathon", "the", ordinals) stripped, plus the year.
4. **Enrich** — themes classified from title/tags/description; prizes parsed from
   free text (`₹5,00,000`, `50K USD`, `2 crore`) into a comparable USD figure;
   student-only and women-only detected; status derived from dates rather than
   trusting the source's own stale label.
5. **Write** — `public/data/hackathons.json`. `firstSeenAt` is carried over from
   the previous run, which is what makes the "New" badge mean *new to you*.

Prize figures are approximate — they're converted from many currencies at static
rates purely so sorting works. Always check the real number on the listing.

---

## Deploying to Cloudflare Pages

**1. Push to GitHub**, then in the Cloudflare dashboard: *Workers & Pages → Create → Pages → Connect to Git*.

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | `22` (set env var `NODE_VERSION=22`) |

**2. Create the database and apply the schema:**

```bash
npx wrangler d1 create hackathon-tracker
# paste the printed database_id into wrangler.toml
npx wrangler d1 execute hackathon-tracker --remote --file=./schema.sql
```

**3. Set the tracker secret** (any long random string — it's what stops the open
internet writing to your database):

```bash
openssl rand -hex 24                       # generate one
npx wrangler pages secret put TRACKER_SECRET
```

**4. Check the project name matches.** `name` in `wrangler.toml` must equal the
Pages project name, and `npx wrangler pages project list` will tell you what it
actually is. The D1 binding itself needs no dashboard step — once a Wrangler
config file exists, Pages reads bindings from it and ignores dashboard bindings.

**5. Open the site**, track anything, and paste the secret into the "Tracker key"
banner. It's stored in `localStorage`; enter it once per device.

### Local development against D1

`wrangler pages dev` keys its local database by the *binding* name, so apply the
schema to `DB` rather than to the database name:

```bash
npm run build
npx wrangler d1 execute DB --local --file=./schema.sql
npx wrangler pages dev dist --d1 DB=hackathon-tracker --binding TRACKER_SECRET=dev-secret
```

---

## Automatic refresh

[`.github/workflows/refresh.yml`](.github/workflows/refresh.yml) runs at 06:00 UTC
every second day and on demand via the *Run workflow* button. It commits
`public/data/hackathons.json` only when something changed, so Pages redeploys only
on real updates.

The scrape exits non-zero if it collects nothing at all, which fails the job and
leaves the last good dataset in place rather than publishing an empty site.

To change the cadence, edit the `cron` line. To run it yourself: `npm run refresh`.

---

## Project layout

```
scrapers/
  index.ts            refresh pipeline: fetch -> dedupe -> enrich -> write
  lib/                http, schema.org parsing, enrichment, dedupe
  sources/            one module per platform (+ generic schema.org adapter)
shared/types.ts       the data model, shared by scrapers, API and UI
src/                  React app (filters, cards, tracker)
functions/api/        Cloudflare Pages Function backing the D1 tracker
public/data/          the generated dataset, committed so the site is static
schema.sql            D1 table
```

## Notes on defaults

The Discover view defaults to remote-only, student-only hidden, and status
*Open to enter* + *Running now* — tuned for a working professional entering
online events. Every one of those is a toggle, and filter state persists in
`localStorage`. The tracker view deliberately ignores all filters: something you
saved should never disappear because a filter changed.
