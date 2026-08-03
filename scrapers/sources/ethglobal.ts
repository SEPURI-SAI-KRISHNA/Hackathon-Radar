import type { Mode, RawHackathon } from '../../shared/types.ts';
import { getText, debug } from '../lib/http.ts';
import { stripHtml, toISO } from '../lib/enrich.ts';
import { defineSource } from '../lib/source.ts';

/**
 * ETHGlobal renders its event list server-side but with no schema.org data,
 * so we read the cards. Each card is one `<a href="/events/slug">` whose text
 * runs: [dates] Title [City, Country] EventType.
 *
 * Two layouts exist — upcoming cards lead with the date, past cards lead with
 * the title — so the parser keys off token shape rather than position.
 */
/** Tag boundaries are collapsed to this sentinel so adjacent elements stay separate. */
const SEP = '\u0001';

export default defineSource({
  id: 'ethglobal',
  name: 'ETHGlobal',
  homepage: 'https://ethglobal.com/events',

  async fetch() {
    const html = await getText('https://ethglobal.com/events');
    const cards = [...html.matchAll(/<a[^>]*href="(\/events\/([a-z0-9-]+))"[^>]*>([\s\S]*?)<\/a>/gi)];

    const bySlug = new Map<string, RawHackathon>();
    for (const [, path, slug, inner] of cards) {
      // Tag boundaries become separators so adjacent elements don't run together.
      const tokens = stripHtml(inner.replace(/<[^>]+>/g, SEP))
        .split(SEP)
        .map((t) => t.replace(/\s+/g, ' ').trim())
        .filter((t) => t && t !== ',');

      const parsed = parseCard(tokens);
      if (!parsed) continue;
      // Only hackathons — the same list carries conferences, meetups and co-working days.
      if (!/hackathon/i.test(parsed.type)) continue;

      bySlug.set(slug, {
        sourceId: slug,
        title: parsed.title,
        url: `https://ethglobal.com${path}`,
        organizer: 'ETHGlobal',
        mode: cardMode(parsed.type, parsed.location),
        location: parsed.location,
        startsAt: parsed.startsAt,
        endsAt: parsed.endsAt,
        tags: ['web3', 'blockchain', 'ethereum', parsed.type.toLowerCase()],
      });
    }
    debug(`ethglobal: ${bySlug.size} hackathons`);
    return [...bySlug.values()];
  },
});

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const DAY_NAMES = /^(mon|tue|wed|thu|fri|sat|sun)/i;
const EVENT_TYPES = /^(async hackathon|irl hackathon|hackathon|conference|co-?working|meetup)$/i;
const CHROME = /^(apply to attend|apply now|—|–|-|register)$/i;

interface Card {
  title: string;
  type: string;
  location?: string;
  startsAt?: string;
  endsAt?: string;
}

function parseCard(tokens: string[]): Card | null {
  const type = tokens.find((t) => EVENT_TYPES.test(t));
  if (!type) return null;

  // Title is the first token that isn't a date part, a weekday, or UI chrome.
  const title = tokens.find(
    (t) =>
      !isDateish(t) &&
      !DAY_NAMES.test(t) &&
      !CHROME.test(t) &&
      !EVENT_TYPES.test(t) &&
      t.length > 3,
  );
  if (!title) return null;

  const typeIndex = tokens.indexOf(type);
  const titleIndex = tokens.indexOf(title);
  // Whatever sits between the title and the event type is the place.
  const location = tokens
    .slice(titleIndex + 1, typeIndex)
    .filter((t) => !isDateish(t) && !DAY_NAMES.test(t) && !CHROME.test(t))
    .join(', ');

  const { startsAt, endsAt } = parseDates(tokens);
  return { title, type, location: location || undefined, startsAt, endsAt };
}

const isDateish = (t: string) =>
  /^\d{1,2}(st|nd|rd|th)?,?$/i.test(t) ||
  /^[a-z]{3,9}\.?$/i.test(t) && MONTHS[t.slice(0, 3).toLowerCase()] !== undefined ||
  /^[a-z]{3,9}\s+\d{1,2}(st|nd|rd|th)?(,\s*\d{4})?$/i.test(t);

/**
 * Handles both "Nov 21st – Nov 23rd, 2025" (year stated) and the upcoming-card
 * form "September 4 16" (month once, two day numbers, no year).
 */
function parseDates(tokens: string[]): { startsAt?: string; endsAt?: string } {
  const joined = tokens.join(' ');

  const explicit = [
    ...joined.matchAll(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?/gi),
  ]
    .map((m) => ({ month: MONTHS[m[1].slice(0, 3).toLowerCase()], day: Number(m[2]), year: m[3] ? Number(m[3]) : undefined }))
    .filter((d) => d.month !== undefined && d.day >= 1 && d.day <= 31);

  if (!explicit.length) return {};

  const statedYear = explicit.find((d) => d.year !== undefined)?.year;
  const first = explicit[0];
  const startYear = first.year ?? statedYear ?? inferYear(first.month!, first.day);

  const startsAt = utc(startYear, first.month!, first.day);

  // "September 4 16": a bare trailing day number is the end of the same month.
  const bareEndDay = tokens
    .slice(tokens.indexOf(String(first.day)) + 1)
    .find((t) => /^\d{1,2}$/.test(t));

  let endsAt: string | undefined;
  const second = explicit[1];
  if (second && !(second.month === first.month && second.day === first.day)) {
    endsAt = utc(second.year ?? statedYear ?? startYear, second.month!, second.day);
  } else if (bareEndDay && Number(bareEndDay) > first.day) {
    endsAt = utc(startYear, first.month!, Number(bareEndDay));
  }

  // A range that wraps the new year, e.g. Dec 28 – Jan 3.
  if (endsAt && startsAt && endsAt < startsAt && second) {
    endsAt = utc(startYear + 1, second.month!, second.day);
  }
  return { startsAt, endsAt };
}

const utc = (year: number, month: number, day: number) =>
  toISO(new Date(Date.UTC(year, month, day, 12)));

/** Undated cards are upcoming, so pick whichever year puts the date ahead of us. */
function inferYear(month: number, day: number): number {
  const now = new Date();
  const thisYear = now.getUTCFullYear();
  const candidate = Date.UTC(thisYear, month, day, 12);
  // Allow ~2 months of slack so events that just ended don't jump a year.
  return candidate < now.getTime() - 60 * 86_400_000 ? thisYear + 1 : thisYear;
}

function cardMode(type: string, location?: string): Mode {
  if (/async/i.test(type)) return 'online';
  if (/irl/i.test(type)) return 'offline';
  if (!location || /online/i.test(location)) return 'online';
  return 'offline';
}
