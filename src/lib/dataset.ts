import type { Dataset, SourceReport, SourceStatus } from '../../shared/types';

/** Past this, the dataset is old enough that the site should say so out loud. */
export const STALE_AFTER_HOURS = 48;

/**
 * Datasets published before `status` existed only carried `ok: boolean`, and
 * one is served from cache for as long as a browser keeps it. Read both.
 */
export function statusOf(s: SourceReport): SourceStatus {
  if (s.status) return s.status;
  if (s.ok === false) return 'failed';
  return s.warnings?.length ? 'degraded' : 'ok';
}

export const SOURCE_STATUS_LABELS: Record<SourceStatus, string> = {
  ok: 'Healthy',
  degraded: 'Degraded',
  failed: 'Failed',
};

export const bySourceStatus = (sources: SourceReport[], status: SourceStatus) =>
  sources.filter((s) => statusOf(s) === status);

export function hoursOld(dataset: Dataset): number {
  return (Date.now() - Date.parse(dataset.generatedAt)) / 3_600_000;
}

export const isStale = (dataset: Dataset) => hoursOld(dataset) > STALE_AFTER_HOURS;

/**
 * Images are proxied rather than hot-linked: third-party CDN URLs expire
 * without warning, every card would leak the visitor's IP to five servers,
 * and the proxy draws a placeholder for the events that have no image at all.
 */
export function imageSrc(input: { imageUrl?: string; title: string }): string {
  const params = new URLSearchParams({ t: input.title.slice(0, 80) });
  if (input.imageUrl) params.set('u', input.imageUrl);
  return `/api/image?${params}`;
}
