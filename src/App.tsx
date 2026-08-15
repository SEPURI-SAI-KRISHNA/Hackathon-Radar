import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dataset, Hackathon, Theme, TrackEntry, TrackStatus } from '../shared/types';
import { slugOf } from '../shared/slug';
import { Filters } from './components/Filters';
import { HackathonCard } from './components/HackathonCard';
import { HackathonDetail } from './components/HackathonDetail';
import { SourceHealth } from './components/SourceHealth';
import { bySourceStatus, isStale, STALE_AFTER_HOURS } from './lib/dataset';
import { applyFilters, DEFAULT_FILTERS, type FilterState } from './lib/filters';
import { isNew, relativeTime } from './lib/format';
import { linkProps, useRoute, type Route } from './lib/router';
import { getKey, pull, save, setKey, TRACK_LABELS, type SyncState } from './lib/tracker';

type ThemeMode = 'light' | 'dark' | 'system';

const FILTERS_STORAGE = 'hr:filters';
const THEME_STORAGE = 'hr:theme';

const TABS: Array<{ path: string; route: Route['name']; label: string }> = [
  { path: '/', route: 'discover', label: 'Discover' },
  { path: '/tracker', route: 'tracker', label: 'My tracker' },
  { path: '/sources', route: 'sources', label: 'Sources' },
];

export default function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(loadFilters);
  const [entries, setEntries] = useState<Record<string, TrackEntry>>({});
  const [sync, setSync] = useState<SyncState>('local');
  const [themeMode, setThemeMode] = useState<ThemeMode>(loadTheme);
  const [keyInput, setKeyInput] = useState('');
  const route = useRoute();

  useEffect(() => {
    // Cache-bust so a fresh deploy's data shows up without a hard reload.
    fetch(`/data/hackathons.json?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Dataset) => setData(d))
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    pull().then(({ state, entries: loaded }) => {
      setEntries(loaded);
      setSync(state);
    });
  }, []);

  useEffect(() => localStorage.setItem(FILTERS_STORAGE, JSON.stringify(filters)), [filters]);

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE, themeMode);
    const root = document.documentElement;
    if (themeMode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', themeMode);
  }, [themeMode]);

  const onTrack = useCallback(
    (id: string, patch: { status?: TrackStatus | null; notes?: string }) => {
      save(id, patch).then(({ entries: next, state }) => {
        setEntries({ ...next });
        setSync(state);
      });
    },
    [],
  );

  const all = data?.hackathons ?? [];

  const visible = useMemo(() => {
    if (route.name === 'tracker') {
      // The tracker shows what you've saved, unfiltered — hiding a hackathon
      // you deliberately tracked because it no longer matches a filter is
      // exactly the failure this app exists to prevent.
      return all
        .filter((h) => entries[h.id])
        .sort((a, b) => Date.parse(entries[b.id].updatedAt) - Date.parse(entries[a.id].updatedAt));
    }
    return applyFilters(all, filters);
  }, [all, filters, route.name, entries]);

  const selected = useMemo(
    () => (route.name === 'detail' ? all.find((h) => slugOf(h) === route.slug) : undefined),
    [all, route],
  );

  // Counts reflect every filter except the theme selection itself, so the
  // numbers still tell you what switching theme would give you.
  const themeCounts = useMemo(() => {
    const base = applyFilters(all, { ...filters, themes: [] });
    const counts = new Map<Theme, number>();
    for (const h of base) for (const t of h.themes) counts.set(t, (counts.get(t) ?? 0) + 1);
    return counts;
  }, [all, filters]);

  const stats = useMemo(() => {
    const enterable = all.filter(
      (h) =>
        (h.status === 'open' || h.status === 'ongoing') &&
        (h.mode === 'online' || h.mode === 'hybrid') &&
        !h.eligibility.studentOnly,
    );
    return {
      enterable: enterable.length,
      fresh: enterable.filter(isNew).length,
      tracked: Object.keys(entries).length,
      registered: Object.values(entries).filter((e) => e.status === 'registered' || e.status === 'submitted').length,
    };
  }, [all, entries]);

  const failedSources = data ? bySourceStatus(data.sources, 'failed') : [];
  // Answered but returned less than everything — worth flagging separately,
  // since a partial scrape otherwise looks identical to a complete one.
  const degradedSources = data ? bySourceStatus(data.sources, 'degraded') : [];
  const dataStale = data ? isStale(data) : false;

  return (
    <div className="app">
      <header className="header">
        <div className="header-row">
          <div className="brand">
            <h1><a {...linkProps('/')}>Hackathon Radar</a></h1>
            <span className={`sub${dataStale ? ' stale' : ''}`}>
              {data ? `updated ${relativeTime(data.generatedAt)}` : loadError ? 'data unavailable' : 'loading…'}
            </span>
          </div>

          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <a key={t.path} role="tab" className="tab"
                 aria-selected={route.name === t.route || (t.route === 'discover' && route.name === 'detail')}
                 {...linkProps(t.path)}>
                {t.label}{t.route === 'tracker' ? ` (${stats.tracked})` : ''}
              </a>
            ))}
          </div>

          <button className="icon-btn" title={`Theme: ${themeMode}`}
                  onClick={() => setThemeMode(nextTheme(themeMode))}>
            {themeMode === 'dark' ? '☾' : themeMode === 'light' ? '☀' : '◐'}
          </button>
        </div>

        <div className="stats">
          <div className="stat"><b>{stats.enterable}</b><span>you can enter now</span></div>
          <div className="stat"><b>{stats.fresh}</b><span>added this week</span></div>
          <div className="stat"><b>{stats.tracked}</b><span>tracked</span></div>
          <div className="stat"><b>{stats.registered}</b><span>registered or submitted</span></div>
        </div>
      </header>

      {loadError && (
        <div className="banner warn">
          Couldn't load the hackathon data ({loadError}). Run <code>npm run refresh</code> to generate it.
        </div>
      )}

      {/* Freshness is the whole trust signal for an aggregator: without it there
          is no way to tell yesterday's data from last month's. */}
      {dataStale && data && (
        <div className="banner warn">
          <span>
            This data is {relativeTime(data.generatedAt)} — more than {STALE_AFTER_HOURS} hours old,
            so deadlines may have passed. The refresh normally runs every 2 days.
          </span>
          <a className="link-btn" {...linkProps('/sources')}>Check source health</a>
        </div>
      )}

      {failedSources.length > 0 && (
        <div className="banner warn">
          <span>
            {failedSources.length} source{failedSources.length > 1 ? 's' : ''} failed on the last refresh:{' '}
            {failedSources.map((s) => s.sourceName).join(', ')}. Coverage may be incomplete.
          </span>
          <a className="link-btn" {...linkProps('/sources')}>Details</a>
        </div>
      )}

      {degradedSources.length > 0 && (
        <div className="banner warn">
          <span>
            Partial data from {degradedSources.map((s) => s.sourceName).join(', ')} — the site
            answered but stopped early, usually rate limiting.
          </span>
          <a className="link-btn" {...linkProps('/sources')}>Details</a>
        </div>
      )}

      {sync === 'unauthorized' && (
        <div className="banner warn">
          <span>Tracker key rejected — your changes are saved on this device only.</span>
          <input className="search" style={{ flex: '0 1 220px' }} type="password"
                 placeholder="Tracker key" value={keyInput}
                 onChange={(e) => setKeyInput(e.target.value)} />
          <button className="link-btn" onClick={() => {
            setKey(keyInput);
            pull().then(({ state, entries: loaded }) => { setEntries(loaded); setSync(state); });
          }}>Save key</button>
        </div>
      )}

      {sync === 'local' && !getKey() && stats.tracked > 0 && (
        <div className="banner">
          <span>Tracking is saved on this device. Add your tracker key to sync it across devices.</span>
          <input className="search" style={{ flex: '0 1 220px' }} type="password"
                 placeholder="Tracker key" value={keyInput}
                 onChange={(e) => setKeyInput(e.target.value)} />
          <button className="link-btn" onClick={() => {
            setKey(keyInput);
            pull().then(({ state, entries: loaded }) => { setEntries(loaded); setSync(state); });
          }}>Sync</button>
        </div>
      )}

      {route.name === 'sources' && data && <SourceHealth data={data} />}

      {route.name === 'detail' && data && (
        selected ? (
          <HackathonDetail hackathon={selected} entry={entries[selected.id]} onTrack={onTrack} />
        ) : (
          <div className="empty">
            <h3>That hackathon isn't in the current dataset</h3>
            <p>
              Listings are dropped a month after they end, so the link may have expired.{' '}
              <a className="link-btn" {...linkProps('/')}>Browse what's open →</a>
            </p>
          </div>
        )
      )}

      {route.name === 'discover' && data && (
        <Filters value={filters} onChange={setFilters} sources={data.sources} themeCounts={themeCounts} />
      )}

      {route.name === 'tracker' && stats.tracked > 0 && (
        <div className="banner">
          {(['interested', 'registered', 'submitted', 'won', 'skipped'] as TrackStatus[])
            .map((s) => ({ s, n: Object.values(entries).filter((e) => e.status === s).length }))
            .filter(({ n }) => n > 0)
            .map(({ s, n }) => <span key={s}><b>{n}</b> {TRACK_LABELS[s].toLowerCase()}</span>)
            .reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ' · ', el] : [el]), [])}
        </div>
      )}

      {(route.name === 'discover' || route.name === 'tracker') &&
        (visible.length > 0 ? (
          <div className="grid">
            {visible.map((h: Hackathon) => (
              <HackathonCard key={h.id} hackathon={h} entry={entries[h.id]} onTrack={onTrack} />
            ))}
          </div>
        ) : (
          data && (
            <div className="empty">
              <h3>{route.name === 'tracker' ? 'Nothing tracked yet' : 'No hackathons match'}</h3>
              <p>
                {route.name === 'tracker'
                  ? 'Set a status on any hackathon in Discover and it shows up here.'
                  : 'Try widening the status filters or turning off "Hide student-only".'}
              </p>
            </div>
          )
        ))}

      {data && (
        <footer className="footer">
          <p>
            {route.name === 'discover' || route.name === 'tracker'
              ? `Showing ${visible.length} of ${data.count} tracked events`
              : `${data.count} tracked events`}{' '}
            from {data.sources.length} sources —{' '}
            <a className="link-btn" {...linkProps('/sources')}>source health</a>. Data refreshes
            automatically every 2 days; run <code>npm run refresh</code> to update it yourself.
          </p>
          <p>
            Part of <a href="https://sepurisaikrishna.com" rel="noopener">sepurisaikrishna.com</a>
          </p>
        </footer>
      )}
    </div>
  );
}

const nextTheme = (m: ThemeMode): ThemeMode => (m === 'system' ? 'light' : m === 'light' ? 'dark' : 'system');

function loadFilters(): FilterState {
  try {
    const saved = localStorage.getItem(FILTERS_STORAGE);
    // Spread over the defaults so filters added in a later version aren't undefined.
    return saved ? { ...DEFAULT_FILTERS, ...(JSON.parse(saved) as FilterState) } : DEFAULT_FILTERS;
  } catch {
    return DEFAULT_FILTERS;
  }
}

const loadTheme = (): ThemeMode => (localStorage.getItem(THEME_STORAGE) as ThemeMode) ?? 'system';
