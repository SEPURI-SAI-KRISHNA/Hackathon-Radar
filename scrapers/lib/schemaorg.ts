import { stripHtml } from './enrich.ts';

/**
 * A schema.org/Event, however the page happened to express it.
 * Both extractors below normalize into this.
 */
export interface SchemaEvent {
  name?: string;
  url?: string;
  description?: string;
  image?: string;
  startDate?: string;
  endDate?: string;
  eventAttendanceMode?: string;
  location?: string;
  addressCountry?: string;
  organizer?: string;
  isAccessibleForFree?: string;
  offers?: string;
  keywords?: string;
}

/**
 * Microdata (`itemscope`/`itemprop` attributes). Used by MLH and by most
 * server-rendered event listings.
 *
 * Deliberately regex-based rather than a DOM parse: these pages are large,
 * we only need a handful of flat attributes per event, and it keeps the
 * scrapers dependency-free.
 */
export function extractMicrodataEvents(html: string): SchemaEvent[] {
  const events: SchemaEvent[] = [];
  // Each event starts at an itemType="…/Event" marker; the block runs to the next one.
  const markers = [...html.matchAll(/itemType=["']https?:\/\/schema\.org\/Event["']/gi)];

  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index!;
    const end = i + 1 < markers.length ? markers[i + 1].index! : html.length;
    // Reach back to the opening tag so a wrapping <a href> is inside the block.
    const tagStart = html.lastIndexOf('<', start);
    const block = html.slice(tagStart, end);

    const event = parseItemProps(block);

    if (!event.url) {
      const href = block.match(/<a[^>]*href=["']([^"']+)["']/i)?.[1];
      if (href) event.url = decodeEntities(href);
    }
    if (!event.name) {
      // Plenty of pages (MLH included) render the title as a plain heading
      // outside any itemprop — take the first one at any level.
      const heading = block.match(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/i)?.[2];
      if (heading) event.name = stripHtml(heading);
    }

    if (event.name || event.url) events.push(event);
  }
  return events;
}

const VOID_ELEMENTS = new Set(['meta', 'img', 'br', 'hr', 'input', 'link', 'source', 'area']);

/**
 * Read the event's own itemprops, ignoring any nested itemscope.
 *
 * This matters: MLH embeds a `schema.org/Place` inside each event, and that
 * Place has its own `name` (the city). A flat scan would read "Hyderabad" as
 * the hackathon's title, so we track element nesting and only accept props
 * that belong to the event itself.
 */
function parseItemProps(block: string): SchemaEvent {
  const event: SchemaEvent = {};
  const stack: Array<{ tag: string; scope: boolean }> = [];
  let nestedScopes = 0;
  let sawRoot = false;

  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(\/?)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(block)) !== null) {
    const [, closing, rawTag, attrs, selfClose] = match;
    const tag = rawTag.toLowerCase();

    if (closing) {
      // Unwind to the matching open tag; malformed markup shouldn't desync us.
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          for (let j = stack.length - 1; j >= i; j--) {
            if (stack[j].scope) nestedScopes--;
          }
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const isScope = /\bitemscope\b/i.test(attrs);
    const prop = attrs.match(/\bitemprop=["']?([a-zA-Z]+)/i)?.[1];

    // The first itemscope in the block is the event root, not a nested item.
    const isNestedScope = isScope && sawRoot;
    if (isScope) sawRoot = true;

    if (prop && nestedScopes === 0 && !isNestedScope) {
      const content = attrs.match(/\bcontent=["']([^"']*)["']/i)?.[1];
      if (content !== undefined) {
        assign(event, prop, decodeEntities(content));
      } else if (!VOID_ELEMENTS.has(tag)) {
        // Text-valued prop: take everything up to this element's closing tag.
        const text = stripHtml(readElementText(block, tagRe.lastIndex, tag));
        if (text) assign(event, prop, text);
      }
    }

    const isVoid = VOID_ELEMENTS.has(tag) || selfClose === '/';
    if (!isVoid) {
      stack.push({ tag, scope: isNestedScope });
      if (isNestedScope) nestedScopes++;
    }
  }
  return event;
}

/** Inner HTML of the element opened just before `from`, respecting same-tag nesting. */
function readElementText(html: string, from: number, tag: string): string {
  const open = new RegExp(`<${tag}\\b`, 'gi');
  const close = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 1;
  let cursor = from;

  while (depth > 0) {
    close.lastIndex = cursor;
    const closeMatch = close.exec(html);
    if (!closeMatch) return html.slice(from);

    open.lastIndex = cursor;
    let openMatch = open.exec(html);
    while (openMatch && openMatch.index < closeMatch.index) {
      depth++;
      open.lastIndex = openMatch.index + 1;
      openMatch = open.exec(html);
    }
    depth--;
    cursor = closeMatch.index + closeMatch[0].length;
    if (depth === 0) return html.slice(from, closeMatch.index);
  }
  return html.slice(from, cursor);
}

/** JSON-LD (`<script type="application/ld+json">`), including @graph and arrays. */
export function extractJsonLdEvents(html: string): SchemaEvent[] {
  const events: SchemaEvent[] = [];
  for (const m of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue; // A malformed block shouldn't lose the well-formed ones.
    }
    for (const node of flatten(parsed)) {
      const type = String((node as Record<string, unknown>)['@type'] ?? '');
      if (!/Event/i.test(type)) continue;
      events.push(fromJsonLd(node as Record<string, unknown>));
    }
  }
  return events;
}

/**
 * Deep-walk the document. Events are commonly wrapped — `@graph`, or an
 * `ItemList` of `ListItem`s each holding the real event under `item`
 * (what Eventbrite emits) — so recurse through every value rather than
 * hard-coding the known wrapper keys.
 */
function flatten(node: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 6) return [];
  if (Array.isArray(node)) return node.flatMap((n) => flatten(n, depth + 1));
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const nested = Object.values(obj).flatMap((v) =>
      v && typeof v === 'object' ? flatten(v, depth + 1) : [],
    );
    return [obj, ...nested];
  }
  return [];
}

function fromJsonLd(node: Record<string, unknown>): SchemaEvent {
  const text = (v: unknown): string | undefined => {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return text(v[0]);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return text(o.name ?? o.url ?? o['@id']);
    }
    return undefined;
  };
  const place = node.location as Record<string, unknown> | undefined;
  return {
    name: text(node.name),
    url: text(node.url),
    description: text(node.description),
    image: text(node.image),
    startDate: text(node.startDate),
    endDate: text(node.endDate),
    eventAttendanceMode: text(node.eventAttendanceMode),
    location: text(node.location),
    addressCountry: place ? text((place.address as Record<string, unknown>)?.addressCountry) : undefined,
    organizer: text(node.organizer),
    offers: text((node.offers as Record<string, unknown>)?.price),
    keywords: text(node.keywords),
  };
}

function assign(event: SchemaEvent, prop: string, value: string) {
  const key = prop as keyof SchemaEvent;
  // First value wins: nested items (a Place's `name`) must not clobber the event's.
  if (key in EVENT_PROPS && !event[key]) event[key] = value;
}

const EVENT_PROPS: Record<keyof SchemaEvent, true> = {
  name: true, url: true, description: true, image: true, startDate: true, endDate: true,
  eventAttendanceMode: true, location: true, addressCountry: true, organizer: true,
  isAccessibleForFree: true, offers: true, keywords: true,
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
