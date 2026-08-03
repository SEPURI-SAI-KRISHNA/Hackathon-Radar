import type { Mode, RawHackathon } from '../../shared/types.ts';
import { getText, debug } from '../lib/http.ts';
import { toISO } from '../lib/enrich.ts';
import { extractMicrodataEvents, type SchemaEvent } from '../lib/schemaorg.ts';
import { defineSource } from '../lib/source.ts';

/** MLH runs a season per calendar year; near year-end the next one is already listed. */
function seasons(): number[] {
  const year = new Date().getUTCFullYear();
  return [year, year + 1];
}

export default defineSource({
  id: 'mlh',
  name: 'Major League Hacking',
  homepage: 'https://mlh.io',

  async fetch() {
    const out: RawHackathon[] = [];

    for (const season of seasons()) {
      let html: string;
      try {
        // mlh.io redirects to mlh.com; `request` follows it by default.
        html = await getText(`https://mlh.io/seasons/${season}/events`);
      } catch (err) {
        debug(`mlh ${season} unavailable:`, (err as Error).message);
        continue; // A season that doesn't exist yet isn't an error.
      }
      const events = extractMicrodataEvents(html);
      debug(`mlh ${season}: ${events.length}`);
      out.push(...events.filter((e) => e.name && e.url).map(toRaw));
    }
    return out;
  },
});

function toRaw(e: SchemaEvent): RawHackathon {
  // Strip MLH's referral params so the same event dedupes against other sources.
  const url = cleanUrl(e.url!);

  return {
    sourceId: url,
    title: e.name!.trim(),
    url,
    description: e.description,
    imageUrl: e.image,
    mode: attendanceMode(e.eventAttendanceMode),
    location: e.location,
    startsAt: toISO(e.startDate),
    endsAt: toISO(e.endDate),
    tags: ['student', ...(e.keywords ? e.keywords.split(',').map((k) => k.trim()) : [])],
    // MLH's member events are student hackathons by definition.
    eligibility: { studentOnly: true, openToProfessionals: false },
  };
}

function attendanceMode(mode?: string): Mode {
  if (!mode) return 'unknown';
  if (/OnlineEventAttendanceMode/i.test(mode)) return 'online';
  if (/MixedEventAttendanceMode/i.test(mode)) return 'hybrid';
  if (/OfflineEventAttendanceMode/i.test(mode)) return 'offline';
  return 'unknown';
}

function cleanUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('utm_')) url.searchParams.delete(key);
    }
    return url.toString().replace(/\?$/, '');
  } catch {
    return raw;
  }
}
