import type { Hackathon, Status, Theme } from '../../shared/types';
import { daysUntil, deadlineOf } from './format';

export type SortKey = 'deadline' | 'prize' | 'newest' | 'starting' | 'duration';

export interface FilterState {
  query: string;
  /** Empty = no restriction. */
  themes: Theme[];
  statuses: Status[];
  onlineOnly: boolean;
  hideStudentOnly: boolean;
  hideNoPrize: boolean;
  minPrizeUsd: number;
  maxDurationDays: number | null;
  sources: string[];
  sort: SortKey;
}

/**
 * Defaults tuned for a working professional who only enters remote events:
 * remote-only, student-only listings hidden, and events you can still enter.
 */
export const DEFAULT_FILTERS: FilterState = {
  query: '',
  themes: [],
  statuses: ['open', 'ongoing'],
  onlineOnly: true,
  hideStudentOnly: true,
  hideNoPrize: false,
  minPrizeUsd: 0,
  maxDurationDays: null,
  sources: [],
  sort: 'deadline',
};

export function applyFilters(all: Hackathon[], f: FilterState): Hackathon[] {
  const terms = f.query.toLowerCase().split(/\s+/).filter(Boolean);

  const filtered = all.filter((h) => {
    if (f.onlineOnly && h.mode !== 'online' && h.mode !== 'hybrid') return false;
    if (f.statuses.length && !f.statuses.includes(h.status)) return false;
    if (f.hideStudentOnly && h.eligibility.studentOnly) return false;
    if (f.hideNoPrize && !h.prize.usd) return false;
    if (f.minPrizeUsd > 0 && (h.prize.usd ?? 0) < f.minPrizeUsd) return false;
    if (f.themes.length && !f.themes.some((t) => h.themes.includes(t))) return false;
    if (f.sources.length && !h.sources.some((s) => f.sources.includes(s.source))) return false;
    // An unknown duration shouldn't be silently dropped by a duration filter.
    if (f.maxDurationDays !== null && h.durationDays !== undefined && h.durationDays > f.maxDurationDays) {
      return false;
    }
    if (terms.length) {
      const haystack = searchIndex(h);
      if (!terms.every((t) => haystack.includes(t))) return false;
    }
    return true;
  });

  return filtered.sort(comparator(f.sort));
}

const indexCache = new WeakMap<Hackathon, string>();

function searchIndex(h: Hackathon): string {
  const cached = indexCache.get(h);
  if (cached) return cached;
  const value = [h.title, h.organizer, h.description, h.tags.join(' '), h.themes.join(' '), h.location]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  indexCache.set(h, value);
  return value;
}

function comparator(sort: SortKey): (a: Hackathon, b: Hackathon) => number {
  switch (sort) {
    case 'prize':
      return (a, b) => (b.prize.usd ?? -1) - (a.prize.usd ?? -1);
    case 'newest':
      return (a, b) => Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt);
    case 'starting':
      return (a, b) => time(a.startsAt) - time(b.startsAt);
    case 'duration':
      return (a, b) => (a.durationDays ?? Infinity) - (b.durationDays ?? Infinity);
    case 'deadline':
    default:
      // Already-closed items sort last rather than first among "soonest".
      return (a, b) => {
        const da = daysUntil(deadlineOf(a));
        const db = daysUntil(deadlineOf(b));
        return rank(da) - rank(db);
      };
  }
}

const rank = (days?: number) => (days === undefined ? Infinity : days < 0 ? 1e6 - days : days);
const time = (iso?: string) => (iso ? Date.parse(iso) : Infinity);

export const ALL_THEMES: Theme[] = [
  'AI/ML', 'Web3', 'Web Dev', 'Mobile', 'Data', 'Cybersecurity', 'Fintech',
  'Healthcare', 'Sustainability', 'Gaming', 'AR/VR', 'IoT/Hardware',
  'DevTools', 'Open Source', 'Design', 'Social Impact', 'Robotics', 'Quantum', 'Other',
];

export const ALL_STATUSES: Status[] = ['open', 'ongoing', 'upcoming', 'ended'];

export const STATUS_LABELS: Record<Status, string> = {
  open: 'Open to enter',
  ongoing: 'Running now',
  upcoming: 'Announced',
  ended: 'Recently ended',
};
