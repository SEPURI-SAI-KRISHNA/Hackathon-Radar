# Hackathon Radar

**Live at:** `https://hackathon-radar-e0u.pages.dev/`
**Built with:** Vite + React, plus one Cloudflare Pages Function at `/api/tracker`
**Audited:** 9 August 2026, from outside, no source access

This file is self-contained. It has everything for this project.

---

## Summary

**This is the most genuinely useful thing you have built, and the most technically interesting.**

It is a real aggregator. 412 hackathons pulled from 6 different websites, merged so the same event does not appear twice, prizes converted to a common currency, status worked out, plus a personal tracker with proper authentication.

The merging is the hard part and you got it right: 617 raw results from the sources became 412 unique events.

Two problems:

1. **Two of your six sources are broken, and the site reports success anyway.** Your biggest source is returning about 15% of its pages.
2. **No hackathon has its own URL.** You cannot send someone a link to a specific one, which is the most obvious thing a user would want to do.

---

## Current state

```
generatedAt : 2026-08-07T06:59:51Z    (data was 1.7 days old when audited)
count       : 412
statuses    : open 139 · ongoing 233 · upcoming 7 · ended 33
modes       : online 302 · offline 110
```

Source results from the last run, taken from your own data file:

```
devpost    ok  347  38.7s   ⚠ "hybrid/upcoming incomplete — stopped at page 3 of 20:
                                Unexpected end of JSON input"
unstop     ok  123   7.2s
mlh        ok   92   3.2s
devfolio   ok   31   2.0s
ethglobal  ok   24   2.1s
schemaorg  ok    0   0.2s   ⚠ "Eventbrite (online hackathons) unreachable —
                                HTTP 405 Not Allowed"
```

---

## Stage 1 — Fix the data (about 4 hours)

### 1.1 Fix the Devpost scraper

This is the most important item in this file.

Your largest source stops at **page 3 of 20** and the run is still marked `ok: true`:

```json
{"source":"devpost","sourceName":"Devpost","ok":true,"count":347,"ms":38682,
 "warnings":["hybrid/upcoming incomplete — stopped at page 3 of 20:
              Unexpected end of JSON input"]}
```

Two things are wrong here:

**It gives up instead of retrying.** `Unexpected end of JSON input` at page 3, after 38 seconds, looks like rate limiting or a cut-off response rather than a bug in your parser. A retry with backoff would probably recover most of those 17 pages.

**It reports success.** A run missing most of a source's pages is degraded, not successful. Nothing downstream can tell the difference between "worked fully" and "barely ran".

Your whole product claim is "every online hackathon you can enter". Right now it demonstrably is not.

**Do this:** Add retry with exponential backoff. Change the status logic so a run with incomplete pagination is marked `degraded`, not `ok`.

### 1.2 Fix or remove the Eventbrite source

```
"Eventbrite (online hackathons) unreachable —
 https://www.eventbrite.com/d/online/hackathon/?page=1 failed: HTTP 405 Not Allowed"
```

`405` means Eventbrite is rejecting the request method outright. This is not intermittent — it fails every time and has contributed **0** results.

Likely a request-method or headers problem, possibly deliberate bot blocking on their side.

**Do this:** Either fix it or delete it. A permanently-empty source sitting in your health list is noise that hides real failures.

### 1.3 Check how "status" is calculated

```
startsAt in the past : 279 of 412
no startsAt at all   : 7
status = ended       : 33
status = ongoing     : 233
```

For a "what can I enter right now" tool, that is a lot of noise. `ongoing` at 233 is doing a lot of work and may be hiding events that finished months ago — a hackathon that started in the past with no end date will look identical to one running today.

**Do this:** Review the status logic. At minimum, default the view to `open` plus genuinely `upcoming`, and put `ended` behind a toggle.

### 1.4 Show when the data was last updated

`generatedAt` appears exactly once in your code and is never shown on screen. There is no "updated 2 hours ago", no stale warning.

For an aggregator, freshness **is** the trust signal. A visitor has no way to know if they are seeing yesterday's data or last month's — and therefore no reason to come back rather than checking Devpost directly.

**Do this:** Put "Updated X ago" in the header. Show a visible warning past about 48 hours.

---

## Stage 2 — Show your own engineering (about 2 hours)

### 2.1 Build a source health page

You already collect `ok`, `count`, `ms` and `warnings` for every source, and then throw it away.

That is a status dashboard's worth of data sitting in your published file. Rendering it would have shown you problems 1.1 and 1.2 without needing an audit.

It also makes the engineering visible, which matters if this is a portfolio piece. "I built an aggregator" is a claim. A live source-health page is proof.

---

## Stage 3 — Make it linkable (about 1 day)

### 3.1 Give each hackathon a URL

There is no `react-router` and no `pushState` anywhere in your code. The entire app is one URL.

You cannot send someone a link to a specific hackathon. That is the single most obvious user action for an aggregator, and it is impossible. It is also why the site has no search presence at all — one indexable page for 412 events.

**Do this:** Add routes like `/h/hack-the-habitat-2026`. This is also the prerequisite for preview cards and any organic search traffic.

### 3.2 Improve the page header

You have a description and a nice emoji favicon (🎯, inline SVG, zero extra requests). But:

```
Open Graph tags : NO
Twitter tags    : NO
theme-color     : NO
canonical       : NO
```

The title is just `Hackathon Radar` with no explanation of what it does. Shared links show nothing.

For a tool that grows by word of mouth in student and hackathon communities, that is a real cost.

**Look at your Blueprint project for the pattern** — its page header is the best you have written, with full preview tags, image dimensions and descriptive alt text.

---

## Stage 4 — Housekeeping (about 2 hours)

### 4.1 Link it to your portfolio

Your portfolio's `/apps` page does **not** link this project. Neither do the other four sites. Add it.

Also add a small footer here: "part of sepurisaikrishna.com" with a link home.

### 4.2 Add security headers

```
CSP      NO
HSTS     NO
XFO      NO
nosniff  yes
```

Copy `_headers` from your portfolio. **One change needed** — you load images from other people's servers (Devpost's CloudFront and others), so `img-src` must allow them. Or solve it properly with the image proxy idea below, and then you can keep `img-src 'self'`.

### 4.3 Real 404 pages, sitemap, robots.txt

```
robots.txt      → returns your HTML (file does not exist)
sitemap.xml     → returns your HTML (file does not exist)
/missing-page   → HTTP 200
```

Do these in the same pass as Stage 3, since there is nothing to put in a sitemap until hackathons have URLs.

### 4.4 Accessibility basics

```
prefers-reduced-motion : 0 rules
focus-visible          : 0 rules
print styles           : 0 rules
```

This is a dense, filterable list — a keyboard-heavy interface by nature. Visible focus matters more here than on most sites. Your Blueprint project has both of these; copy the approach.

### 4.5 Stop hot-linking images

`imageUrl` points straight at Devpost's CloudFront and the equivalents for other platforms.

It works today, but:
- It breaks silently when a source changes or expires a URL
- It leaks every visitor's IP address to five third-party servers
- Four entries already have no image at all

**Do this:** Proxy and cache them through a Pages Function, with a generated placeholder as fallback. Fixes the missing images and lets you tighten your CSP at the same time.

---

## What you got right

This is the strongest engineering of your five side projects and it deserves the detail.

| | |
|---|---|
| **The authentication is correct** | `/api/tracker` returns a proper `401 {"error":"unauthorized"}` when called without a key. The key is supplied by the user and read from `localStorage` — `Ol=()=>localStorage.getItem(Xa)??""` — with **no secret hidden in your JavaScript**. That is the mistake nearly everyone makes with this pattern, and you avoided it. |
| **Graceful failure** | With no key set, the tracker falls back to local-only. On a network error it falls back to offline mode with local entries preserved. Genuinely considered error handling. |
| **Real deduplication** | Every entry carries a `sources[]` array. 347 + 123 + 92 + 31 + 24 = 617 raw results collapsed to 412 unique events. This is the actually-hard part of aggregation. |
| **Prize normalisation** | `{usd: 1000, raw: "$ 1,000", currency: "USD"}` — normalised for sorting, original kept for display. Exactly right. |
| **Self-monitoring pipeline** | You record `ok`, `count`, `ms` and `warnings` per source into the published file. This is the only reason problems 1.1 and 1.2 were findable at all — your own code reported them. |
| **Cache busting** | `fetch('/data/hackathons.json?t=' + Date.now())`. No stale-cache trap. |
| **Speed** | 190 ms to first byte, 53 KB of JavaScript. The 461 KB data file is the bulk, and it is the actual product. |

---

## Feature ideas

| Idea | Effort |
|---|---|
| **Show freshness.** See 1.4. Core credibility, not decoration. | 1 hour |
| **Source health page.** See 2.1. The data already exists. | 2 hours |
| **URL per hackathon.** See 3.1. Prerequisite for everything else. | 1 day |
| **Deadline-first sorting, plus calendar export.** What users actually need is "what closes soon". An `.ics` file per hackathon — or a subscribable calendar feed for a saved filter — turns this from a site people visit into something they integrate into their week. | Half day |
| **Alerts on a saved filter.** "New online AI hackathons over $5,000." RSS needs no backend at all and would work today. Email needs one. This is the feature that turns a visit into a habit. | Half day |
| **Prize-per-participant ratio.** You already store `prize.usd` and `participants`. Showing expected value is a sorting dimension no other aggregator offers — and it is the single most useful number for someone deciding where to spend a weekend. | 2 hours |
| **Team finding.** The hardest part of entering a hackathon is not finding one. Even just a Discord link per event, or a "looking for teammates" board. | Half day |
| **Image proxy.** See 4.5. Fixes three problems at once. | Half day |
| **Eligibility filtering.** You already capture an `eligibility` field. Students-only, region-locked and age-gated events are the main source of wasted clicks for this audience. | Half day |
| **A one-line reason per entry.** You have tags, themes, prize, participants and mode. A generated summary like "small field, large prize, closes in 4 days" would make the list scannable. | Half day |
| **Historical trends.** You store `firstSeenAt` and `lastSeenAt` per entry — which means you are already accumulating a record of the hackathon ecosystem over time without meaning to. "Prize pools over time", "which platforms are growing", "how far ahead events get announced". **That is an article nobody else can write**, and it feeds straight back into your portfolio's writing sections. | Ongoing |

---

## What I could not check

Tested from outside, no source access, no browser. Not covered:

- How the site looks
- Colour contrast
- **Whether the filters and sorting actually work correctly**
- Keyboard navigation and screen readers
- Real Core Web Vitals
- Whether the tracker sync works end to end with a valid key
- Whether individual hackathon records are accurate against their source listings
- Mobile rendering

I probed `/api/tracker` with **one unauthenticated GET only**, to confirm it enforces authentication. No write, no mutation, no attempt to bypass it, and no key supplied.

Whether your data refresh runs on a schedule could not be determined from outside. The 1.7-day age is one observation, not proof of a cadence.

---

*No changes were made to your site or code.*
