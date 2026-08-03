import type { RawHackathon } from '../../shared/types.ts';
import { getJSON, debug } from '../lib/http.ts';
import { parsePrize, stripHtml, toISO } from '../lib/enrich.ts';
import { defineSource } from '../lib/source.ts';

interface HackerEarthEvent {
  title: string;
  description?: string;
  url: string;
  status?: string;
  /** True when the challenge is restricted to college students. */
  college?: boolean;
  start_timestamp?: string;
  end_timestamp?: string;
  date?: string;
  end_date?: string;
  prizes?: string;
  challenge_type?: string;
  hackathon_type?: string;
  image?: string;
  banner?: string;
}

/**
 * HackerEarth publishes the same feed its browser extension consumes —
 * plain JSON, no auth, covering live and upcoming challenges.
 */
export default defineSource({
  id: 'hackerearth',
  name: 'HackerEarth',
  homepage: 'https://www.hackerearth.com/challenges/',

  async fetch() {
    const data = await getJSON<{ response?: HackerEarthEvent[] }>(
      'https://www.hackerearth.com/chrome-extension/events/',
    );
    const events = data.response ?? [];
    debug(`hackerearth: ${events.length}`);
    return events.filter((e) => e.title && e.url).map(toRaw);
  },
});

function toRaw(e: HackerEarthEvent): RawHackathon {
  const description = e.description ? stripHtml(e.description) : undefined;
  // Timestamps carry a zone abbreviation ("Aug 14, 2026 06:00 PM IST"); the
  // plain date fields are the reliable fallback when that fails to parse.
  const startsAt = toISO(e.start_timestamp) ?? toISO(e.date);
  const endsAt = toISO(e.end_timestamp) ?? toISO(e.end_date);

  return {
    sourceId: e.url,
    title: e.title.trim(),
    url: e.url,
    description,
    imageUrl: e.image ?? e.banner,
    // Everything HackerEarth runs is remote-first.
    mode: 'online',
    location: 'Online',
    startsAt,
    endsAt,
    registrationEndsAt: endsAt,
    prize: parsePrize(e.prizes),
    tags: [e.challenge_type, e.hackathon_type].filter((t): t is string => Boolean(t)),
    eligibility: e.college === true ? { studentOnly: true, openToProfessionals: false } : undefined,
  };
}
