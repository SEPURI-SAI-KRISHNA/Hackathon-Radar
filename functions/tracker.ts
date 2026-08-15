import { serveShell, type ShellEnv } from '../shared/shell';

/** `/tracker` — the app shell, for the same reason as `sources.ts`. */
export const onRequestGet: PagesFunction<ShellEnv> = ({ request, env }) => serveShell(env, request);
