import type { Eligibility, Mode, Prize, Status, Theme } from '../../shared/types.ts';

/** Rough static rates. Only used to make prizes sortable, never shown as an exact figure. */
const USD_PER: Record<string, number> = {
  USD: 1, EUR: 1.09, GBP: 1.27, INR: 0.012, CAD: 0.73, AUD: 0.66,
  SGD: 0.74, JPY: 0.0064, CNY: 0.14, AED: 0.27, CHF: 1.13, BRL: 0.17,
  KRW: 0.00072, NGN: 0.00065, ZAR: 0.055,
};

const SYMBOL_CURRENCY: Record<string, string> = {
  $: 'USD', '₹': 'INR', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₩': 'KRW', '₦': 'NGN',
};

/**
 * Sources write prizes as free text: "$2,000,000", "₹5,00,000 in prizes",
 * "50K USD", "Rs. 1 Lakh". Pull out a comparable USD number, keep the original.
 */
export function parsePrize(raw?: string | number | null): Prize {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? { usd: raw, raw: `$${raw}` } : {};

  const text = stripHtml(String(raw)).trim();
  if (!text) return {};

  let currency = 'USD';
  for (const [sym, code] of Object.entries(SYMBOL_CURRENCY)) {
    if (text.includes(sym)) { currency = code; break; }
  }
  const codeMatch = text.match(/\b(USD|EUR|GBP|INR|CAD|AUD|SGD|JPY|CNY|AED|CHF|BRL|KRW|NGN|ZAR)\b/i);
  if (codeMatch) currency = codeMatch[1].toUpperCase();
  if (/\b(rs\.?|rupees?|inr)\b/i.test(text)) currency = 'INR';

  // Indian numbering: "5 lakh" = 5e5, "2 crore" = 2e7.
  const lakh = text.match(/([\d.,]+)\s*(lakhs?|lacs?)/i);
  const crore = text.match(/([\d.,]+)\s*crores?/i);
  // Western shorthand: "50K", "1.2M".
  const short = text.match(/([\d.,]+)\s*([KkMm])\b/);
  // Plain, longest run of digits wins ("$2,000,000" beats a stray "2026").
  const plain = [...text.matchAll(/[\d][\d,]*(?:\.\d+)?/g)]
    .map((m) => m[0])
    .sort((a, b) => b.replace(/\D/g, '').length - a.replace(/\D/g, '').length)[0];

  let amount: number | undefined;
  if (crore) amount = num(crore[1]) * 1e7;
  else if (lakh) amount = num(lakh[1]) * 1e5;
  else if (short) amount = num(short[1]) * (short[2].toLowerCase() === 'k' ? 1e3 : 1e6);
  else if (plain) amount = num(plain);

  if (!amount || !Number.isFinite(amount) || amount <= 0) return { raw: text };
  const usd = Math.round(amount * (USD_PER[currency] ?? 1));
  // Guard against parsing a year or a participant count as a prize.
  return usd > 0 && usd < 1e9 ? { usd, raw: text, currency } : { raw: text };
}

const num = (s: string) => Number(s.replace(/,/g, ''));

/** Ordered so the first match wins — specific themes before broad ones. */
const THEME_RULES: Array<[Theme, RegExp]> = [
  ['AI/ML', /\b(ai|a\.i\.|artificial intelligence|machine learning|ml|deep learning|llm|genai|generative|nlp|computer vision|agent(ic|s)?|rag|chatbot|neural)\b/i],
  ['Web3', /\b(web3|blockchain|crypto|defi|nft|ethereum|solana|smart contract|dao|zk|zero.?knowledge|token|onchain|on-chain|wallet|polygon|bitcoin)\b/i],
  ['Quantum', /\bquantum\b/i],
  ['AR/VR', /\b(ar\/vr|augmented reality|virtual reality|xr|metaverse|mixed reality|spatial computing)\b/i],
  ['Robotics', /\b(robot(ics|s)?|drone|autonomous vehicle|slam)\b/i],
  ['Cybersecurity', /\b(cyber ?security|infosec|security|ctf|pentest|privacy|cryptography|threat)\b/i],
  ['Fintech', /\b(fintech|banking|payments?|insurtech|trading|financial|lending|credit)\b/i],
  ['Healthcare', /\b(health(care|tech)?|medical|medtech|biotech|bioinformatics|clinical|pharma|mental health|genomics)\b/i],
  ['Sustainability', /\b(sustainab(le|ility)|climate|green|clean ?tech|carbon|renewable|environment(al)?|energy|esg)\b/i],
  ['Social Impact', /\b(social (good|impact)|nonprofit|ngo|civic|humanitarian|accessibility|inclusion|education|edtech|agri(culture|tech)?)\b/i],
  ['Gaming', /\b(gam(e|ing|edev)|unity|unreal|godot|esports)\b/i],
  ['IoT/Hardware', /\b(iot|internet of things|hardware|embedded|arduino|raspberry ?pi|sensor|firmware|electronics|chip|semiconductor)\b/i],
  ['Mobile', /\b(mobile|android|ios|flutter|react native|swift|kotlin|app dev)\b/i],
  ['Data', /\b(data science|data ?analytics|big data|data engineering|visuali[sz]ation|database|sql|etl|dataset)\b/i],
  ['DevTools', /\b(dev ?tools?|developer (tools|experience)|devops|cloud|kubernetes|infrastructure|api|sdk|platform engineering|observability)\b/i],
  ['Open Source', /\b(open ?source|oss|foss|hacktoberfest)\b/i],
  ['Design', /\b(design|ui\/ux|ux|user experience|figma|product design)\b/i],
  ['Web Dev', /\b(web ?dev|frontend|front-end|backend|back-end|full ?stack|javascript|react|next\.?js|typescript|website|web app)\b/i],
];

/**
 * Classify from title + tags + description. Tags are weighted highest by being
 * scanned first; description is included because many listings tag nothing at all.
 */
export function classifyThemes(input: { title: string; tags?: string[]; description?: string }): Theme[] {
  const haystacks = [
    (input.tags ?? []).join(' '),
    input.title,
    (input.description ?? '').slice(0, 1200),
  ];
  const found = new Set<Theme>();
  for (const hay of haystacks) {
    if (!hay) continue;
    for (const [theme, re] of THEME_RULES) if (re.test(hay)) found.add(theme);
  }
  found.delete('Other');
  const themes = [...found];
  // Cap the noise: a listing tagged with everything is tagged with nothing.
  return themes.length ? themes.slice(0, 6) : ['Other'];
}

const STUDENT_ONLY =
  /\b(students? only|only for students?|open (only )?to students?|currently enrolled|undergraduate|college students?|school students?|university students?|student[- ]exclusive|for school and university)\b/i;
const WOMEN_ONLY = /\b(women only|only for women|women[- ]exclusive|girls only|female participants only)\b/i;

/**
 * Conservative: only flags studentOnly on an explicit statement, so you don't
 * silently lose events you could actually enter.
 */
export function inferEligibility(
  text: string,
  overrides: Partial<Eligibility> = {},
): Eligibility {
  const studentOnly = overrides.studentOnly ?? STUDENT_ONLY.test(text);
  const womenOnly = overrides.womenOnly ?? WOMEN_ONLY.test(text);
  return {
    studentOnly,
    womenOnly,
    countries: overrides.countries ?? [],
    openToProfessionals: overrides.openToProfessionals ?? !studentOnly,
  };
}

const ONLINE = /\b(online|virtual|remote|digital|worldwide|anywhere|global)\b/i;
const HYBRID = /\b(hybrid|online\s*\+\s*offline|in[- ]person (and|&) online)\b/i;

export function inferMode(text?: string | null, fallback: Mode = 'unknown'): Mode {
  if (!text) return fallback;
  if (HYBRID.test(text)) return 'hybrid';
  if (ONLINE.test(text)) return 'online';
  return fallback;
}

/**
 * Derived from dates, not from the source's own label — sources go stale,
 * and a listing that says "open" three weeks after its deadline is common.
 */
export function deriveStatus(
  now: Date,
  starts?: string,
  ends?: string,
  regEnds?: string,
): Status {
  const t = now.getTime();
  const s = ts(starts);
  const e = ts(ends);
  const r = ts(regEnds);

  if (e !== undefined && t > e) return 'ended';
  if (s !== undefined && t >= s) return e === undefined || t <= e ? 'ongoing' : 'ended';
  // Not started yet: "open" means you can still register.
  if (r !== undefined) return t <= r ? 'open' : 'upcoming';
  if (s !== undefined) return 'open';
  return 'upcoming';
}

const ts = (iso?: string) => {
  if (!iso) return undefined;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? undefined : n;
};

export function durationDays(starts?: string, ends?: string): number | undefined {
  const s = ts(starts);
  const e = ts(ends);
  if (s === undefined || e === undefined || e < s) return undefined;
  return Math.max(1, Math.round((e - s) / 86_400_000));
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&rsquo;|&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Normalize whatever a source gives us into an ISO-8601 UTC string. */
export function toISO(value?: string | number | Date | null): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (value instanceof Date) return Number.isNaN(+value) ? undefined : value.toISOString();
  if (typeof value === 'number') {
    // Heuristic: 10-digit values are seconds, 13-digit are milliseconds.
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(+d) ? undefined : d.toISOString();
  }
  const cleaned = value.trim().replace(/\s+/g, ' ');
  const direct = new Date(cleaned);
  if (!Number.isNaN(+direct)) return direct.toISOString();
  // "Aug 14, 2026 06:00 PM IST" — Date can't parse the trailing zone abbreviation.
  const stripped = cleaned.replace(/\s+\(?[A-Z]{2,5}\)?$/, '');
  const retry = new Date(stripped);
  return Number.isNaN(+retry) ? undefined : retry.toISOString();
}
