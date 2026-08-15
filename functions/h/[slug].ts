import type { Dataset, Hackathon } from '../../shared/types';
import { slugOf } from '../../shared/slug';
import { securityHeaders } from '../../shared/headers';

/**
 * Serves `/h/<slug>`: the same SPA shell, but with this event's title,
 * description, preview tags and schema.org data already in the HTML.
 *
 * The React app renders the page either way — this exists so that a link
 * pasted into Slack, WhatsApp or a search index shows the hackathon rather
 * than the word "Hackathon Radar", and so an unknown slug is a real 404
 * instead of an empty page returning 200.
 */

interface Env {
  /** Static assets binding, present on every Pages deployment. */
  ASSETS: Fetcher;
}

const SITE_NAME = 'Hackathon Radar';
/** Short at the browser, longer at the edge — the dataset changes every 2 days. */
const CACHE_CONTROL = 'public, max-age=300, s-maxage=3600';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const url = new URL(request.url);
  const slug = decodeURIComponent(String(params.slug ?? ''));

  const [shell, hackathon] = await Promise.all([
    env.ASSETS.fetch(new URL('/index.html', url).toString()).then((r) => r.text()),
    findHackathon(env, url, slug),
  ]);

  if (!hackathon) {
    const notFound = await env.ASSETS.fetch(new URL('/404.html', url).toString());
    return new Response(notFound.body, {
      status: 404,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
        ...securityHeaders(),
      },
    });
  }

  const ld = jsonLd(hackathon, `${url.origin}/h/${slugOf(hackathon)}`);
  return new Response(inject(shell, hackathon, url.origin, ld), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': CACHE_CONTROL,
      // The JSON-LD block is inline, so it is allowed by its own hash rather
      // than by opening script-src up to 'unsafe-inline'.
      ...securityHeaders(`'self' 'sha256-${await sha256(ld)}'`),
    },
  });
};

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

async function findHackathon(env: Env, url: URL, slug: string): Promise<Hackathon | undefined> {
  if (!slug) return undefined;
  const res = await env.ASSETS.fetch(new URL('/data/hackathons.json', url).toString());
  if (!res.ok) return undefined;
  const data = (await res.json()) as Dataset;
  return data.hackathons.find((h) => slugOf(h) === slug);
}

function inject(shell: string, h: Hackathon, origin: string, ld: string): string {
  const canonical = `${origin}/h/${slugOf(h)}`;
  const title = `${h.title} — ${SITE_NAME}`;
  const description = summary(h);

  const tags = [
    `<link rel="canonical" href="${esc(canonical)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:url" content="${esc(canonical)}" />`,
    `<meta property="og:title" content="${esc(h.title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    // One static card for every event: the thumbnails belong to the platforms
    // and would be hot-linked into someone else's Slack preview.
    `<meta property="og:image" content="${esc(origin)}/og.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="Hackathon Radar — every online hackathon you can enter, in one place." />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(h.title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${esc(origin)}/og.png" />`,
    `<script type="application/ld+json">${ld}</script>`,
  ].join('\n    ');

  return shell
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta\s+name="description"[^>]*>/, `<meta name="description" content="${esc(description)}" />`)
    // The shell's own canonical and preview tags describe the home page.
    .replace(/\s*<link\s+rel="canonical"[^>]*>/g, '')
    .replace(/\s*<meta\s+(?:property="og:|name="twitter:)[^>]*>/g, '')
    .replace('</head>', `  ${tags}\n  </head>`);
}

/** The line a preview card shows: what it is, when it closes, what it pays. */
function summary(h: Hackathon): string {
  const parts: string[] = [];
  if (h.organizer) parts.push(`By ${h.organizer}`);
  parts.push(h.mode === 'online' ? 'Online' : h.mode === 'hybrid' ? 'Hybrid' : (h.location ?? 'In person'));
  // The converted figure, not `prize.raw`: raw is free text and is sometimes a
  // rank ("3rd Position") rather than an amount, which reads badly in a preview.
  if (h.prize.usd) parts.push(`${compactUsd(h.prize.usd)} in prizes`);

  const deadline = h.registrationEndsAt ?? h.endsAt;
  if (deadline) {
    const days = Math.ceil((Date.parse(deadline) - Date.now()) / 86_400_000);
    if (days >= 0) parts.push(days === 0 ? 'closes today' : `${days} day${days === 1 ? '' : 's'} left to enter`);
  }

  const lead = parts.join(' · ');
  const blurb = h.description?.replace(/\s+/g, ' ').trim();
  return blurb ? `${lead}. ${blurb}`.slice(0, 300) : lead;
}

const compactUsd = (usd: number) =>
  usd >= 1_000_000 ? `~$${(usd / 1_000_000).toFixed(1)}M` : usd >= 1_000 ? `~$${Math.round(usd / 1000)}K` : `~$${usd}`;

/**
 * The site reads other people's schema.org markup to find events; publishing
 * its own is the same courtesy, and it's what search engines index.
 */
function jsonLd(h: Hackathon, canonical: string): string {
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: h.title,
    url: canonical,
    eventAttendanceMode:
      h.mode === 'online'
        ? 'https://schema.org/OnlineEventAttendanceMode'
        : h.mode === 'hybrid'
          ? 'https://schema.org/MixedEventAttendanceMode'
          : 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
  };
  if (h.description) data.description = h.description;
  if (h.startsAt) data.startDate = h.startsAt;
  if (h.endsAt) data.endDate = h.endsAt;
  if (h.organizer) data.organizer = { '@type': 'Organization', name: h.organizer };
  if (h.mode === 'online') data.location = { '@type': 'VirtualLocation', url: h.url };
  else if (h.location) data.location = { '@type': 'Place', name: h.location };

  // `</script>` inside JSON would close the tag early.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

const esc = (s: string) =>
  s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
