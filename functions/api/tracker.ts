import type { TrackEntry, TrackStatus } from '../../shared/types';

interface Env {
  /** D1 binding, created with `wrangler d1 create hackathon-tracker`. */
  DB: D1Database;
  /** Shared secret. Set with `wrangler pages secret put TRACKER_SECRET`. */
  TRACKER_SECRET?: string;
}

const VALID_STATUSES: TrackStatus[] = ['interested', 'registered', 'submitted', 'won', 'skipped'];
const MAX_NOTES = 4000;

/**
 * Personal tracker state. This is a single-user API guarded by one shared
 * secret — enough to stop the open internet writing to your database, and
 * deliberately not a login system.
 */
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  if (!env.DB) {
    return json({ error: 'D1 binding "DB" is not configured' }, 500);
  }
  if (!authorized(request, env)) {
    return json({ error: 'unauthorized' }, 401);
  }

  try {
    switch (request.method) {
      case 'GET':
        return await list(env);
      case 'PUT':
      case 'POST':
        return await upsert(request, env);
      case 'DELETE':
        return await remove(request, env);
      default:
        return json({ error: 'method not allowed' }, 405);
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'unexpected error' }, 500);
  }
};

/**
 * Constant-time-ish compare: bail on length first, then OR every byte
 * difference so the loop doesn't exit early on the first mismatch.
 */
function authorized(request: Request, env: Env): boolean {
  const expected = env.TRACKER_SECRET;
  // No secret configured means the deployment isn't set up for sync yet;
  // reject rather than silently accepting writes from anyone.
  if (!expected) return false;

  const provided = request.headers.get('x-tracker-key') ?? '';
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

async function list(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT hackathon_id, status, notes, updated_at FROM tracker ORDER BY updated_at DESC',
  ).all<{ hackathon_id: string; status: string; notes: string | null; updated_at: string }>();

  const entries: TrackEntry[] = (results ?? []).map((row) => ({
    hackathonId: row.hackathon_id,
    status: row.status as TrackStatus,
    notes: row.notes ?? '',
    updatedAt: row.updated_at,
  }));
  return json({ entries });
}

async function upsert(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as Partial<TrackEntry>;

  const hackathonId = typeof body.hackathonId === 'string' ? body.hackathonId.trim() : '';
  if (!hackathonId) return json({ error: 'hackathonId is required' }, 400);
  if (!body.status || !VALID_STATUSES.includes(body.status)) {
    return json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
  }

  const notes = (body.notes ?? '').slice(0, MAX_NOTES);
  // The client's timestamp drives last-write-wins reconciliation, but an
  // unparseable one would poison that ordering — fall back to server time.
  const updatedAt = isoOrNow(body.updatedAt);

  await env.DB.prepare(
    `INSERT INTO tracker (hackathon_id, status, notes, updated_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(hackathon_id) DO UPDATE SET
       status = excluded.status,
       notes = excluded.notes,
       updated_at = excluded.updated_at
     WHERE excluded.updated_at >= tracker.updated_at`,
  )
    .bind(hackathonId, body.status, notes, updatedAt)
    .run();

  return json({ ok: true });
}

async function remove(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  let hackathonId = url.searchParams.get('id') ?? '';
  if (!hackathonId) {
    const body = (await request.json().catch(() => ({}))) as { hackathonId?: string };
    hackathonId = body.hackathonId ?? '';
  }
  if (!hackathonId) return json({ error: 'hackathonId is required' }, 400);

  await env.DB.prepare('DELETE FROM tracker WHERE hackathon_id = ?1').bind(hackathonId).run();
  return json({ ok: true });
}

function isoOrNow(value?: string): string {
  if (!value) return new Date().toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
