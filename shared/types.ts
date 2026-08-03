/**
 * The single normalized shape every source is converted into.
 * Shared by the scrapers (Node), the Pages Functions (Workers) and the UI (browser).
 */

/** Where you'd physically be. `online` is the only one that matters by default. */
export type Mode = 'online' | 'hybrid' | 'offline' | 'unknown';

/** Lifecycle, derived from dates rather than trusted from the source. */
export type Status = 'open' | 'upcoming' | 'ongoing' | 'ended';

/** Canonical themes. Sources use wildly different vocabularies; everything maps into these. */
export type Theme =
  | 'AI/ML'
  | 'Web3'
  | 'Web Dev'
  | 'Mobile'
  | 'Data'
  | 'Cybersecurity'
  | 'Fintech'
  | 'Healthcare'
  | 'Sustainability'
  | 'Gaming'
  | 'AR/VR'
  | 'IoT/Hardware'
  | 'DevTools'
  | 'Open Source'
  | 'Design'
  | 'Social Impact'
  | 'Robotics'
  | 'Quantum'
  | 'Other';

export interface Prize {
  /** Best-effort USD figure so prizes are comparable and sortable across currencies. */
  usd?: number;
  /** What the source actually said, e.g. "₹5,00,000" or "$2,000,000 in prizes". */
  raw?: string;
  currency?: string;
}

export interface Eligibility {
  /** Restricted to enrolled students — the main thing to filter out as a working professional. */
  studentOnly: boolean;
  womenOnly: boolean;
  /** ISO-3166 alpha-2 codes when a source states a restriction. Empty = no stated restriction. */
  countries: string[];
  /** True unless something explicitly excludes non-students. */
  openToProfessionals: boolean;
}

/** One source's claim about an event, kept after merge so links to every listing survive. */
export interface SourceRef {
  source: string;
  sourceName: string;
  url: string;
  sourceId: string;
}

export interface Hackathon {
  /** Stable across refreshes: derived from the normalized title + start date. */
  id: string;
  title: string;
  /** Canonical link to apply — the highest-confidence source's URL. */
  url: string;
  description?: string;
  imageUrl?: string;
  organizer?: string;

  mode: Mode;
  location?: string;
  status: Status;

  /** All ISO-8601 UTC. Any may be missing; the UI degrades gracefully. */
  startsAt?: string;
  endsAt?: string;
  registrationEndsAt?: string;
  /** Whole days between start and end, when both are known. */
  durationDays?: number;

  prize: Prize;
  themes: Theme[];
  /** Raw source tags, kept for search even when they don't map to a Theme. */
  tags: string[];
  eligibility: Eligibility;
  participants?: number;

  /** Every source that listed this event. `sources[0]` is the canonical one. */
  sources: SourceRef[];

  /** First refresh that saw it — drives the "NEW" badge. */
  firstSeenAt: string;
  lastSeenAt: string;
}

/** What a source plugin returns. The runner fills in everything derived. */
export type RawHackathon = Omit<
  Hackathon,
  'id' | 'status' | 'themes' | 'eligibility' | 'sources' | 'firstSeenAt' | 'lastSeenAt' | 'durationDays' | 'prize'
> & {
  sourceId: string;
  prize?: Prize;
  eligibility?: Partial<Eligibility>;
};

export interface SourceReport {
  source: string;
  sourceName: string;
  ok: boolean;
  count: number;
  ms: number;
  error?: string;
}

/** The file the site fetches: `public/data/hackathons.json`. */
export interface Dataset {
  generatedAt: string;
  count: number;
  hackathons: Hackathon[];
  sources: SourceReport[];
}

/** Your personal state for one hackathon, stored in D1. */
export type TrackStatus = 'interested' | 'registered' | 'submitted' | 'won' | 'skipped';

export interface TrackEntry {
  hackathonId: string;
  status: TrackStatus;
  notes: string;
  updatedAt: string;
}
