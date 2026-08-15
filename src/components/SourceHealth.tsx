import type { Dataset } from '../../shared/types';
import { hoursOld, isStale, SOURCE_STATUS_LABELS, statusOf, STALE_AFTER_HOURS } from '../lib/dataset';
import { relativeTime } from '../lib/format';

/**
 * The scrape already records `status`, `count`, `ms` and `warnings` for every
 * source and publishes them in the dataset. Rendering them costs nothing and
 * turns "trust me, it aggregates" into something a visitor can check — it is
 * also how a half-fetched source gets noticed without an outside audit.
 */
export function SourceHealth({ data }: { data: Dataset }) {
  const reports = [...data.sources].sort((a, b) => b.count - a.count);
  const totalRaw = reports.reduce((n, s) => n + s.count, 0);
  const stale = isStale(data);

  return (
    <section className="health">
      <h2>Source health</h2>
      <p className="health-lede">
        Every refresh records what each platform returned. {totalRaw.toLocaleString()} raw listings
        collapsed into {data.count.toLocaleString()} unique events — the rest were the same
        hackathon posted in more than one place.
      </p>

      <div className={`banner${stale ? ' warn' : ''}`}>
        <span>
          Last refresh {relativeTime(data.generatedAt)} ({new Date(data.generatedAt).toLocaleString()}).
          {stale
            ? ` That is over ${STALE_AFTER_HOURS} hours old — the scheduled scrape may be failing.`
            : ' Runs automatically every 2 days.'}
        </span>
      </div>

      <div className="table-scroll">
        <table className="health-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Status</th>
              <th className="num">Listings</th>
              <th className="num">Took</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((s) => {
              const status = statusOf(s);
              return (
                <tr key={s.source}>
                  <td>{s.sourceName}</td>
                  <td>
                    <span className={`pill health-${status}`}>{SOURCE_STATUS_LABELS[status]}</span>
                  </td>
                  <td className="num">{s.count.toLocaleString()}</td>
                  <td className="num">{(s.ms / 1000).toFixed(1)}s</td>
                  <td className="detail-cell">
                    {status === 'failed' && (s.error ?? 'Unknown error')}
                    {status === 'degraded' && (s.warnings ?? []).join(' · ')}
                    {status === 'ok' && <span className="hint">Complete</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="hint">
        <b>Degraded</b> means the platform answered but stopped part-way through its pages —
        usually rate limiting — so some of its events are missing from this refresh. It is
        deliberately not reported as success.
      </p>

      <p className="hint">
        Dataset age {hoursOld(data).toFixed(1)}h · <a href="/data/hackathons.json">raw JSON</a>
      </p>
    </section>
  );
}
