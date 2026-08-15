import type { Hackathon } from '../../shared/types.ts';

/**
 * One entry per event page plus the home page. Ended events are left out —
 * they're still in the dataset for a month, but there's nothing to enter.
 *
 * The `generated` comment is load-bearing: it's what `scripts/merge-generated.mjs`
 * reads to decide which side of a merge conflict is newer, and it deliberately
 * carries the same timestamp as the dataset it was built from so the two files
 * always resolve to the same side.
 */
export function buildSitemap(hackathons: Hackathon[], generatedAt: Date, siteUrl: string): string {
  const day = generatedAt.toISOString().slice(0, 10);
  const urls = hackathons
    .filter((h) => h.status !== 'ended')
    .map(
      (h) =>
        `  <url><loc>${siteUrl}/h/${h.slug}</loc>` +
        `<lastmod>${h.lastSeenAt.slice(0, 10)}</lastmod>` +
        `<changefreq>weekly</changefreq></url>`,
    );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!-- generated ${generatedAt.toISOString()} by npm run refresh -->`,
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <url><loc>${siteUrl}/</loc><lastmod>${day}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}
