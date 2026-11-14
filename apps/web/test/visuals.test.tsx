import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import { lessons } from "../src/copy/lessons";
import { LessonPage } from "../src/lessons/LessonPage";
import { PathPage } from "../src/lessons/PathPage";
import { afterCosts, brier, dayChange, expectedMisses, manyPaths, rsiFrom, shareUp, sma } from "../src/lessons/visuals/math";
import { Visual, VISUALS } from "../src/lessons/visuals/Visuals";
import { fakeApi, renderApp, signedIn } from "./helpers";
import { lessonDetail, PATH, summary } from "./lessonFixtures";

const IDS = ["candle-anatomy", "candle-row", "volume-bars", "expected-misses", "brier-formula", "brier-curve", "calibration-plot", "many-paths", "cost-drag", "sma-diagram", "rsi-formula"];

describe("the calculations behind the diagrams (checked by hand)", () => {
  it("candle change, expected misses and shares", () => {
    expect(dayChange(100, 104)).toBeCloseTo(0.04, 12);
    expect(dayChange(100, 96)).toBeCloseTo(-0.04, 12);
    expect(expectedMisses(10, 0.7)).toBe(3);
    expect(expectedMisses(20, 0.9)).toBe(2);
    expect(shareUp(5, 10)).toBe(0.5);
  });
  it("Brier score: 0.09, 0.81, 0.25 for a coin flip either way, 0 for a sure and right guess", () => {
    expect(brier(0.7, 1)).toBe(0.09);
    expect(brier(0.9, 0)).toBe(0.81);
    expect(brier(0.5, 1)).toBe(0.25);
    expect(brier(0.5, 0)).toBe(0.25);
    expect(brier(1, 1)).toBe(0);
  });
  it("costs: 100 after 100 trades at 2 and at 10 basis points", () => {
    expect(afterCosts(2, 100)).toBeCloseTo(98.0198, 3);
    expect(afterCosts(10, 100)).toBeCloseTo(90.4792, 3);
    expect(afterCosts(0, 500)).toBe(100);
    expect(afterCosts(2, 200)).toBeCloseTo(96.08, 2);
    expect(afterCosts(10, 200)).toBeCloseTo(81.86, 2);
  });
  it("moving average of 3 days, and no value before day 3", () => {
    const v = sma([10, 11, 12, 11, 13], 3);
    expect(v[0]).toBeNull(); expect(v[1]).toBeNull();
    expect(v[2]).toBeCloseTo(11, 12);
    expect(v[4]).toBeCloseTo(12, 12);
  });
  it("RSI: 75 for gain 1.2 and loss 0.4, 100 with no losses, 50 when nothing moved or rises equal falls", () => {
    expect(rsiFrom(1.2, 0.4)).toBeCloseTo(75, 12);
    expect(rsiFrom(1, 0)).toBe(100);
    expect(rsiFrom(0, 0)).toBe(50);
    expect(rsiFrom(0.5, 0.5)).toBe(50);
  });
  it("the many-paths picture is repeatable and its best line really is the best on the first part", () => {
    const a = manyPaths(3), b = manyPaths(3);
    expect(a).toEqual(b);
    expect(manyPaths(4)).not.toEqual(a);
    for (let l = 0; l < a.lines.length; l++) expect(a.lines[a.best][a.split]).toBeGreaterThanOrEqual(a.lines[l][a.split]);
  });
});

describe("the diagrams", () => {
  it("there is a diagram for each of the eleven ids, and every one draws a labelled picture or a table and a sentence to look at", () => {
    expect(Object.keys(VISUALS).sort()).toEqual([...IDS].sort());
    for (const id of IDS) {
      const { container, unmount } = render(<Visual id={id} />);
      const fig = container.querySelector("figure.visual");
      expect(fig, id).toBeTruthy();
      expect(fig!.getAttribute("aria-labelledby"), id).toBeTruthy();
      const svg = container.querySelector("svg[role=img]");
      const table = container.querySelector("table");
      expect(svg || table, id).toBeTruthy();
      if (svg) expect((svg.getAttribute("aria-label") ?? "").length, id).toBeGreaterThan(20);
      expect(container.querySelector(".visual-look")?.textContent?.length, id).toBeGreaterThan(20);
      unmount();
    }
  });

  it("the text on the page equals the numbers computed", () => {
    const text = (id: string) => { const { container, unmount } = render(<Visual id={id} />); const t = container.textContent ?? ""; unmount(); return t; };
    expect(text("candle-anatomy")).toContain("(104 − 100) ÷ 100 = 4%");
    expect(text("expected-misses")).toContain("10 × (1 − 0.70) = 3");
    expect(text("brier-formula")).toMatch(/\(0\.7 − 1\)² = 0\.09/);
    expect(text("brier-formula")).toMatch(/\(0\.9 − 0\)² = 0\.81/);
    expect(text("brier-curve")).toContain("0.25 coin-flip line");
    expect(text("calibration-plot")).toContain("5 ÷ 10 = 50%");
    expect(text("cost-drag")).toContain("98.02");
    expect(text("cost-drag")).toContain("90.48");
    expect(text("sma-diagram")).toContain("(12 + 11 + 13) ÷ 3 = 12.0");
    expect(text("rsi-formula")).toContain("RSI = 100 − 100 ÷ 4 = 75");
    const paths = manyPaths(3);
    expect(text("many-paths")).toContain(`${paths.firstPct >= 0 ? "+" : ""}${paths.firstPct.toFixed(1)}% on the first part`);
  });

  it("an unknown id renders a plain note and nothing else", () => {
    render(<Visual id="pie-chart" />);
    expect(screen.getByRole("note").textContent).toBe("This picture is not available.");
    expect(document.querySelector("svg")).toBeNull();
  });

  it("the diagrams call no server and hold no colour values", () => {
    for (const f of ["Visuals.tsx", "math.ts"]) {
      const src = fs.readFileSync(path.resolve(__dirname, "../src/lessons/visuals", f), "utf8");
      expect(src, f).not.toMatch(/api\/client|useAuth|fetch\(/);
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    }
  });

  it("a lesson step shows its diagram, and the lesson files point only at known ids", async () => {
    signedIn();
    const detail = lessonDetail();
    detail.steps[0] = { ...detail.steps[0], visual: "candle-anatomy" };
    renderApp(<LessonPage />, fakeApi({ lesson: vi.fn().mockResolvedValue(detail), lessonRead: vi.fn().mockResolvedValue({ lesson_slug: "x", step: 1, steps_read: 1, steps_total: 3 }) }), "/path/what-a-guess-means", "/path/:slug");
    expect(await screen.findByRole("img", { name: /Two candles/ })).toBeTruthy();
    expect(screen.getByText(/Change = \(close − open\) ÷ open/)).toBeTruthy();
    const dir = path.resolve(__dirname, "../../api/seed/lessons");
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json") && x !== "lesson.schema.json")) {
      const l = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      expect(l.steps.some((s: any) => s.visual), `${f} has a visual`).toBe(true);
      for (const s of l.steps) if (s.visual) expect(IDS).toContain(s.visual);
    }
  });
});

describe("mark as complete", () => {
  const readOk = vi.fn().mockResolvedValue({ lesson_slug: "x", step: 1, steps_read: 1, steps_total: 3 });
  const open = (api: any) => renderApp(<LessonPage />, api, "/path/what-a-guess-means", "/path/:slug");

  it("marks a lesson complete once even on a double click, shows it, and can take the mark back", async () => {
    signedIn();
    let resolve!: (v: any) => void;
    const lessonComplete = vi.fn().mockImplementation(() => new Promise((r) => { resolve = r; }));
    const lessonIncomplete = vi.fn().mockResolvedValue({ lesson_slug: "what-a-guess-means", completed_manually: false, done: false });
    open(fakeApi({ lesson: vi.fn().mockResolvedValue(lessonDetail()), lessonRead: readOk, lessonComplete, lessonIncomplete }));
    expect(await screen.findByText(lessons.manualNote)).toBeTruthy();
    await userEvent.dblClick(screen.getByRole("button", { name: lessons.markComplete }));
    expect(lessonComplete).toHaveBeenCalledTimes(1);
    resolve({ lesson_slug: "what-a-guess-means", completed_manually: true, done: true });
    expect(await screen.findByText(lessons.markedByYou)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: lessons.markNotComplete }));
    expect(lessonIncomplete).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(lessons.manualNote)).toBeTruthy();
    expect(screen.getByRole("button", { name: lessons.markComplete })).toBeTruthy();
  });

  it("starts in the marked state when the server says so, and has no button when the lesson's setting turns it off (negative)", async () => {
    signedIn();
    const { unmount } = open(fakeApi({ lesson: vi.fn().mockResolvedValue(lessonDetail({ completed_manually: true, done: true })), lessonRead: readOk }));
    expect(await screen.findByRole("button", { name: lessons.markNotComplete })).toBeTruthy();
    unmount();
    open(fakeApi({ lesson: vi.fn().mockResolvedValue(lessonDetail({ manual_complete_allowed: false })), lessonRead: readOk }));
    await screen.findByText("Step 1 of 3");
    expect(screen.queryByRole("button", { name: lessons.markComplete })).toBeNull();
    expect(screen.queryByText(lessons.manualNote)).toBeNull();
  });

  it("a failed save shows a plain message and keeps the button usable", async () => {
    signedIn();
    const lessonComplete = vi.fn().mockRejectedValue(new ApiError(0, "MarketLab cannot reach its server. Is it running?"));
    open(fakeApi({ lesson: vi.fn().mockResolvedValue(lessonDetail()), lessonRead: readOk, lessonComplete }));
    await userEvent.click(await screen.findByRole("button", { name: lessons.markComplete }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/cannot reach/);
    await waitFor(() => expect((screen.getByRole("button", { name: lessons.markComplete }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("the path shows a lesson marked complete as Done, with the note that you marked it", async () => {
    signedIn();
    const list = [...PATH];
    list[2] = summary({ slug: "brier-score", position: 3, title: "The Brier score", done: true, completed_manually: true });
    renderApp(<PathPage />, fakeApi({ lessons: vi.fn().mockResolvedValue(list) }), "/path");
    const card = (await screen.findByRole("heading", { name: "The Brier score" })).closest("li")!;
    expect(card.textContent).toContain("Done");
    expect(card.textContent).toContain(lessons.markedByYou);
  });
});
