import type { Hackathon } from './types';

/**
 * The public URL segment for one event: `/h/<slug>`.
 *
 * Human-readable so a shared link says what it points at, with the id suffix
 * so two events called "AI Hackathon 2026" can't collide. Derived rather than
 * stored anywhere, which keeps it identical in the scraper, the Pages Function
 * that renders preview tags, and the browser.
 */
export function makeSlug(title: string, id: string): string {
  const stem = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `${stem || 'hackathon'}-${id.slice(0, 6)}`;
}

/** Tolerates datasets written before slugs were stored. */
export const slugOf = (h: Pick<Hackathon, 'id' | 'title'> & { slug?: string }): string =>
  h.slug || makeSlug(h.title, h.id);

/** `/h/<slug>` — the canonical path for an event. */
export const pathOf = (h: Pick<Hackathon, 'id' | 'title'> & { slug?: string }): string =>
  `/h/${slugOf(h)}`;
