/** Flesch reading ease (higher = easier; 60 or more is plain English). A rough syllable counter is enough for a gate. */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/e$/, "").replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

export function words(text: string): string[] {
  return text.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
}

export function fleschReadingEase(text: string): number {
  const w = words(text);
  const s = Math.max(1, sentences(text).length);
  if (w.length === 0) return 100;
  const syl = w.reduce((n, x) => n + countSyllables(x), 0);
  return 206.835 - 1.015 * (w.length / s) - 84.6 * (syl / w.length);
}

export function longestSentenceWords(text: string): number {
  return Math.max(0, ...sentences(text).map((s) => words(s).length));
}
