import type { Source } from '../lib/source.ts';
import devpost from './devpost.ts';
import devfolio from './devfolio.ts';
import unstop from './unstop.ts';
import mlh from './mlh.ts';
import ethglobal from './ethglobal.ts';

/**
 * Every registered source. Order is irrelevant — the runner fetches in parallel.
 *
 * `generic.ts` (the schema.org adapter) is deliberately absent: its only page
 * was Eventbrite, which 405s from CI runners. Re-add it here the moment you
 * give it a page that works — an empty source would otherwise report a healthy
 * zero on every refresh.
 */
export const sources: Source[] = [
  devpost,
  devfolio,
  unstop,
  mlh,
  ethglobal,
];
