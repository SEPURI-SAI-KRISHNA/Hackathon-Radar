import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Dataset, Hackathon, RawHackathon, SourceReport } from '../shared/types.ts';
import { makeSlug } from '../shared/slug.ts';
import { classifyThemes, deriveStatus, durationDays, inferEligibility } from './lib/enrich.ts';
import { identityKey, makeId, mergeGroup, type TaggedRaw } from './lib/dedupe.ts';
import { buildSitemap } from './lib/sitemap.ts';
import { sources } from './sources/index.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(ROOT, 'public/data/hackathons.json');
const SITEMAP = resolve(ROOT, 'public/sitemap.xml');

/** Absolute origin, needed for the sitemap. Override when the domain changes. */
const SITE_URL = (process.env.SITE_URL ?? 'https://hackathon-radar-e0u.pages.dev').replace(/\/$/, '');

/** Events that finished longer ago than this are dropped from the dataset. */
const KEEP_ENDED_DAYS = 30;
/** Descriptions are for scanning, not reading — the source page has the full text. */
const MAX_DESCRIPTION = 600;

async function main() {
  const startedAt = Date.now();
  const now = new Date();
  console.log(`Refreshing from ${sources.length} sources…\n`);

  const previous = await loadPrevious();

  // Sources run concurrently and are isolated: one failing site degrades
  // coverage for that source only, and shows up as `ok: false` in the UI.
  const results = await Promise.all(
    sources.map(async (source): Promise<{ report: SourceReport; rows: TaggedRaw[] }> => {
      const t0 = Date.now();
      const warnings: string[] = [];
      try {
        const raw = await source.fetch({ warn: (m) => warnings.push(m) });
        const rows = raw.filter(isUsable).map((r) => tag(r, source.id, source.name));
        return {
          report: {
            source: source.id,
            sourceName: source.name,
            // Rows came back, but a warning means some of them are missing —
            // that is a degraded run, not a successful one.
            status: warnings.length ? 'degraded' : 'ok',
            count: rows.length,
            ms: Date.now() - t0,
            warnings: warnings.length ? warnings : undefined,
          },
          rows,
        };
      } catch (err) {
        return {
          report: {
            source: source.id,
            sourceName: source.name,
            status: 'failed',
            count: 0,
            ms: Date.now() - t0,
            error: err instanceof Error ? err.message : String(err),
          },
          rows: [],
        };
      }
    }),
  );

  for (const { report } of results) {
    const status = report.status === 'ok' ? '✓' : report.status === 'degraded' ? '!' : '✗';
    const detail = report.status === 'failed' ? report.error : `${report.count} events`;
    console.log(`  ${status} ${report.sourceName.padEnd(24)} ${String(detail).slice(0, 90)}  (${report.ms}ms)`);
    for (const w of report.warnings ?? []) console.log(`      ↳ ${w}`);
  }

  const allRows = results.flatMap((r) => r.rows);

  // Group by identity so the same event listed on several platforms collapses.
  const groups = new Map<string, TaggedRaw[]>();
  for (const row of allRows) {
    const key = identityKey(row.title, row.startsAt);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const hackathons: Hackathon[] = [];
  for (const [key, group] of groups) {
    const core = mergeGroup(group);
    const id = makeId(key);
    const status = deriveStatus(now, core.startsAt, core.endsAt, core.registrationEndsAt);
    if (isStale(status, core.endsAt, now)) continue;

    const searchText = [core.title, core.description, core.tags.join(' ')].filter(Boolean).join('\n');
    const prior = previous.get(id);

    hackathons.push({
      ...core,
      id,
      slug: makeSlug(core.title, id),
      description: core.description?.slice(0, MAX_DESCRIPTION),
      status,
      durationDays: durationDays(core.startsAt, core.endsAt),
      themes: classifyThemes({ title: core.title, tags: core.tags, description: core.description }),
      eligibility: inferEligibility(searchText, mergeEligibility(group)),
      // Preserved across refreshes so the "NEW" badge means new to you.
      firstSeenAt: prior?.firstSeenAt ?? now.toISOString(),
      lastSeenAt: now.toISOString(),
    });
  }

  hackathons.sort(byRelevance);

  const dataset: Dataset = {
    generatedAt: now.toISOString(),
    count: hackathons.length,
    hackathons,
    sources: results.map((r) => r.report),
  };

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(dataset, null, 0));
  // Same `now` as `generatedAt`, so both artifacts carry one timestamp.
  await writeFile(SITEMAP, buildSitemap(hackathons, now, SITE_URL));

  const added = hackathons.filter((h) => h.firstSeenAt === now.toISOString()).length;
  const online = hackathons.filter((h) => h.mode === 'online' || h.mode === 'hybrid').length;
  const failed = results.filter((r) => r.report.status === 'failed').length;
  const degraded = results.filter((r) => r.report.status === 'degraded').length;

  console.log(
    `\n${allRows.length} rows → ${hackathons.length} unique (${online} online/hybrid, ${added} new)` +
      `${failed ? `, ${failed} source(s) failed` : ''}` +
      `${degraded ? `, ${degraded} source(s) degraded` : ''}` +
      `\nWrote ${OUTPUT} and ${SITEMAP} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  );

  // A total wipe-out means something systemic broke; don't let CI publish it silently.
  if (hackathons.length === 0) {
    console.error('\nNo hackathons collected — refusing to treat this as success.');
    process.exitCode = 1;
  }
}

function tag(raw: RawHackathon, source: string, sourceName: string): TaggedRaw {
  return {
    ...raw,
    source,
    sourceName,
    tags: raw.tags ?? [],
    organizer: cleanOrganizer(raw.organizer),
  };
}

/** Organizers are self-entered on most platforms, so placeholders are common. */
const PLACEHOLDER = /^(n\/?a|na|none|null|undefined|tbd|tba|unknown|test|-{1,3}|\.+)$/i;

function cleanOrganizer(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || PLACEHOLDER.test(trimmed)) return undefined;
  return trimmed;
}

/** Drop rows too incomplete to be actionable. */
const isUsable = (r: RawHackathon) => Boolean(r?.title?.trim() && r?.url && r?.sourceId);

function isStale(status: string, endsAt: string | undefined, now: Date): boolean {
  if (status !== 'ended') return false;
  if (!endsAt) return true; // Ended with no date is unrecoverable noise.
  return now.getTime() - Date.parse(endsAt) > KEEP_ENDED_DAYS * 86_400_000;
}

/** A restriction claimed by any source is respected; sources rarely invent them. */
function mergeEligibility(group: TaggedRaw[]) {
  const stated = group.map((g) => g.eligibility).filter(Boolean);
  if (!stated.length) return {};
  return {
    studentOnly: stated.some((e) => e!.studentOnly === true) || undefined,
    womenOnly: stated.some((e) => e!.womenOnly === true) || undefined,
  };
}

/**
 * Default order: things you can still enter, soonest deadline first.
 * Ended events sink to the bottom regardless of prize.
 */
function byRelevance(a: Hackathon, b: Hackathon): number {
  const rank = { open: 0, ongoing: 1, upcoming: 2, ended: 3 } as const;
  const byStatus = rank[a.status] - rank[b.status];
  if (byStatus !== 0) return byStatus;

  const aDeadline = Date.parse(a.registrationEndsAt ?? a.endsAt ?? a.startsAt ?? '') || Infinity;
  const bDeadline = Date.parse(b.registrationEndsAt ?? b.endsAt ?? b.startsAt ?? '') || Infinity;
  if (aDeadline !== bDeadline) return aDeadline - bDeadline;
  return (b.prize.usd ?? 0) - (a.prize.usd ?? 0);
}

/** Prior run, used only to carry `firstSeenAt` forward. */
async function loadPrevious(): Promise<Map<string, Hackathon>> {
  try {
    const raw = await readFile(OUTPUT, 'utf8');
    const data = JSON.parse(raw) as Dataset;
    return new Map(data.hackathons.map((h) => [h.id, h]));
  } catch {
    return new Map();
  }
}

main().catch((err) => {
  console.error('Refresh failed:', err);
  process.exit(1);
});
