import { securityHeaders } from './headers';

/**
 * Serving the built app shell for a client-side route. Function-side only, but
 * it lives here rather than under `functions/` because every file in that
 * directory is a route — and it is typed structurally so it needs no Workers
 * types, which keeps it compiling under the browser tsconfig too.
 */
export interface ShellEnv {
  /** The static-assets binding every Pages deployment gets. */
  ASSETS: { fetch(input: string): Promise<Response> };
}

/** The SPA shell, unmodified, with the headers `_headers` can't reach. */
export async function serveShell(env: ShellEnv, request: Request): Promise<Response> {
  const shell = await env.ASSETS.fetch(new URL('/index.html', request.url).toString());
  return new Response(shell.body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      ...securityHeaders(),
    },
  });
}
