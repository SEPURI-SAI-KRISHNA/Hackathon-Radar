import { createHash } from 'node:crypto';
import type { Hackathon, RawHackathon } from '../../shared/types.ts';

/** A raw row tagged by the runner with which source produced it. */
export type TaggedRaw = RawHackathon & { source: string; sourceName: string };

/** Fields the runner derives itself, so merging doesn't need to produce them. */
export type MergedCore = Omit<
  Hackathon,
  'status' | 'themes' | 'eligibility' | 'firstSeenAt' | 'lastSeenAt' | 'durationDays'
>;

/** Words that carry no identity — "Hack the Future Hackathon 2026" ≈ "Hack the Future 2026". */
const NOISE =
  /\b(hackathon|hackfest|hacks?|challenge|competition|contest|jam|sprint|buildathon|codefest|datathon|ideathon|the|a|an|of|for|by|and|edition|season|online|virtual|global|international|national)\b/gi;

/**
 * Identity key for merging the same event listed on several platforms.
 * Keeps the year (so the 2025 and 2026 editions stay separate) but drops
 * boilerplate, punctuation and ordinals that differ between listings.
 */
export function identityKey(title: string, startsAt?: string): string {
  const yearInTitle = title.match(/\b(20\d{2})\b/)?.[1];
  const core = title
    .toLowerCase()
    .replace(/\b(20\d{2})\b/g, ' ')
    .replace(/\b\d+(st|nd|rd|th)\b/g, ' ')
    .replace(NOISE, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');

  const year = yearInTitle ?? (startsAt ? new Date(startsAt).getUTCFullYear().toString() : '');
  // Very short cores ("ai", "x") are too generic to merge on alone.
  return core.length >= 4 ? `${core}-${year}` : `${core}-${year}-${startsAt?.slice(0, 10) ?? ''}`;
}

export function makeId(key: string): string {
  return createHash('sha1').update(key).digest('hex').slice(0, 12);
}

/** Higher wins when two sources disagree on a field. Richer APIs rank above HTML scrapes. */
const SOURCE_CONFIDENCE: Record<string, number> = {
  devpost: 100, devfolio: 95, unstop: 90, hackerearth: 85, mlh: 70, ethglobal: 65, schemaorg: 40,
};

const confidence = (source: string) => SOURCE_CONFIDENCE[source] ?? 50;

/**
 * Merge duplicates into one record, taking each field from the most confident
 * source that actually has a value — so a sparse-but-trusted listing doesn't
 * erase a richer one's description or prize.
 */
export function mergeGroup(group: TaggedRaw[]): MergedCore {
  const ranked = [...group].sort((a, b) => {
    const byConf = confidence(b.source) - confidence(a.source);
    if (byConf !== 0) return byConf;
    // Tie-break on richness so we don't pick a stub over a full listing.
    return score(b) - score(a);
  });
  const best = ranked[0];

  const pick = <K extends keyof TaggedRaw>(field: K): TaggedRaw[K] | undefined => {
    for (const item of ranked) {
      const value = item[field];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
  };

  const tags = [...new Set(ranked.flatMap((r) => r.tags ?? []))].slice(0, 25);
  // Prefer the largest stated prize: partial listings often show only one tier.
  const prize = ranked.map((r) => r.prize).filter(Boolean).sort((a, b) => (b?.usd ?? 0) - (a?.usd ?? 0))[0] ?? {};

  return {
    id: '',
    title: best.title,
    url: pick('url') ?? best.url,
    description: pick('description'),
    imageUrl: pick('imageUrl'),
    organizer: pick('organizer'),
    mode: ranked.find((r) => r.mode !== 'unknown')?.mode ?? 'unknown',
    location: pick('location'),
    startsAt: pick('startsAt'),
    endsAt: pick('endsAt'),
    registrationEndsAt: pick('registrationEndsAt'),
    participants: ranked.map((r) => r.participants ?? 0).sort((a, b) => b - a)[0] || undefined,
    prize,
    tags,
    // One entry per distinct listing: a source can surface the same event from
    // several of its own queries (Devpost's online/ and hybrid/ filters overlap).
    sources: dedupeBy(
      ranked.map((r) => ({
        source: r.source,
        sourceName: r.sourceName,
        url: r.url,
        sourceId: r.sourceId,
      })),
      (s) => `${s.source}:${s.sourceId}`,
    ),
  };
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const score = (r: TaggedRaw) =>
  (r.description ? 3 : 0) + (r.startsAt ? 2 : 0) + (r.endsAt ? 2 : 0) +
  (r.prize?.usd ? 2 : 0) + (r.imageUrl ? 1 : 0) + (r.tags?.length ? 1 : 0);
