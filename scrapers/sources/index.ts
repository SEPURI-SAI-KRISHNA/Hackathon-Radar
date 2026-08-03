import type { Source } from '../lib/source.ts';
import devpost from './devpost.ts';
import devfolio from './devfolio.ts';
import unstop from './unstop.ts';
import hackerearth from './hackerearth.ts';
import mlh from './mlh.ts';
import ethglobal from './ethglobal.ts';
import generic from './generic.ts';

/** Every registered source. Order is irrelevant — the runner fetches in parallel. */
export const sources: Source[] = [
  devpost,
  devfolio,
  unstop,
  hackerearth,
  mlh,
  ethglobal,
  generic,
];
