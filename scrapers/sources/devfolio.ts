import type { RawHackathon } from '../../shared/types.ts';
import { getJSON, debug } from '../lib/http.ts';
import { parsePrize, stripHtml, toISO } from '../lib/enrich.ts';
import { defineSource } from '../lib/source.ts';

interface DevfolioHit {
  _source?: DevfolioHackathon;
}

interface DevfolioHackathon {
  uuid: string;
  name: string;
  slug: string;
  tagline?: string;
  desc?: string;
  starts_at?: string;
  ends_at?: string;
  is_online?: boolean;
  city?: string;
  country?: string;
  location?: string | null;
  status?: string;
  participants_count?: number;
  themes?: Array<{ name?: string } | string>;
  hashtags?: Array<{ name?: string } | string>;
  prizes?: Array<{ name?: string; value?: string | number; description?: string }>;
  cover_img?: string;
  hosted_by?: string | { name?: string };
  hackathon_setting?: {
    reg_ends_at?: string;
    reg_starts_at?: string;
    women_only?: boolean;
    logo?: string;
    subdomain?: string;
  };
}

/** Devfolio's search API only exposes these two buckets publicly. */
const TYPES = ['application_open', 'upcoming'];

export default defineSource({
  id: 'devfolio',
  name: 'Devfolio',
  homepage: 'https://devfolio.co',

  async fetch() {
    const seen = new Map<string, DevfolioHackathon>();

    for (const type of TYPES) {
      const data = await getJSON<{ hits?: { hits?: DevfolioHit[] } }>(
        'https://api.devfolio.co/api/search/hackathons',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, from: 0, size: 200 }),
        },
      );
      const hits = data.hits?.hits ?? [];
      debug(`devfolio ${type}: ${hits.length}`);
      for (const hit of hits) {
        const src = hit._source;
        if (src?.uuid) seen.set(src.uuid, src);
      }
    }

    return [...seen.values()].map(toRaw);
  },
});

function toRaw(h: DevfolioHackathon): RawHackathon {
  const setting = h.hackathon_setting ?? {};
  // Devfolio hackathons live on <subdomain>.devfolio.co, not on a /hackathons path.
  const url = setting.subdomain
    ? `https://${setting.subdomain}.devfolio.co`
    : `https://devfolio.co/hackathons/${h.slug}`;

  const tags = [...names(h.themes), ...names(h.hashtags)];
  const description = h.desc ? stripHtml(h.desc).slice(0, 1500) : h.tagline;

  return {
    sourceId: h.uuid,
    title: h.name.trim(),
    url,
    description,
    imageUrl: h.cover_img ?? setting.logo,
    organizer: typeof h.hosted_by === 'string' ? h.hosted_by : h.hosted_by?.name,
    mode: h.is_online ? 'online' : 'offline',
    location: h.location ?? ([h.city, h.country].filter(Boolean).join(', ') || undefined),
    startsAt: toISO(h.starts_at),
    endsAt: toISO(h.ends_at),
    registrationEndsAt: toISO(setting.reg_ends_at),
    prize: bestPrize(h.prizes),
    tags,
    participants: h.participants_count,
    eligibility: setting.women_only ? { womenOnly: true } : undefined,
  };
}

const names = (list?: Array<{ name?: string } | string>): string[] =>
  (list ?? [])
    .map((item) => (typeof item === 'string' ? item : item?.name))
    .filter((n): n is string => Boolean(n));

/** Devfolio lists prize tiers; the headline figure is the largest one. */
function bestPrize(prizes?: DevfolioHackathon['prizes']) {
  if (!prizes?.length) return undefined;
  const parsed = prizes
    .map((p) => parsePrize(p.value ?? p.name ?? p.description))
    .filter((p) => p.usd !== undefined)
    .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
  return parsed[0];
}
