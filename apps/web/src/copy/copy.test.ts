import { describe, expect, it } from "vitest";
import { plainText } from "../components/Term";
import { fleschReadingEase, flattenStrings, longestSentenceWords } from "../lib/readability";
import * as account from "./home";
import { episode } from "./episode";
import { hood } from "./hood";
import { score } from "./score";

const blocks: Record<string, string[]> = {
  home: flattenStrings(account),
  episode: flattenStrings(episode),
  score: flattenStrings(score),
  hood: flattenStrings(hood),
};

describe("screen copy is plain language", () => {
  for (const [name, strings] of Object.entries(blocks)) {
    it(`${name}: reading ease averages 60 or more and no sentence has more than 25 words`, () => {
      const text = strings.map(plainText);
      const long = text.filter((t) => longestSentenceWords(t) > 25);
      expect(long).toEqual([]);
      const joined = text.map((t) => (/[.!?]$/.test(t) ? t : t + ".")).join(" ");
      expect(fleschReadingEase(joined)).toBeGreaterThanOrEqual(60);
    });
  }

  it("a jargon-heavy paragraph fails the same check (negative test)", () => {
    const jargon = "Calibrate your ex-ante probabilistic forecasts against subsequently realised frequencies using a proper scoring rule and a permutation-based significance assessment.";
    expect(fleschReadingEase(jargon)).toBeLessThan(60);
  });

  it("never promises profit or labels the learner", () => {
    const all = Object.values(blocks).flat().map(plainText).join(" ").toLowerCase();
    for (const bad of ["profitable", "guaranteed", " edge ", "unskilled", "you are skilled"]) expect(all).not.toContain(bad);
  });
});
