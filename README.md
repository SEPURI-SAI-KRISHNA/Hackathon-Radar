# Hackathon Radar

Every online hackathon you can actually enter, in one place — aggregated from
five sources, deduplicated, and tracked from "interested" through "won".

Built because hackathons are scattered across a dozen platforms that don't talk
to each other, so you only find out one existed when someone posts about winning it.

- **Discover** — filter by theme, prize, deadline, duration and eligibility.
- **One URL per hackathon** — `/h/<slug>` is a real, shareable page, rendered with
  its own title, preview tags and `schema.org/Event` data.
- **My tracker** — mark each one Interested / Registered / Submitted / Won / Not for me,
  with notes. Synced across your devices via Cloudflare D1.
- **Source health** — `/sources` shows what every platform returned on the last
  refresh, including the ones that only half worked.
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

**Not included, and why:** lablab.ai, Kaggle, Taikai and Hack2skill sit behind
Cloudflare bot protection or reCAPTCHA and return a challenge page to any plain
HTTP client. DoraHacks exposes no public listing endpoint. Adding them would
need a headless browser; the scraper is deliberately dependency-free.

HackerEarth and Eventbrite were dropped for the same subtler reason: both answer
`200` from a home connection but block GitHub Actions runners (`403` and `405`
respectively), so every scheduled refresh raised a warning banner for a source
that contributed nothing on that run. A warning you see every time is one you
stop reading. `git log -- scrapers/sources/hackerearth.ts` has that module, and
Eventbrite's page config is in the history of `scrapers/sources/generic.ts`, if
you ever want them back for local-only runs.

### Adding a source

Most event platforms publish `schema.org/Event` markup because that's what search
engines read. If yours does, just add a URL to `PAGES` in
[`scrapers/sources/generic.ts`](scrapers/sources/generic.ts) — no new code:

```ts
{ url: 'https://example.com/hackathons?page={page}', label: 'Example', pages: 3 }
```

That adapter is currently **unregistered**, because `PAGES` is empty after
Eventbrite was dropped — put it back in [`sources/index.ts`](scrapers/sources/index.ts)
along with your page, or it won't run.

Then run `npm run refresh:verbose` and check the per-page count. A zero means the
page renders client-side and needs a dedicated module — copy the shape of
[`devfolio.ts`](scrapers/sources/devfolio.ts) and register it in
[`sources/index.ts`](scrapers/sources/index.ts). Sources are isolated: one
failing site degrades coverage for that source only and shows a ⚠ in the UI.
A new source whose images live on a new CDN also needs that host added to
`ALLOWED_HOSTS` in [`functions/api/image.ts`](functions/api/image.ts).

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
5. **Write** — `public/data/hackathons.json` plus `public/sitemap.xml`.
   `firstSeenAt` is carried over from the previous run, which is what makes the
   "New" badge mean *new to you*.

Prize figures are approximate — they're converted from many currencies at static
rates purely so sorting works. Always check the real number on the listing.

### Reporting a scrape honestly

Every source ends a run as `ok`, `degraded` or `failed`, and all three are
published in the dataset and rendered at `/sources`.

**`degraded` is the one that matters.** A platform that answers but stops
part-way through its pages — rate limiting, almost always — has silently left
events out. Reporting that as success makes a scrape that fetched three pages of
twenty indistinguishable from a complete one, which is the worst possible
outcome for an aggregator whose whole claim is completeness. `paginate()` backs
off 20s then 45s on a failing page before giving up, and whatever it gives up on
becomes a warning, a `degraded` status, and a banner on the site.

Two statuses are deliberately *not* errors: a source that returns zero rows
legitimately, and an event with no end date. The second one gets a 60-day cap in
`deriveStatus` — otherwise every listing that never published an end date stays
`ongoing` forever and that bucket quietly fills with hackathons that finished
last year.

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

**On a custom domain**, three places name the origin: `SITE_URL` in
[`scrapers/index.ts`](scrapers/index.ts) (used for the sitemap — override it
with the `SITE_URL` env var), the `canonical` and `og:url` tags in `index.html`,
and the `Sitemap:` line in [`public/robots.txt`](public/robots.txt). The
per-event canonical builds itself from the request's own origin, so that one
follows automatically.

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

### Merge conflicts on the generated files

CI commits `public/data/hackathons.json` and `public/sitemap.xml`; so does a
local `npm run refresh`. Both files are rewritten wholesale — the JSON is a
single line — so the moment both happen you get a conflict spanning the entire
file, and neither side is reviewable.

Run this **once per clone**:

```bash
npm run setup:merge-driver
```

That registers [`scripts/merge-generated.mjs`](scripts/merge-generated.mjs),
which `.gitattributes` points both files at. The rule is *newest wins*: each
side carries its scrape timestamp (`generatedAt` in the JSON, a `<!-- generated -->`
comment in the sitemap, always the same instant), and the later scrape is kept.
Both files therefore resolve to the same side, and a side with no timestamp —
hand-edited, truncated — is refused so you resolve it yourself.

It's deliberately **not** `merge=ours`. In a rebase git's "ours" is the upstream
branch you're replaying onto, not your work, so an `ours` driver throws away the
newer local dataset — the exact thing this prevents. The config can't be
committed, so a fresh clone without that command just gets an ordinary conflict.
CI never needs it: the workflow commits, it never merges.

---

## Project layout

```
scrapers/
  index.ts            refresh pipeline: fetch -> dedupe -> enrich -> write
  lib/                http, schema.org parsing, enrichment, dedupe, sitemap
scripts/
  merge-generated.mjs git merge driver for the two generated artifacts
  sources/            one module per platform (+ generic schema.org adapter)
shared/types.ts       the data model, shared by scrapers, API and UI
shared/slug.ts        /h/<slug> derivation, shared by all three too
src/                  React app (filters, cards, detail page, tracker)
  lib/router.ts       the 40-line router behind /h/<slug>, /tracker, /sources
functions/api/        Pages Functions: D1 tracker, thumbnail proxy
functions/h/[slug].ts renders one event's title, preview tags and JSON-LD
public/data/          the generated dataset, committed so the site is static
public/sitemap.xml    generated alongside it, one entry per live event
public/_headers       CSP and the rest of the security headers
public/_redirects     the two client-side routes with no file of their own
schema.sql            D1 table
```

## URLs, previews and images

`/h/<slug>` is served by a Pages Function that injects the event's title,
description, Open Graph tags and `schema.org/Event` JSON-LD into the app shell
before it reaches the browser — so a link pasted into Slack or picked up by a
crawler describes the hackathon rather than the site. An unknown slug returns a
real `404`, not an empty page with a `200`.

`_redirects` deliberately has no `/*` catch-all: only `/tracker` and `/sources`
are rewritten to the shell, so every other unmatched path still 404s properly.

`public/og.png` is the shared-link card, rendered by the portfolio's generator so
every project of mine previews the same way — regenerate it with:

```bash
cd ../portfolio-site-v2/my-portfolio
node -e "import('./scripts/og.mjs').then(m => require('fs').writeFileSync(
  '../../hackathons-discover/public/og.png',
  m.renderOgCard({ title: 'Hackathon Radar', section: 'apps',
                   tech: ['Web App', 'React', 'Cloudflare Pages'], theme: 'default' })))"
```

Every event page points at that same card rather than the event's own thumbnail,
which belongs to the platform that hosts it.

Thumbnails go through [`functions/api/image.ts`](functions/api/image.ts) rather
than being hot-linked. Source CDN URLs expire without warning, hot-linking hands
every visitor's IP to five third parties, and a few events have no image at all
— the proxy caches at the edge and draws a lettered placeholder for anything
missing, blocked or expired. That's also what lets the CSP stay `img-src 'self' data:`.

## Notes on defaults

The Discover view defaults to remote-only, student-only hidden, and status
*Open to enter* + *Running now* — tuned for a working professional entering
online events. Every one of those is a toggle, and filter state persists in
`localStorage`. The tracker view deliberately ignores all filters: something you
saved should never disappear because a filter changed.
