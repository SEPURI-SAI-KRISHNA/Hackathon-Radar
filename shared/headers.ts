/**
 * The site's security headers, in one place.
 *
 * `public/_headers` covers static assets **only** — a Pages Function's response
 * gets none of it (verified against the deployment: `/robots.txt` carries HSTS
 * and XFO, `/api/image` carries neither). So every Function that returns a page
 * has to set these itself, and they have to stay in step with `_headers`.
 *
 * Deliberately free of Workers types so it can live in `shared/`, which both
 * tsconfigs compile.
 */

/**
 * @param scriptSrc what to allow in `script-src` — pass an extra `'sha256-…'`
 *   alongside `'self'` for a page carrying an inline JSON-LD block.
 */
export const securityHeaders = (scriptSrc = "'self'"): Record<string, string> => ({
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; " +
    `img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src ${scriptSrc}; connect-src 'self'; font-src 'self'`,
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), interest-cohort=()',
});
