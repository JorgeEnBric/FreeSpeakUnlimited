export interface SplitResult {
  sentences: string[];
  remainder: string;
}

const MAX_SENTENCE_LENGTH = 120;

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'st', 'prof', 'sr', 'jr', 'vs',
  'etc', 'eg', 'ie', 'approx', 'dept', 'corp', 'inc', 'ltd', 'no',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept',
  'oct', 'nov', 'dec',
]);

function isAbbreviation(text: string, start: number, periodIndex: number): boolean {
  const segStart = Math.max(start, text.lastIndexOf(' ', periodIndex - 1) + 1);
  const word = text.slice(segStart, periodIndex).replace(/[^a-zA-Z]/g, '').toLowerCase();
  return word.length > 0 && ABBREVIATIONS.has(word);
}

export function splitSentences(text: string): SplitResult {
  const sentences: string[] = [];
  let start = 0;
  let i = 0;
  const len = text.length;

  while (i < len) {
    if (i - start >= MAX_SENTENCE_LENGTH) {
      const seg = text.slice(start, i);
      const lastSpace = seg.lastIndexOf(' ');
      const cut = lastSpace > 0 ? lastSpace : seg.length;
      const part = seg.slice(0, cut).trim();
      if (part) sentences.push(part);
      start += cut + (lastSpace > 0 ? 1 : 0);
      i = start;
      continue;
    }

    const ch = text[i];

    if (ch === '\n') {
      const part = text.slice(start, i).trim();
      if (part) sentences.push(part);
      start = i + 1;
      i++;
      continue;
    }

    if (ch === '…') {
      const part = text.slice(start, i + 1).trim();
      if (part) sentences.push(part);
      start = i + 1;
      i++;
      continue;
    }

    if (ch === '.' || ch === '!' || ch === '?') {
      let j = i + 1;
      while (j < len && (text[j] === '.' || text[j] === '!' || text[j] === '?')) j++;
      const next = j < len ? text[j] : '';
      const isBoundary = next === '' || /\s/.test(next);
      if (isBoundary) {
        const singlePeriod = ch === '.' && j - i === 1;
        if (next !== '') {
          if (singlePeriod && /[a-z]/.test(text[j + 1] ?? '')) {
            i = j;
            continue;
          }
          if (singlePeriod && isAbbreviation(text, start, i)) {
            i = j;
            continue;
          }
        }
        const part = text.slice(start, j).trim();
        if (part) sentences.push(part);
        start = j;
        i = j;
        continue;
      }
      i = j;
      continue;
    }

    i++;
  }

  const remainder = text.slice(start).trim();
  return { sentences, remainder };
}
