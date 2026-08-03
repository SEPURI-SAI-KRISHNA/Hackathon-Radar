import type { RawHackathon } from '../../shared/types.ts';

/**
 * A source plugin. Add a file to `scrapers/sources/`, export one of these,
 * register it in `scrapers/sources/index.ts` — nothing else needs to change.
 *
 * `fetch` may throw: the runner isolates failures so one dead site never
 * blocks a refresh, it just shows as a failed source in the UI.
 */
export interface SourceContext {
  /**
   * Report a partial result: the fetch succeeded but coverage is incomplete.
   * Surfaced in the UI rather than thrown, since partial data still beats none.
   */
  warn(message: string): void;
}

export interface Source {
  id: string;
  name: string;
  homepage: string;
  fetch(ctx: SourceContext): Promise<RawHackathon[]>;
}

export const defineSource = (s: Source): Source => s;
