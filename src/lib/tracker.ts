import type { TrackEntry, TrackStatus } from '../../shared/types';

const KEY_STORAGE = 'hr:tracker-key';
const MIRROR_STORAGE = 'hr:tracker-mirror';

export type SyncState = 'local' | 'syncing' | 'synced' | 'unauthorized' | 'offline';

export const TRACK_STATUSES: TrackStatus[] = ['interested', 'registered', 'submitted', 'won', 'skipped'];

export const TRACK_LABELS: Record<TrackStatus, string> = {
  interested: 'Interested',
  registered: 'Registered',
  submitted: 'Submitted',
  won: 'Won',
  skipped: 'Not for me',
};

export const getKey = () => localStorage.getItem(KEY_STORAGE) ?? '';
export const setKey = (key: string) => localStorage.setItem(KEY_STORAGE, key.trim());

/**
 * D1 is the source of truth so status follows you between laptop and phone,
 * but every write also lands in localStorage. That mirror is what renders,
 * which keeps the UI instant and usable if the API or network is down.
 */
export function readMirror(): Record<string, TrackEntry> {
  try {
    return JSON.parse(localStorage.getItem(MIRROR_STORAGE) ?? '{}') as Record<string, TrackEntry>;
  } catch {
    return {};
  }
}

const writeMirror = (entries: Record<string, TrackEntry>) =>
  localStorage.setItem(MIRROR_STORAGE, JSON.stringify(entries));

async function call(method: string, body?: unknown): Promise<Response> {
  return fetch('/api/tracker', {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-tracker-key': getKey(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * Pull the server's copy and reconcile. Last-write-wins per hackathon using
 * `updatedAt`, so an edit made offline on one device isn't thrown away by a
 * later sync from another.
 */
export async function pull(): Promise<{ state: SyncState; entries: Record<string, TrackEntry> }> {
  const local = readMirror();
  if (!getKey()) return { state: 'local', entries: local };

  let res: Response;
  try {
    res = await call('GET');
  } catch {
    return { state: 'offline', entries: local };
  }
  if (res.status === 401) return { state: 'unauthorized', entries: local };
  if (!res.ok) return { state: 'offline', entries: local };

  const { entries } = (await res.json()) as { entries: TrackEntry[] };
  const merged = { ...local };
  for (const remote of entries) {
    const mine = merged[remote.hackathonId];
    if (!mine || Date.parse(remote.updatedAt) >= Date.parse(mine.updatedAt)) {
      merged[remote.hackathonId] = remote;
    }
  }
  writeMirror(merged);

  // Push anything the server hasn't seen, so a fresh device donates its history.
  const remoteIds = new Set(entries.map((e) => e.hackathonId));
  for (const entry of Object.values(merged)) {
    if (!remoteIds.has(entry.hackathonId)) void call('PUT', entry);
  }
  return { state: 'synced', entries: merged };
}

/** Writes locally first and returns immediately; the server call trails behind. */
export async function save(
  hackathonId: string,
  patch: { status?: TrackStatus | null; notes?: string },
): Promise<{ entries: Record<string, TrackEntry>; state: SyncState }> {
  const entries = readMirror();
  const existing = entries[hackathonId];

  if (patch.status === null) {
    delete entries[hackathonId];
    writeMirror(entries);
    const state = await push(() => call('DELETE', { hackathonId }));
    return { entries, state };
  }

  const entry: TrackEntry = {
    hackathonId,
    status: patch.status ?? existing?.status ?? 'interested',
    notes: patch.notes ?? existing?.notes ?? '',
    updatedAt: new Date().toISOString(),
  };
  entries[hackathonId] = entry;
  writeMirror(entries);
  const state = await push(() => call('PUT', entry));
  return { entries, state };
}

async function push(send: () => Promise<Response>): Promise<SyncState> {
  if (!getKey()) return 'local';
  try {
    const res = await send();
    if (res.status === 401) return 'unauthorized';
    return res.ok ? 'synced' : 'offline';
  } catch {
    return 'offline';
  }
}
