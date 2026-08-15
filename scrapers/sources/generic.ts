import type { Mode, RawHackathon } from '../../shared/types.ts';
import { getText, debug } from '../lib/http.ts';
import { parsePrize, toISO } from '../lib/enrich.ts';
import { extractJsonLdEvents, extractMicrodataEvents, type SchemaEvent } from '../lib/schemaorg.ts';
import { defineSource } from '../lib/source.ts';

interface Page {
  /** `{page}` is substituted when `pages` > 1. */
  url: string;
  label: string;
  pages?: number;
  defaultMode?: Mode;
}

/**
 * Any listing page that publishes schema.org Event data — JSON-LD or
 * microdata — is picked up here with no new code, because that markup is
 * what search engines read and most event platforms emit it.
 *
 * To add a site: append an entry, re-register this source in
 * [`sources/index.ts`](./index.ts), run `npm run refresh:verbose`, and check
 * the per-page count. A zero means the page renders client-side, which needs
 * a dedicated source module instead (see `devfolio.ts` for the shape).
 *
 * Currently empty, so the source is unregistered — see the README for why
 * Eventbrite was removed.
 */
const PAGES: Page[] = [];

export default defineSource({
  id: 'schemaorg',
  name: 'Web (schema.org)',
  homepage: '',

  async fetch(ctx) {
    const byUrl = new Map<string, RawHackathon>();

    for (const page of PAGES) {
      const before = byUrl.size;
      let unreachable: string | undefined;

      for (let n = 1; n <= (page.pages ?? 1); n++) {
        let html: string;
        try {
          html = await getText(page.url.replace('{page}', String(n)), { retries: 2 });
        } catch (err) {
          unreachable = (err as Error).message;
          debug(`${page.label} p${n} unreachable:`, unreachable);
          break; // Later pages of an unreachable listing won't work either.
        }

        const events = [...extractJsonLdEvents(html), ...extractMicrodataEvents(html)];
        const usable = events.filter((e) => e.name && e.url && isHackathon(e));
        debug(`${page.label} p${n}: ${usable.length}/${events.length}`);
        for (const e of usable) byUrl.set(e.url!, toRaw(e, page.defaultMode ?? 'unknown'));

        // Pagination past the end repeats the last page; stop when nothing is new.
        if (!usable.length) break;
      }

      // A configured page contributing nothing is either a block, a layout
      // change, or a genuinely empty listing. All three are worth knowing about
      // — otherwise the source reports a clean zero and looks healthy.
      if (unreachable) ctx.warn(`${page.label} unreachable — ${unreachable}`);
      else if (byUrl.size === before) ctx.warn(`${page.label} returned no events`);
    }

    return [...byUrl.values()];
  },
});

/**
 * These pages list every kind of event, and search relevance is loose —
 * keep only titles/descriptions that actually read like a hackathon.
 */
function isHackathon(e: SchemaEvent): boolean {
  const text = `${e.name ?? ''} ${e.description ?? ''} ${e.keywords ?? ''}`;
  return /\b(hackathon|datathon|buildathon|ideathon|code ?fest|game ?jam)\b/i.test(text);
}

function toRaw(e: SchemaEvent, defaultMode: Mode): RawHackathon {
  const mode: Mode = /Online/i.test(e.eventAttendanceMode ?? '')
    ? 'online'
    : /Mixed/i.test(e.eventAttendanceMode ?? '')
      ? 'hybrid'
      : /Offline/i.test(e.eventAttendanceMode ?? '')
        ? 'offline'
        : defaultMode;

  return {
    sourceId: e.url!,
    title: e.name!.trim(),
    url: e.url!,
    description: e.description,
    imageUrl: e.image,
    organizer: e.organizer,
    mode,
    location: mode === 'online' ? 'Online' : e.location,
    startsAt: toISO(e.startDate),
    endsAt: toISO(e.endDate),
    prize: parsePrize(e.offers),
    tags: e.keywords ? e.keywords.split(',').map((k) => k.trim()).filter(Boolean) : [],
  };
}
