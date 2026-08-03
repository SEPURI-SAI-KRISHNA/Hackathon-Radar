import type { Mode, RawHackathon } from '../../shared/types.ts';
import { getJSON, paginate, debug } from '../lib/http.ts';
import { parsePrize, stripHtml, toISO } from '../lib/enrich.ts';
import { defineSource } from '../lib/source.ts';

interface UnstopFilter {
  name?: string;
  type?: string;
}

interface UnstopRow {
  id: number;
  title: string;
  public_url?: string;
  seo_url?: string;
  type?: string;
  subtype?: string;
  region?: string;
  details?: string;
  start_date?: string;
  end_date?: string;
  logoUrl2?: string;
  viewsCount?: number;
  registerCount?: number;
  regn_open?: number;
  tags?: string[] | Array<{ name?: string }>;
  prizes?: Array<{ rank?: number; cash?: number | string; others?: string; currency?: string }>;
  filters?: UnstopFilter[];
  organisation?: { name?: string };
  regnRequirements?: { end_regn_dt?: string; start_regn_dt?: string };
}

interface UnstopResponse {
  data?: { data?: UnstopRow[]; last_page?: number };
}

export default defineSource({
  id: 'unstop',
  name: 'Unstop',
  homepage: 'https://unstop.com',

  async fetch() {
    const rows = await paginate<UnstopRow>(
      async (page) => {
        const url =
          'https://unstop.com/api/public/opportunity/search-new' +
          `?opportunity=hackathons&page=${page}&per_page=30&oppstatus=open`;
        const data = await getJSON<UnstopResponse>(url);
        return data.data?.data ?? [];
      },
      { maxPages: 25 },
    );
    debug(`unstop: ${rows.length}`);
    return rows.map(toRaw);
  },
});

function toRaw(row: UnstopRow): RawHackathon {
  const eligibilityFilters = (row.filters ?? [])
    .filter((f) => f.type === 'eligible')
    .map((f) => f.name ?? '');

  // Unstop's audience filters are the reliable signal — the free-text body isn't.
  const studentOnly =
    eligibilityFilters.length > 0 &&
    eligibilityFilters.every((n) => /undergraduate|postgraduate|school|college|student|fresher/i.test(n));

  const path = row.public_url ?? row.seo_url;
  const description = row.details ? stripHtml(row.details).slice(0, 1500) : undefined;

  return {
    sourceId: String(row.id),
    title: row.title.trim(),
    url: path ? `https://unstop.com/${path.replace(/^\//, '')}` : 'https://unstop.com/hackathons',
    description,
    imageUrl: row.logoUrl2,
    organizer: row.organisation?.name,
    mode: unstopMode(row),
    location: row.region === 'online' ? 'Online' : undefined,
    startsAt: toISO(row.start_date),
    endsAt: toISO(row.end_date),
    registrationEndsAt: toISO(row.regnRequirements?.end_regn_dt),
    prize: bestPrize(row.prizes),
    tags: [
      ...tagNames(row.tags),
      ...(row.filters ?? []).map((f) => f.name ?? '').filter(Boolean),
    ],
    participants: row.registerCount,
    eligibility: { studentOnly, openToProfessionals: !studentOnly },
  };
}

/**
 * `region` is the venue field but Unstop leaves it "offline" on plenty of
 * remote-run events, so the subtype is a second chance to spot an online one.
 */
function unstopMode(row: UnstopRow): Mode {
  if (row.region === 'online') return 'online';
  if (/online|virtual|remote/i.test(row.subtype ?? '')) return 'online';
  return 'offline';
}

const tagNames = (tags?: UnstopRow['tags']): string[] =>
  (tags ?? [])
    .map((t) => (typeof t === 'string' ? t : t?.name))
    .filter((t): t is string => Boolean(t));

function bestPrize(prizes?: UnstopRow['prizes']) {
  if (!prizes?.length) return undefined;
  const currency = prizes.find((p) => p.currency)?.currency ?? 'INR';
  const parsed = prizes
    .map((p) => parsePrize(p.cash ? `${currency} ${p.cash}` : p.others))
    .filter((p) => p.usd !== undefined)
    .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
  return parsed[0];
}
