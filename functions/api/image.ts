/**
 * Thumbnail proxy: `/api/image?u=<source url>&t=<title>`.
 *
 * The dataset's `imageUrl` points at five different third-party CDNs. Rendering
 * those directly means every visitor's IP is handed to five companies, and a
 * card silently loses its image the moment one of them expires a URL. Here the
 * fetch happens once at the edge, the bytes are cached, and anything that fails
 * — expired, blocked, not an image, or never had one — becomes a generated
 * placeholder instead of a broken picture.
 *
 * It also means the site's CSP can stay `img-src 'self' data:`.
 */

/**
 * Hosts the scrapers actually produce. Not a security boundary against the
 * remote host itself, but it stops the endpoint becoming an open image proxy
 * for the internet. A new source needs its CDN added here.
 */
const ALLOWED_HOSTS = [
  '.cloudfront.net', // Devpost, Unstop, MLH events
  'mlhusercontent.com',
  'assets.devfolio.co',
  'ethglobal.b-cdn.net',
  'storage.googleapis.com',
];

const MAX_BYTES = 3_000_000;
const UPSTREAM_TIMEOUT_MS = 8_000;
/** A day in the browser, a month at the edge — these images never change. */
const CACHE_CONTROL = 'public, max-age=86400, s-maxage=2592000';

export const onRequestGet: PagesFunction = async ({ request }) => {
  const params = new URL(request.url).searchParams;
  const title = params.get('t') ?? '';
  const target = params.get('u');

  if (!target || !allowed(target)) return placeholder(title || target || '');

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: { Accept: 'image/*', 'User-Agent': 'hackathon-radar-image-proxy' },
      redirect: 'follow',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cf: { cacheEverything: true, cacheTtl: 604800 },
    });
  } catch {
    return placeholder(title || target);
  }

  const type = upstream.headers.get('content-type') ?? '';
  const length = Number(upstream.headers.get('content-length') ?? 0);
  if (!upstream.ok || !type.startsWith('image/') || length > MAX_BYTES) {
    return placeholder(title || target);
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': CACHE_CONTROL,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
};

function allowed(target: string): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return ALLOWED_HOSTS.some((h) => (h.startsWith('.') ? url.hostname.endsWith(h) : url.hostname === h));
}

/**
 * A tile with the event's initials on a colour derived from its own text, so
 * a missing image still looks deliberate and two events don't look the same.
 */
function placeholder(seed: string): Response {
  const hue = hash(seed) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="">` +
    `<rect width="96" height="96" fill="hsl(${hue} 62% 90%)"/>` +
    `<text x="48" y="49" dominant-baseline="central" text-anchor="middle" ` +
    `font-family="system-ui, sans-serif" font-size="34" font-weight="600" fill="hsl(${hue} 55% 34%)">` +
    `${escapeXml(initials(seed))}</text></svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      // Shorter than a real image: a URL that 404s today may be fixed upstream.
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      // SVG is a document format, so a same-origin one gets locked down even
      // though this one is generated from escaped text. `_headers` does not
      // reach Function responses, so it has to be said here.
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}

function initials(seed: string): string {
  const words = seed.replace(/https?:\/\/\S+/g, '').match(/[A-Za-z0-9]+/g);
  if (!words?.length) return '#';
  return (words[0].charAt(0) + (words[1]?.charAt(0) ?? '')).toUpperCase();
}

/** FNV-1a — small, stable, and only ever used to pick a hue. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
