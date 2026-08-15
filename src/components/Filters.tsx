import type { SourceReport, Status, Theme } from '../../shared/types';
import { statusOf } from '../lib/dataset';
import {
  ALL_STATUSES, ALL_THEMES, DEFAULT_FILTERS, STATUS_LABELS,
  type FilterState, type SortKey,
} from '../lib/filters';

interface Props {
  value: FilterState;
  onChange: (next: FilterState) => void;
  sources: SourceReport[];
  /** Theme -> number of matches under the current filters, for the chip counts. */
  themeCounts: Map<Theme, number>;
}

const PRIZE_TIERS = [
  { label: 'Any prize', value: 0 },
  { label: '$1K+', value: 1_000 },
  { label: '$10K+', value: 10_000 },
  { label: '$50K+', value: 50_000 },
];

const DURATION_TIERS: Array<{ label: string; value: number | null }> = [
  { label: 'Any length', value: null },
  { label: 'Weekend (≤3d)', value: 3 },
  { label: '≤1 week', value: 7 },
  { label: '≤1 month', value: 31 },
];

const SORTS: Array<{ label: string; value: SortKey }> = [
  { label: 'Deadline soonest', value: 'deadline' },
  { label: 'Biggest prize', value: 'prize' },
  { label: 'Recently added', value: 'newest' },
  { label: 'Starting soonest', value: 'starting' },
  { label: 'Shortest first', value: 'duration' },
];

export function Filters({ value, onChange, sources, themeCounts }: Props) {
  const set = <K extends keyof FilterState>(key: K, v: FilterState[K]) =>
    onChange({ ...value, [key]: v });

  const toggle = <T,>(list: T[], item: T): T[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  const isDefault = JSON.stringify(value) === JSON.stringify(DEFAULT_FILTERS);

  return (
    <section className="filters">
      <div className="filter-row">
        <input
          className="search"
          type="search"
          placeholder="Search titles, organizers, tech…"
          value={value.query}
          onChange={(e) => set('query', e.target.value)}
        />

        <select value={value.sort} onChange={(e) => set('sort', e.target.value as SortKey)}
                aria-label="Sort by">
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        <select value={value.minPrizeUsd} onChange={(e) => set('minPrizeUsd', Number(e.target.value))}
                aria-label="Minimum prize">
          {PRIZE_TIERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>

        <select
          value={value.maxDurationDays ?? ''}
          onChange={(e) => set('maxDurationDays', e.target.value === '' ? null : Number(e.target.value))}
          aria-label="Maximum duration"
        >
          {DURATION_TIERS.map((d) => (
            <option key={String(d.value)} value={d.value ?? ''}>{d.label}</option>
          ))}
        </select>

        {!isDefault && (
          <button className="link-btn" onClick={() => onChange(DEFAULT_FILTERS)}>Reset filters</button>
        )}
      </div>

      <div className="filter-row">
        <span className="label">Status</span>
        <div className="chips">
          {ALL_STATUSES.map((s: Status) => (
            <button key={s} className="chip" aria-pressed={value.statuses.includes(s)}
                    onClick={() => set('statuses', toggle(value.statuses, s))}>
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        <label className="toggle" style={{ marginLeft: 'auto' }}>
          <input type="checkbox" checked={value.onlineOnly}
                 onChange={(e) => set('onlineOnly', e.target.checked)} />
          Remote only
        </label>
        <label className="toggle">
          <input type="checkbox" checked={value.hideStudentOnly}
                 onChange={(e) => set('hideStudentOnly', e.target.checked)} />
          Hide student-only
        </label>
        <label className="toggle">
          <input type="checkbox" checked={value.hideNoPrize}
                 onChange={(e) => set('hideNoPrize', e.target.checked)} />
          Has prize
        </label>
      </div>

      <div className="filter-row">
        <span className="label">Themes</span>
        <div className="chips">
          {ALL_THEMES.filter((t) => themeCounts.get(t) || value.themes.includes(t)).map((t) => (
            <button key={t} className="chip" aria-pressed={value.themes.includes(t)}
                    onClick={() => set('themes', toggle(value.themes, t))}>
              {t} <span style={{ opacity: 0.55 }}>{themeCounts.get(t) ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="filter-row">
        <span className="label">Sources</span>
        <div className="chips">
          {sources.map((s) => {
            const status = statusOf(s);
            return (
              <button
                key={s.source}
                className="chip"
                aria-pressed={value.sources.includes(s.source)}
                onClick={() => set('sources', toggle(value.sources, s.source))}
                // What this source contributed to the dataset you're looking at.
                title={
                  status === 'failed'
                    ? `Failed: ${s.error ?? 'unknown error'}`
                    : status === 'degraded'
                      ? `${s.count} listings fetched, but incomplete — ${(s.warnings ?? []).join(' · ')}`
                      : `${s.count} listings fetched`
                }
              >
                {status === 'ok' ? '' : '⚠ '}{s.sourceName}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
