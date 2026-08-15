import { useEffect, useState } from 'react';
import type { Hackathon, TrackEntry, TrackStatus } from '../../shared/types';
import { slugOf } from '../../shared/slug';
import { imageSrc } from '../lib/dataset';
import { linkProps } from '../lib/router';
import { TRACK_LABELS, TRACK_STATUSES } from '../lib/tracker';
import {
  daysUntil, deadlineOf, formatDateRange, formatDeadline,
  formatDuration, formatPrize, isNew,
} from '../lib/format';

interface Props {
  hackathon: Hackathon;
  entry?: TrackEntry;
  onTrack: (id: string, patch: { status?: TrackStatus | null; notes?: string }) => void;
}

export function HackathonDetail({ hackathon: h, entry, onTrack }: Props) {
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [copied, setCopied] = useState(false);

  // The Pages Function already put the right title in the HTML for a cold
  // load; this covers arriving here from the grid, where no request was made.
  useEffect(() => {
    const previous = document.title;
    document.title = `${h.title} — Hackathon Radar`;
    return () => {
      document.title = previous;
    };
  }, [h.title]);

  const left = daysUntil(deadlineOf(h));
  const prize = formatPrize(h.prize.usd);

  return (
    <article className="detail">
      <a className="back" {...linkProps('/')}>← All hackathons</a>

      <header className="detail-head">
        <img className="detail-thumb" src={imageSrc(h)} alt="" width={96} height={96}
             onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        <div style={{ minWidth: 0 }}>
          <h2 className="detail-title">{h.title}</h2>
          {h.organizer && <div className="card-org">{h.organizer}</div>}
          <div className="pills" style={{ marginTop: 8 }}>
            <span className={`pill ${h.status}`}>{h.status}</span>
            {left !== undefined && left >= 0 && left <= 3 && (
              <span className="pill urgent">{formatDeadline(h)}</span>
            )}
            {isNew(h) && <span className="pill new">New</span>}
            {h.mode === 'hybrid' && <span className="pill upcoming">Hybrid</span>}
            {h.eligibility.studentOnly && <span className="pill ended">Students only</span>}
            {h.eligibility.womenOnly && <span className="pill new">Women only</span>}
          </div>
        </div>
      </header>

      {h.description && <p className="detail-desc">{h.description}</p>}

      <dl className="detail-grid">
        <Field label="Dates" value={formatDateRange(h.startsAt, h.endsAt)} />
        <Field label="Deadline to enter" value={formatDeadline(h)} />
        <Field label="Length" value={formatDuration(h.durationDays) ?? 'Not stated'} />
        <Field
          label="Prize pool"
          // The raw string is what the organizer wrote; the USD figure exists
          // for sorting and is converted at static rates, so never show it alone.
          value={h.prize.raw ?? prize ?? 'None listed'}
          hint={h.prize.raw && prize ? `≈ ${prize}` : undefined}
        />
        <Field
          label="Where"
          value={h.mode === 'online' ? 'Online' : (h.location ?? h.mode)}
        />
        <Field
          label="Participants"
          value={h.participants ? h.participants.toLocaleString() : 'Not published'}
        />
        <Field
          label="Eligibility"
          value={
            h.eligibility.studentOnly
              ? 'Enrolled students only'
              : h.eligibility.womenOnly
                ? 'Women only'
                : 'No stated restriction'
          }
          hint={h.eligibility.countries.length ? h.eligibility.countries.join(', ') : undefined}
        />
        <Field label="First seen" value={new Date(h.firstSeenAt).toLocaleDateString()} />
      </dl>

      {(h.themes.length > 0 || h.tags.length > 0) && (
        <div className="tags">
          {h.themes.map((t) => <span className="tag" key={t}>{t}</span>)}
          {h.tags
            .filter((t) => !h.themes.some((theme) => theme.toLowerCase() === t.toLowerCase()))
            .slice(0, 12)
            .map((t) => <span className="tag subtle" key={t}>{t}</span>)}
        </div>
      )}

      <div className="detail-actions">
        <a className="apply" href={h.url} target="_blank" rel="noopener noreferrer">
          Open on {h.sources[0]?.sourceName ?? 'the listing'} ↗
        </a>

        <select
          className="status-select"
          value={entry?.status ?? ''}
          onChange={(e) => onTrack(h.id, { status: (e.target.value || null) as TrackStatus | null })}
          aria-label={`Tracking status for ${h.title}`}
        >
          <option value="">Not tracked</option>
          {TRACK_STATUSES.map((s) => <option key={s} value={s}>{TRACK_LABELS[s]}</option>)}
        </select>

        <button
          className="link-btn"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(`${location.origin}/h/${slugOf(h)}`)
              .then(() => setCopied(true));
          }}
        >
          {copied ? 'Link copied' : 'Copy link'}
        </button>
      </div>

      {entry && (
        <label className="detail-notes">
          <span className="label">Your notes</span>
          <textarea
            className="notes"
            value={notes}
            placeholder="Team, idea, submission link…"
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== (entry.notes ?? '') && onTrack(h.id, { notes })}
          />
        </label>
      )}

      <div className="detail-sources">
        <span className="label">Listed on</span>
        <ul>
          {h.sources.map((s) => (
            <li key={`${s.source}:${s.sourceId}`}>
              <a href={s.url} target="_blank" rel="noopener noreferrer">{s.sourceName} ↗</a>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="detail-field">
      <dt>{label}</dt>
      <dd>
        {value}
        {hint && <span className="hint"> {hint}</span>}
      </dd>
    </div>
  );
}
