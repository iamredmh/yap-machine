import { advances } from './metrics';
import { TYPE, voiceAdjust, type VoiceName } from './style';

// Type laid out from letter metrics (scripts/font_metrics.py) rather than measured in the browser, so a layout is the
// same on every frame of a render. Advances are scaled by the voice's size rule, as its glyphs are.

const table = (v: VoiceName) => {
  const a = voiceAdjust(v);
  return Object.fromEntries(Object.entries(advances(TYPE[v].metrics)).map(([k, x]) => [k, x * a])) as Record<string, number>;
};
const TABLES: Partial<Record<VoiceName, Record<string, number>>> = {};
const tableOf = (v: VoiceName) => (TABLES[v] ??= table(v));
const avg = (t: Record<string, number>) => Object.values(t).reduce((a, b) => a + b, 0) / Object.values(t).length;
/** One character of running text: the mean of a to z and the space (what "characters per line" counts). */
const ch = (t: Record<string, number>) => {
  const s = 'abcdefghijklmnopqrstuvwxyz ';
  return [...s].reduce((a, c) => a + (t[c] ?? avg(t)), 0) / s.length;
};

/** Text as a voice shows it (the pack may force a case). */
export const shown = (text: string, v: VoiceName) => {
  const c = TYPE[v].case;
  return c === 'uppercase' ? text.toUpperCase() : c === 'lowercase' ? text.toLowerCase() : text;
};

export type WordLayout = { chars: string[]; xs: number[]; ws: number[]; width: number };

/** Lay a word out letter by letter in a voice, at `size`, with the scene's tracking (em) plus the pack's. */
export const layoutWord = (word: string, size: number, v: VoiceName = 'display', trackEm = 0): WordLayout => {
  const t = tableOf(v);
  const fallback = avg(t);
  const tr = (trackEm + TYPE[v].tracking) * size;
  const chars = [...shown(word, v)];
  const xs: number[] = [];
  const ws: number[] = [];
  let x = 0;
  chars.forEach((ch, i) => {
    const a = (t[ch] ?? fallback) * size;
    xs.push(x);
    ws.push(a);
    x += a + (i < chars.length - 1 ? tr : 0);
  });
  return { chars, xs, ws, width: x };
};

export const textWidth = (text: string, size: number, v: VoiceName, trackEm = 0) => layoutWord(text, size, v, trackEm).width;

/**
 * The size for display lines given a measure, by the pack's fit rule: 'width' fills the measure (every line of the
 * stack as wide as the widest allows); 'cap' keeps the scene's `size` times fitScale and only shrinks to fit.
 */
export const fitSize = (lines: string[], measure: number, size: number, trackEm = 0) => {
  const L = TYPE.display.layout;
  const widest = Math.max(...lines.map((l) => textWidth(l, 1, 'display', trackEm)));
  const room = (L.measure ?? 1) * measure;
  return L.fit === 'width' ? Math.min(size * 2, room / widest) : Math.min(size * L.fitScale, room / widest);
};

/** Break body text into lines for the pack's measure (characters per line), never wider than `width` px (the room it has). */
export const breakLines = (text: string, size: number, width: number, v: VoiceName = 'body') => {
  const chars = TYPE[v].layout.measure;
  const max = chars ? Math.min(width, chars * ch(tableOf(v)) * size) : width;
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size, v) > max) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
};

