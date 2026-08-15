import { serveShell, type ShellEnv } from '../shared/shell';

/**
 * `/sources` — a client-side route with no file of its own.
 *
 * This was a `_redirects` rewrite to `/index.html` first, which does not work:
 * Pages canonicalises `/index.html` to `/`, so the rewrite collapsed into a
 * 308 to the home page and the route was unreachable on a cold load. Serving
 * the shell from a Function is unambiguous.
 */
export const onRequestGet: PagesFunction<ShellEnv> = ({ request, env }) => serveShell(env, request);
