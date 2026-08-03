import type { RawHackathon } from '../../shared/types.ts';
import { getJSON, paginate, debug } from '../lib/http.ts';
import { inferMode, parsePrize, stripHtml, toISO } from '../lib/enrich.ts';
import { defineSource } from '../lib/source.ts';

interface DevpostHackathon {
  id: number;
  title: string;
  url: string;
  open_state: 'open' | 'upcoming' | 'ended';
  displayed_location?: { icon?: string; location?: string };
  thumbnail_url?: string;
  submission_period_dates?: string;
  time_left_to_submission?: string;
  themes?: Array<{ id: number; name: string }>;
  prize_amount?: string;
  registrations_count?: number;
  organization_name?: string;
  invite_only?: boolean;
  eligibility_requirement_invite_only_description?: string | null;
}

/**
 * Devpost paginates 9 at a time and its filters are additive, so we sweep
 * several (challenge_type × status) combinations and let the runner dedupe.
 * `hybrid` is included because plenty of hybrid events accept remote entries.
 */
const QUERIES = [
  { challenge_type: 'online', status: 'open' },
  { challenge_type: 'online', status: 'upcoming' },
  { challenge_type: 'online', status: 'ended' },
  { challenge_type: 'hybrid', status: 'open' },
  { challenge_type: 'hybrid', status: 'upcoming' },
];

export default defineSource({
  id: 'devpost',
  name: 'Devpost',
  homepage: 'https://devpost.com',

  async fetch(ctx) {
    const rows: DevpostHackathon[] = [];

    for (const q of QUERIES) {
      const sweep = `${q.challenge_type}/${q.status}`;
      const { items, truncated } = await paginate<DevpostHackathon>(async (page) => {
        const url =
          `https://devpost.com/api/hackathons?challenge_type[]=${q.challenge_type}` +
          `&status[]=${q.status}&page=${page}`;
        const data = await getJSON<{ hackathons?: DevpostHackathon[] }>(url);
        return data.hackathons ?? [];
      });

      // Devpost rate-limits by IP, and CI runners share addresses with the
      // world — a truncated sweep there is common and must not look like a
      // complete one.
      if (truncated) ctx.warn(`${sweep} incomplete — ${truncated}`);

      debug(`devpost ${sweep}: ${items.length}${truncated ? ' (truncated)' : ''}`);
      rows.push(...items);
    }

    return rows.map(toRaw);
  },
});

function toRaw(h: DevpostHackathon): RawHackathon {
  const { startsAt, endsAt } = parseDateRange(h.submission_period_dates);
  const location = h.displayed_location?.location;
  const tags = (h.themes ?? []).map((t) => t.name);

  return {
    sourceId: String(h.id),
    title: h.title.trim(),
    url: h.url,
    // Devpost's listing API carries no blurb, so synthesize a useful one-liner.
    description: h.eligibility_requirement_invite_only_description
      ? stripHtml(h.eligibility_requirement_invite_only_description)
      : undefined,
    imageUrl: normalizeImage(h.thumbnail_url),
    organizer: h.organization_name,
    mode: h.displayed_location?.icon === 'globe' ? 'online' : inferMode(location, 'offline'),
    location,
    startsAt,
    endsAt,
    // Devpost's deadline to enter is the submission deadline.
    registrationEndsAt: endsAt,
    prize: parsePrize(h.prize_amount),
    tags,
    participants: h.registrations_count,
  };
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Devpost renders one string like "May 19 - Aug 17, 2026" or
 * "Dec 15, 2025 - Jan 20, 2026" — the year appears only where it changes.
 */
export function parseDateRange(range?: string): { startsAt?: string; endsAt?: string } {
  if (!range) return {};
  const parts = range.split(/\s*[-–—]\s*/);
  if (parts.length !== 2) return {};

  const endYear = parts[1].match(/\b(20\d{2})\b/)?.[1];
  const startYear = parts[0].match(/\b(20\d{2})\b/)?.[1] ?? endYear;
  if (!endYear) return {};

  const startsAt = parseDayMonth(parts[0], startYear!);
  const endsAt = parseDayMonth(parts[1], endYear);
  return { startsAt, endsAt };
}

function parseDayMonth(text: string, year: string): string | undefined {
  const m = text.match(/([A-Za-z]{3,})\s+(\d{1,2})/);
  if (!m) return undefined;
  const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (month === undefined) return undefined;
  return toISO(new Date(Date.UTC(Number(year), month, Number(m[2]), 12)));
}

/** Devpost returns protocol-relative CDN URLs. */
const normalizeImage = (url?: string) =>
  url ? (url.startsWith('//') ? `https:${url}` : url) : undefined;
