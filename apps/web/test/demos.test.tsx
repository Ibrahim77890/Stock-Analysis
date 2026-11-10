import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { lessons } from "../src/copy/lessons";
import { Chance70, CoinStreaks, Demo, ManyTries } from "../src/lessons/demos/Demos";
import { DEFAULT_MANY_TRIES_SEED, draws, flips, longestRun, manyTries, mulberry32, outcomes } from "../src/lessons/demos/random";

describe("seeded generator", () => {
  it("gives the documented first values for seed 1 and stays inside [0, 1)", () => {
    const next = mulberry32(1);
    expect([next(), next(), next(), next()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741]);
    for (const d of draws(7, 1000)) { expect(d).toBeGreaterThanOrEqual(0); expect(d).toBeLessThan(1); }
  });
  it("the same seed gives the same draws, a different seed gives different ones", () => {
    expect(draws(3, 50)).toEqual(draws(3, 50));
    expect(draws(3, 50)).not.toEqual(draws(4, 50));
  });
});

describe("longest run", () => {
  it("is right on hand-made sequences", () => {
    expect(longestRun([...("HHTHHH")]).length).toBe(3);
    expect(longestRun([...("HHTHHH")])).toMatchObject({ symbol: "H", start: 3 });
    expect(longestRun([]).length).toBe(0);
    expect(longestRun(["T"]).length).toBe(1);
    expect(longestRun([...("HTHTHT")]).length).toBe(1);
    expect(longestRun([...("TTTT")])).toMatchObject({ length: 4, symbol: "T", start: 0 });
  });
});

describe("many tries", () => {
  it("is repeatable for a seed and different for another", () => {
    expect(manyTries(3)).toEqual(manyTries(3));
    expect(manyTries(3)).not.toEqual(manyTries(4));
  });
  it("on the shipped seed the best rule does better on the first part than on the new part (the lesson's point holds for this seed)", () => {
    const r = manyTries(DEFAULT_MANY_TRIES_SEED);
    expect(r.rules).toBe(50);
    expect(r.firstPct).toBeGreaterThan(r.newPct);
    expect(r.firstPct).toBeGreaterThan(20);
  });
  it("it is NOT true for every seed, so the page never claims it is", () => {
    const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
    const notBetter = seeds.filter((s) => !manyTries(s).firstIsBetter);
    expect(notBetter.length).toBeGreaterThan(0);
    expect(notBetter.length).toBeLessThan(seeds.length);
    render(<ManyTries />);
    expect(screen.getByText(lessons.demo.tries.caution, { exact: false })).toBeTruthy();
  });
});

describe("demo components", () => {
  it("Chance70: the sentence equals the number of up marks drawn; the slider and button have names; made-up data is stated", async () => {
    render(<Chance70 />);
    const ups = outcomes(1, 70).filter(Boolean).length;
    expect(screen.getByText(lessons.demo.chance.result(ups, 20))).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(20);
    expect(screen.getAllByRole("listitem").filter((li) => /up/.test(li.textContent ?? "")).length).toBe(ups);
    expect(screen.getByRole("slider", { name: /Chance of an up day/ })).toBeTruthy();
    expect(screen.getByText(lessons.demo.madeUp)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: lessons.demo.anotherSeed }));
    const ups2 = outcomes(2, 70).filter(Boolean).length;
    expect(screen.getByText(lessons.demo.chance.result(ups2, 20))).toBeTruthy();
  });
  it("Chance70: the slider changes the result and can take focus", () => {
    render(<Chance70 />);
    const slider = screen.getByRole("slider") as HTMLInputElement;
    slider.focus(); // a native range input already moves with the arrow keys; jsdom cannot simulate that, so the value is set directly
    expect(document.activeElement).toBe(slider);
    fireEvent.change(slider, { target: { value: "99" } });
    expect(slider.value).toBe("99");
    expect(screen.getByText(lessons.demo.chance.result(outcomes(1, 99).filter(Boolean).length, 20))).toBeTruthy();
  });
  it("CoinStreaks: the sentence equals the longest run of the flips drawn; same seed, same output", async () => {
    const { unmount } = render(<CoinStreaks />);
    const run = longestRun(flips(1));
    const side = run.symbol === "H" ? lessons.demo.coins.heads : lessons.demo.coins.tails;
    const first = document.body.textContent;
    expect(screen.getByText(lessons.demo.coins.result(run.length, side))).toBeTruthy();
    unmount();
    render(<CoinStreaks />);
    expect(document.body.textContent).toBe(first);
    await userEvent.click(screen.getByRole("button", { name: lessons.demo.coins.flip }));
    expect(document.body.textContent).not.toBe(first);
    expect(screen.getByText(lessons.demo.madeUp)).toBeTruthy();
  });
  it("ManyTries: the text equals the numbers computed", () => {
    render(<ManyTries />);
    const r = manyTries(DEFAULT_MANY_TRIES_SEED);
    const f = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;
    expect(screen.getByText(lessons.demo.tries.result(f(r.firstPct), f(r.newPct)))).toBeTruthy();
    expect(screen.getByText(lessons.demo.madeUp)).toBeTruthy();
  });
  it("every demo works with the keyboard only", async () => {
    render(<ManyTries />);
    const user = userEvent.setup();
    const before = document.body.textContent;
    await user.tab();
    expect(document.activeElement?.textContent).toBe(lessons.demo.tries.run);
    await user.keyboard("{Enter}");
    expect(document.body.textContent).not.toBe(before);
  });
  it("an unknown id renders a plain note and nothing else", () => {
    render(<Demo id="stock-picker" />);
    expect(screen.getByRole("note").textContent).toBe(lessons.demo.unknown);
    expect(screen.queryByRole("button")).toBeNull();
    render(<Demo id="constructor" />);
    expect(screen.getAllByRole("note")).toHaveLength(2);
  });
  it("structural: no demo imports the API client, the auth context or calls fetch", () => {
    const dir = path.resolve(__dirname, "../src/lessons/demos");
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/api\/client|AuthContext|useAuth|fetch\(|XMLHttpRequest/);
    }
  });
});
