/** Flesch reading ease (60 or more is plain English). Same rough rules as the gateway's glossary check. */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/e$/, "").replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export const sentences = (t: string): string[] => t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
export const words = (t: string): string[] => t.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];

export function fleschReadingEase(text: string): number {
  const w = words(text);
  if (w.length === 0) return 100;
  const s = Math.max(1, sentences(text).length);
  const syl = w.reduce((n, x) => n + countSyllables(x), 0);
  return 206.835 - 1.015 * (w.length / s) - 84.6 * (syl / w.length);
}

export const longestSentenceWords = (t: string): number => Math.max(0, ...sentences(t).map((s) => words(s).length));

/** All strings inside a (nested) copy object. */
export function flattenStrings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(flattenStrings);
  if (v && typeof v === "object") return Object.values(v).flatMap(flattenStrings);
  return [];
}
