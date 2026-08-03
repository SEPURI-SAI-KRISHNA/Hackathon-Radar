import type { Hackathon } from '../../shared/types';

const DAY = 86_400_000;

export function daysUntil(iso?: string): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return Math.ceil((t - Date.now()) / DAY);
}

/** The date that actually matters: when you can no longer enter. */
export const deadlineOf = (h: Hackathon): string | undefined =>
  h.registrationEndsAt ?? h.endsAt ?? h.startsAt;

export function formatDeadline(h: Hackathon): string {
  const days = daysUntil(deadlineOf(h));
  if (days === undefined) return 'No deadline listed';
  if (days < 0) return `Closed ${Math.abs(days)}d ago`;
  if (days === 0) return 'Closes today';
  if (days === 1) return 'Closes tomorrow';
  if (days < 31) return `${days} days left`;
  return `${Math.round(days / 7)} weeks left`;
}

export function formatDateRange(startsAt?: string, endsAt?: string): string {
  if (!startsAt && !endsAt) return 'Dates TBA';
  const fmt = (iso: string, withYear: boolean) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    });

  if (startsAt && endsAt) {
    const sameYear = new Date(startsAt).getUTCFullYear() === new Date(endsAt).getUTCFullYear();
    return `${fmt(startsAt, !sameYear)} – ${fmt(endsAt, true)}`;
  }
  return startsAt ? `From ${fmt(startsAt, true)}` : `Until ${fmt(endsAt!, true)}`;
}

/** Compact and approximate — these are converted from many currencies. */
export function formatPrize(usd?: number): string | undefined {
  if (!usd) return undefined;
  if (usd >= 1_000_000) return `~$${(usd / 1_000_000).toFixed(usd >= 10_000_000 ? 0 : 1)}M`;
  if (usd >= 1_000) return `~$${Math.round(usd / 1000)}K`;
  return `~$${usd}`;
}

export function formatDuration(days?: number): string | undefined {
  if (!days) return undefined;
  if (days === 1) return '1 day';
  if (days <= 3) return `${days} days (weekend sprint)`;
  if (days <= 14) return `${days} days`;
  return `${Math.round(days / 7)} weeks`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const hours = Math.round(diff / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** Added within the last week — worth surfacing since you check periodically. */
export const isNew = (h: Hackathon): boolean => Date.now() - Date.parse(h.firstSeenAt) < 7 * DAY;
