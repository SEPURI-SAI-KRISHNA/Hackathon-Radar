const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const debug = (...args: unknown[]) => {
  if (process.env.DEBUG) console.log('  ·', ...args);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FetchOpts extends RequestInit {
  /** Attempts including the first. Backs off 600ms, 1.8s, 5.4s. */
  retries?: number;
  timeoutMs?: number;
}

/**
 * Every source goes through here so retries, timeouts and the browser-ish
 * headers are consistent. Throws on non-2xx after exhausting retries.
 */
export async function request(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { retries = 3, timeoutMs = 30_000, ...init } = opts;
  let lastError: unknown;

  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) await sleep(600 * 3 ** (attempt - 1));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: {
          'User-Agent': UA,
          Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          ...init.headers,
        },
      });
      // 4xx other than 429 won't fix itself; fail fast instead of burning retries.
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      lastError = err;
      if (err instanceof Error && /HTTP 4(?!29)/.test(err.message)) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${url} failed: ${lastError instanceof Error ? lastError.message : lastError}`);
}

export async function getJSON<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const res = await request(url, opts);
  return (await res.json()) as T;
}

export async function getText(url: string, opts: FetchOpts = {}): Promise<string> {
  const res = await request(url, opts);
  return await res.text();
}

export interface Paged<T> {
  items: T[];
  /**
   * Set only when pagination stopped because a page kept failing — i.e. rows
   * are missing. Reaching the page cap or an empty page is a normal end and
   * leaves this undefined.
   */
  truncated?: string;
}

/**
 * How long to wait after a page fails, in order. `request` has already burned
 * its own fast retries by then, so reaching here mid-sweep almost always means
 * rate limiting — these back off past a per-minute *and* a per-few-minute
 * window before giving up on the rest of the pages.
 */
const PAGE_BACKOFF_MS = [20_000, 45_000];

/** A 4xx that isn't 429 is a blocked or changed endpoint — waiting won't help. */
const isPermanent = (err: unknown) => err instanceof Error && /HTTP 4(?!29)/.test(err.message);

/** Walk paginated endpoints politely, stopping on empty page, cap, or a page that keeps throwing. */
export async function paginate<T>(
  fetchPage: (page: number) => Promise<T[]>,
  { maxPages = 20, delayMs = 350 } = {},
): Promise<Paged<T>> {
  const items: T[] = [];

  for (let page = 1; page <= maxPages; page++) {
    let batch: T[] | undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt <= PAGE_BACKOFF_MS.length; attempt++) {
      if (attempt > 0) {
        const wait = PAGE_BACKOFF_MS[attempt - 1];
        debug(`page ${page} failed, backing off ${wait / 1000}s:`, (lastError as Error).message);
        await sleep(wait);
      }
      try {
        batch = await fetchPage(page);
        break;
      } catch (err) {
        lastError = err;
        if (isPermanent(err)) break;
      }
    }

    if (batch === undefined) {
      const reason = lastError instanceof Error ? lastError.message : String(lastError);
      return { items, truncated: `stopped at page ${page} of ${maxPages}: ${reason}` };
    }
    if (!batch.length) break;
    items.push(...batch);
    if (page < maxPages) await sleep(delayMs);
  }

  return { items };
}
