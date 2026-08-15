import { memo, useState } from 'react';
import type { Hackathon, TrackEntry, TrackStatus } from '../../shared/types';
import { pathOf } from '../../shared/slug';
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

function Card({ hackathon: h, entry, onTrack }: Props) {
  // Notes are edited locally and committed on blur so every keystroke
  // isn't a write to D1.
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [notesOpen, setNotesOpen] = useState(false);

  const left = daysUntil(deadlineOf(h));
  const urgent = left !== undefined && left >= 0 && left <= 3;
  const prize = formatPrize(h.prize.usd);
  const duration = formatDuration(h.durationDays);

  return (
    <article className={`card${entry ? ' tracked' : ''}`}>
      <div className="card-top">
        {/* Proxied, never hot-linked — and the proxy draws a placeholder for
            the handful of events that have no image at all. */}
        {/* Hidden rather than left broken if the proxy itself is unreachable —
            which is the case under `npm run dev`, where Functions don't run. */}
        <img className="thumb" src={imageSrc(h)} alt="" loading="lazy" width={46} height={46}
             onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 className="card-title">
            <a {...linkProps(pathOf(h))}>{h.title}</a>
          </h3>
          {h.organizer && <div className="card-org">{h.organizer}</div>}
        </div>
      </div>

      <div className="pills">
        <span className={`pill ${h.status}`}>{h.status}</span>
        {urgent && <span className="pill urgent">{formatDeadline(h)}</span>}
        {isNew(h) && <span className="pill new">New</span>}
        {h.mode === 'hybrid' && <span className="pill upcoming">Hybrid</span>}
        {h.eligibility.studentOnly && <span className="pill ended">Students only</span>}
        {h.eligibility.womenOnly && <span className="pill new">Women only</span>}
      </div>

      {h.description && <p className="desc">{h.description}</p>}

      <div className="meta">
        <div className="meta-row">
          <span className="k">Dates</span>
          <span className="v">{formatDateRange(h.startsAt, h.endsAt)}</span>
        </div>
        <div className="meta-row">
          <span className="k">Deadline</span>
          <span className="v">{formatDeadline(h)}</span>
        </div>
        {(prize || duration) && (
          <div className="meta-row">
            <span className="k">{prize ? 'Prize' : 'Length'}</span>
            <span className="v">
              {prize && <span className="prize">{prize}</span>}
              {prize && duration && <span style={{ color: 'var(--text-faint)' }}> · {duration}</span>}
              {!prize && duration}
            </span>
          </div>
        )}
      </div>

      {h.themes.length > 0 && (
        <div className="tags">
          {h.themes.map((t) => <span className="tag" key={t}>{t}</span>)}
        </div>
      )}

      <div className="card-foot">
        <a className="apply" href={h.url} target="_blank" rel="noopener noreferrer">Open ↗</a>
        <a className="link-btn" {...linkProps(pathOf(h))}>Details</a>

        <select
          className="status-select"
          value={entry?.status ?? ''}
          onChange={(e) => onTrack(h.id, { status: (e.target.value || null) as TrackStatus | null })}
          aria-label={`Tracking status for ${h.title}`}
        >
          <option value="">Not tracked</option>
          {TRACK_STATUSES.map((s) => <option key={s} value={s}>{TRACK_LABELS[s]}</option>)}
        </select>

        {entry && (
          <button className="link-btn" onClick={() => setNotesOpen((v) => !v)}>
            {notesOpen ? 'Hide notes' : entry.notes ? 'Notes ●' : 'Add notes'}
          </button>
        )}

        <div className="sources">
          {distinctSources(h).slice(0, 3).map((s) => (
            <a key={s.source} className="source-link"
               href={s.url} target="_blank" rel="noopener noreferrer" title={`Listed on ${s.sourceName}`}>
              {s.sourceName}
            </a>
          ))}
        </div>
      </div>

      {entry && notesOpen && (
        <textarea
          className="notes"
          value={notes}
          placeholder="Team, idea, submission link…"
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (entry.notes ?? '') && onTrack(h.id, { notes })}
        />
      )}
    </article>
  );
}

/**
 * One chip per platform. A platform occasionally lists the same event twice
 * (re-posted under a new Devpost URL); the highest-confidence listing wins
 * and the rest would just render as a repeated name.
 */
function distinctSources(h: Hackathon) {
  const seen = new Set<string>();
  return h.sources.filter((s) => !seen.has(s.source) && seen.add(s.source));
}

// The list re-renders on every filter keystroke; only the tracked entry changes per card.
export const HackathonCard = memo(Card);
