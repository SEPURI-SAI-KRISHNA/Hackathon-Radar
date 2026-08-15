#!/usr/bin/env node
/**
 * Git merge driver for the two generated artifacts, `public/data/hackathons.json`
 * and `public/sitemap.xml`.
 *
 * Those files are rewritten wholesale by every scrape — the JSON is a single
 * line — so any pull where CI refreshed the dataset *and* you refreshed it
 * locally conflicts, every time, with a diff no human can read.
 *
 * The rule that's actually correct for a generated file is **newest wins**:
 * whichever side was scraped later is the better dataset, and the older one
 * would have been replaced by the next refresh anyway.
 *
 * Note this deliberately is *not* `merge=ours`. During a rebase git's "ours" is
 * the upstream branch being replayed onto, not your work — so an `ours` driver
 * silently discards the newer local dataset, which is the exact failure this is
 * here to prevent.
 *
 * Wire it up once per clone (it lives in git config, which can't be committed):
 *
 *     npm run setup:merge-driver
 *
 * Without that config git ignores `.gitattributes` here and you just get a
 * normal conflict — the safe fallback.
 *
 * Called by git as: merge-generated.mjs %O %A %B %L %P
 *   %O ancestor   %A ours (also the file to write the result into)
 *   %B theirs     %L conflict marker size   %P the real pathname
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [ours, theirs] = process.argv.slice(3);
const shownPath = process.argv[6] ?? ours;

/** `"generatedAt":"…"` in the dataset, `<!-- generated … -->` in the sitemap. */
const STAMP = /"generatedAt"\s*:\s*"([^"]+)"|<!--\s*generated\s+(\S+)/;

function stampOf(file) {
  const match = STAMP.exec(readFileSync(file, 'utf8'));
  const iso = match?.[1] ?? match?.[2];
  const time = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(time) ? undefined : { iso, time };
}

const a = stampOf(ours);
const b = stampOf(theirs);

// No timestamp on one side means this isn't the file we think it is (hand-edited,
// truncated, a different format). Refuse rather than guess — exiting non-zero
// leaves git to write normal conflict markers for a human to resolve.
if (!a || !b) {
  console.error(`merge-generated: no generation timestamp in ${!a ? 'ours' : 'theirs'} for ${shownPath} — leaving the conflict`);
  process.exit(1);
}

const winner = b.time > a.time ? 'theirs' : 'ours';
if (winner === 'theirs') writeFileSync(ours, readFileSync(theirs));

console.error(
  `merge-generated: ${shownPath} → kept ${winner} (${winner === 'theirs' ? b.iso : a.iso}, ` +
    `dropped ${winner === 'theirs' ? a.iso : b.iso})`,
);
process.exit(0);
