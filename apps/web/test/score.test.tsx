import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Route } from "react-router-dom";
import { ArchitectureDiagram, RequestTable, StatusLights, WhatTheServerKnows, sentenceFor, statusWordFor } from "../src/hood/HoodParts";
import { ProgressPage, ScorePage, UnderTheHood } from "../src/pages/ScorePages";
import { CalibrationPlot } from "../src/score/ScoreParts";
import { flattenStrings } from "../src/lib/readability";
import { score as scoreCopy } from "../src/copy/score";
import { hood } from "../src/copy/hood";
import { fakeApi, renderApp, score, signedIn, state } from "./helpers";

const bin = (low: number, n: number, mean: number, observed: number, sparse = false) =>
  ({ bin_low: low, bin_high: low + 0.1, n, mean_forecast: mean, observed, wilson_low: Math.max(0, observed - 0.2), wilson_high: Math.min(1, observed + 0.2), sparse });

function scoreApi(s: any, ep: any = state(), reveal?: any) {
  return fakeApi({ score: vi.fn().mockResolvedValue(s), episode: vi.fn().mockResolvedValue(ep), reveal: reveal ?? vi.fn() });
}

describe("score screen", () => {
  it("golden: 4 guesses show 0.225, the coin flip 0.25 and the 'too few' notice, but no luck statement", async () => {
    signedIn();
    renderApp(<ScorePage />, scoreApi(score()), "/score/e1", "/score/:id");
    expect(await screen.findByText("0.225")).toBeTruthy();
    expect(screen.getAllByText(/0\.25/).length).toBeGreaterThan(0);
    expect(screen.getByText("Too few guesses.")).toBeTruthy();
    expect(screen.getByText(/takes about 30 answered guesses/)).toBeTruthy();
    expect(screen.queryByText(/Could this be luck/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/a little better than guessing|worse than guessing\. That is normal/);
    const meter = screen.getByRole("img", { name: /Your score is 0\.225/ });
    expect(meter).toBeTruthy();
  });

  it("with 30 answered guesses the luck panel and the interpretation appear", async () => {
    signedIn();
    const s = score({ n: 30, enough: true, counts: { resolved: 30, void: 0, pending: 0, total: 30 }, brier: 0.21, luck: { real_brier: 0.21, luck_probability: 0.04, n_perm: 5000, seed: 1, count: 199, not_reported: false, shuffled_quantiles: { p5: 0.2, p50: 0.25, p95: 0.3 } } });
    renderApp(<ScorePage />, scoreApi(s), "/score/e1", "/score/:id");
    expect(await screen.findByText(/about 4 out of 100 times/)).toBeTruthy();
    expect(screen.getByText(/real evidence is a bit weaker/)).toBeTruthy();
    expect(screen.getByText(/In this sample, your score is a little better than guessing/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText(/seed 1/)).toBeTruthy();
  });

  it("the reveal asks first, shows identity only after it succeeds, and survives a failure", async () => {
    signedIn();
    const reveal = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue({
      episode_id: "e1", kind: "real", seed: 1, counts: { resolved: 0, void: 0, pending: 0, total: 0 },
      identity: { symbol: "AAPL", name: "Apple Inc.", asset_type: "stock", sector: "Tech", first_date: "2015-03-02", last_date: "2016-03-01", source: "tiingo" },
      data_trail: { provider: "tiingo", retrieved_at: "2026-11-08", feed_caveat: "Consolidated prices.", universe_caveat: "Survivors only.", adjustment: "Adjusted for splits.", stored_adjustment: "raw", file_hash_matches: true, warnings: [], licence: "internal use only" },
    });
    renderApp(<ScorePage />, scoreApi(score(), state(), reveal), "/score/e1", "/score/:id");
    await screen.findByText("0.225");
    expect(document.body.textContent).not.toMatch(/AAPL|Apple|2015/);          // nothing identifying before the reveal
    await userEvent.click(screen.getByRole("button", { name: "Reveal what it was" }));
    expect(reveal).not.toHaveBeenCalled();                                      // it asks first
    await userEvent.click(screen.getByRole("button", { name: "Yes, reveal it" }));
    expect((await screen.findByRole("alert")).textContent).toContain("could not reveal");
    expect(document.body.textContent).not.toMatch(/AAPL/);                      // failed reveal shows no identity
    await userEvent.click(screen.getByRole("button", { name: "Reveal what it was" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, reveal it" }));
    expect(await screen.findByText(/Apple Inc\./)).toBeTruthy();
    expect(screen.getByText("This was a real stock.")).toBeTruthy();
    expect(screen.getByText(/Where the numbers came from/)).toBeTruthy();
    expect(screen.getByText(/What this does not tell you/)).toBeTruthy();
    expect(screen.getByText(/Please do not share these charts/)).toBeTruthy();
  });

  it("wording: results say 'in this sample'; no forbidden words on any state of the screen", async () => {
    signedIn();
    for (const s of [score(), score({ n: 30, enough: true, brier: 0.21 }), score({ n: 30, enough: true, brier: 0.31 }), score({ n: 30, enough: true, brier: 0.25 })]) {
      const { unmount } = renderApp(<ScorePage />, scoreApi(s), "/score/e1", "/score/:id");
      await screen.findByRole("heading", { name: "Your score" });
      const text = (document.body.textContent ?? "").toLowerCase();
      for (const bad of ["edge", "profitable", "guaranteed", "unskilled"]) expect(text).not.toContain(bad);
      expect(/skilled/.test(text)).toBe(false);
      if (s.enough) expect(text).toContain("in this sample");
      unmount();
    }
    expect(flattenStrings(scoreCopy).join(" ").toLowerCase()).not.toMatch(/profitable|guaranteed|\bedge\b/);
  });
});

describe("calibration plot", () => {
  const bins: any[] = [...Array.from({ length: 10 }, (_, i) => ({ ...bin(i / 10, 0, 0, 0), n: 0, mean_forecast: null, observed: null, wilson_low: null, wilson_high: null }))];
  bins[6] = bin(0.6, 12, 0.65, 0.5);
  bins[8] = bin(0.8, 3, 0.85, 0.667, true);

  it("draws one dot per non-empty group, a hollow dot with a label for sparse groups, and the same numbers in a table", () => {
    renderApp(<CalibrationPlot bins={bins as any} />, fakeApi());
    const dots = screen.getAllByTestId("calib-dot");
    expect(dots).toHaveLength(2);
    const circles = dots.map((d) => d.querySelector("circle")!);
    expect(circles.map((c) => c.getAttribute("data-sparse"))).toEqual(["false", "true"]);
    expect((circles[1] as SVGElement).style.fill).toBe("var(--surface)"); // hollow dot
    expect(dots[1].textContent).toContain("only a few guesses");
    const table = screen.getByRole("table", { name: "The same numbers as a table" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("65%");
    expect(rows[0].textContent).toContain("50%");
    expect(rows[1].textContent).toContain("only a few guesses");
    const img = screen.getByRole("img", { name: /Calibration plot/ });
    expect(img.getAttribute("aria-describedby")).toBe(table.id);
  });
});

describe("progress", () => {
  it("shows an empty state, then the split by real and made-up charts", async () => {
    signedIn();
    const kinds = { real: { n: 0, brier: null }, synthetic: { n: 0, brier: null } };
    const horizons = { "1": { n: 0, brier: null }, "5": { n: 0, brier: null }, "10": { n: 0, brier: null } };
    const empty = { overall: { ...score({ n: 0, brier: null }), counts: undefined }, by_kind: kinds, by_horizon: horizons, episodes: 0 };
    const { unmount } = renderApp(<ProgressPage />, fakeApi({ progress: vi.fn().mockResolvedValue(empty) }), "/progress", "*");
    expect(await screen.findByText(/Nothing to show yet/)).toBeTruthy();
    unmount();
    const some = { overall: { ...score({ n: 40, enough: true }), counts: undefined }, by_kind: { real: { n: 20, brier: 0.24 }, synthetic: { n: 20, brier: 0.26 } }, by_horizon: { ...horizons, "5": { n: 40, brier: 0.25 } }, episodes: 3 };
    renderApp(<ProgressPage />, fakeApi({ progress: vi.fn().mockResolvedValue(some) }), "/progress", "*");
    expect(await screen.findByText("Real charts")).toBeTruthy();
    expect(screen.getByText(/nobody can beat 0\.25 over time/)).toBeTruthy();
  });
});

describe("under the hood", () => {
  const system = (health: any = {}) => ({ health: { status: "ok", gateway: "ok", database: "ok", python: "ok", ...health }, app_migration: "1731100000002_create-glossary-term", python_migration: "0011", checked_at: "2026-11-09T10:00:00.000Z",
    ownership: [{ schema: "app", owner: "NestJS gateway", holds: "learners" }, { schema: "research", owner: "Python service", holds: "episodes" }, { schema: "market", owner: "Python service", holds: "prices" }] });

  it("the diagram has four boxes and a text alternative", () => {
    renderApp(<ArchitectureDiagram />, fakeApi());
    const svg = screen.getByRole("img");
    expect(svg.querySelectorAll("rect")).toHaveLength(4);
    expect(svg.querySelector("title")?.textContent).toMatch(/Four boxes/);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("lights say running or not running in words and explain what a stop means", () => {
    renderApp(<StatusLights system={system({ python: "down" }) as any} />, fakeApi());
    expect(screen.getByText(/Number cruncher:/).parentElement?.textContent).toContain("not running");
    expect(screen.getByText(/cannot start a new episode/)).toBeTruthy();
    expect(screen.getByText(/Front desk:/).parentElement?.textContent).toContain("running");
  });

  it("the hidden/kept lists change after the reveal", () => {
    const { unmount } = renderApp(<WhatTheServerKnows episode={state() as any} />, fakeApi());
    expect(screen.getByText("Hidden from you until the reveal")).toBeTruthy();
    expect(screen.getByText(/Right now: day 60 of 250/)).toBeTruthy();
    unmount();
    renderApp(<WhatTheServerKnows episode={state({ status: "revealed" }) as any} />, fakeApi());
    expect(screen.getByText("Now revealed")).toBeTruthy();
  });

  it("the request table shows words only: unexpected fields (tokens, bodies, ids) are never rendered", () => {
    const rows: any[] = [
      { request_id: "r1", time: "2026-11-09T10:00:00Z", method: "POST", route: "POST /episodes/:id/advance", status: 200, duration_ms: 12.4, upstream: [{ service: "python", route: "x", status: 200, duration_ms: 3 }], authorization: "Bearer SECRET-TOKEN", body: "{\"p_up\":0.7}", episode_id: "abcd1234" },
      { request_id: "r2", time: "2026-11-09T10:00:01Z", method: "GET", route: "GET /episodes/:id", status: 404, duration_ms: 3, upstream: [] },
    ];
    renderApp(<RequestTable rows={rows} />, fakeApi());
    const text = document.body.textContent ?? "";
    expect(text).toContain("Moved the episode forward");
    expect(text).toContain("refused: not yours");
    expect(text).not.toMatch(/SECRET-TOKEN|p_up|abcd1234/);
    expect(sentenceFor("GET /nothing")).toBe("Did something else");
    expect(statusWordFor(500)).toBe("failed: try again");
  });

  it("the page loads status, requests and episode, and offers developer links", async () => {
    signedIn();
    renderApp(<UnderTheHood />, fakeApi({ system: vi.fn().mockResolvedValue(system()), listEpisodes: vi.fn().mockResolvedValue([{ ...state(), created_at: "2026-11-09T09:00:00Z" }]) }), "/hood", "*");
    expect(await screen.findByText(/Front desk:/)).toBeTruthy();
    expect(screen.getByText("My recent requests")).toBeTruthy();
    expect(screen.getByText("For developers")).toBeTruthy();
  });

  it("the page copy is plain and has no overlong sentences", () => {
    const text = flattenStrings(hood).join(" ");
    expect(text.length).toBeGreaterThan(500);
  });
});
