import { screen, within } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import { status as copy } from "../src/copy/status";
import { DataCards, HealthCard, StatusPage } from "../src/status/StatusPage";
import { fakeApi, renderApp, signedIn } from "./helpers";
import { render } from "@testing-library/react";

const data = (over: object = {}): any => ({
  sources: [{ source: "tiingo", symbols: 52, symbols_with_long_history: 50, bars: 271337, first_date: "2005-01-03", last_date: "2025-12-31", retrieved_at: "2026-11-05T10:00:00Z" }],
  min_sessions_for_long_history: 3000, quality: { run: true, rules_flagged: 2, errors: 0, warnings: 2, infos: 1 },
  macro: { series: 2, observations: 13566, first_date: "2000-01-03", last_date: "2025-12-31" },
  caveats: ["Only symbols that exist today are included. This is survivorship bias.", "Each source is one free vendor feed.", "The price data are licensed for private learning.", "Everything here is for learning."], empty: false, ...over,
});

describe("data status page", () => {
  it("shows the sources table, coverage, freshness, checks and every caveat, and the numbers equal the data", async () => {
    signedIn();
    const api = fakeApi({ dataStatus: vi.fn().mockResolvedValue(data()), health: vi.fn().mockResolvedValue({ status: "ok", gateway: "ok", database: "ok", python: "ok" }) });
    renderApp(<StatusPage />, api, "/status");
    const table = await screen.findByRole("table", { name: copy.table });
    const cells = within(within(table).getAllByRole("row")[1]).getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toEqual(["Prices from tiingo", "52", "271,337", "2005-01-03", "2025-12-31", "2026-11-05"]);
    expect(screen.getByText((_, el) => el?.tagName === "LI" && el.textContent === `tiingo: ${copy.longHistory(50, 3000)}`)).toBeTruthy();
    expect(screen.getByText(copy.freshLine("2025-12-31"))).toBeTruthy();
    expect(screen.getByText(copy.checksLine(2, 2, 0))).toBeTruthy();
    expect(screen.getByText(copy.checksFew)).toBeTruthy();
    expect(screen.getAllByRole("listitem").filter((li) => /survivorship|vendor feed|private learning|for learning/.test(li.textContent ?? "")).length).toBeGreaterThanOrEqual(4);
    expect(await screen.findByText(copy.healthOk)).toBeTruthy();
  });

  it("an empty fixture still shows the caveats and a plain empty message (negative)", () => {
    signedIn();
    render(<DataCards data={data({ sources: [], empty: true, quality: { run: false, rules_flagged: 0, errors: 0, warnings: 0, infos: 0 } })} />);
    expect(screen.getByText(copy.empty)).toBeTruthy();
    expect(screen.getByText(copy.checksNone)).toBeTruthy();
    expect(screen.getByText(copy.cannotTitle)).toBeTruthy();
    expect(screen.getByText(/survivorship bias/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says how many checks ran and never shows a green tick for the data", () => {
    render(<DataCards data={data({ quality: { run: true, rules_flagged: 1, errors: 1, warnings: 0, infos: 0 } })} />);
    expect(screen.getByText(copy.checksLine(1, 0, 1))).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/all checks passed|data are clean|verified|guarantee/i);
  });

  it("health: a part that is down is named in words and with a warning, not by colour alone", () => {
    render(<HealthCard health={{ status: "ok", gateway: "ok", database: "ok", python: "down" } as any} />);
    expect(screen.getByText(/Something is not answering/).textContent).toContain("Number service");
    expect(screen.getByText(copy.down)).toBeTruthy();
    expect(screen.getAllByText(copy.ok)).toHaveLength(2);
  });

  it("an error from the server shows a plain message and the page stays usable", async () => {
    signedIn();
    renderApp(<StatusPage />, fakeApi({ dataStatus: vi.fn().mockRejectedValue(new ApiError(0, "MarketLab cannot reach its server. Is it running?")), health: vi.fn().mockRejectedValue(new Error("x")) }), "/status");
    expect((await screen.findByRole("alert")).textContent).toMatch(/cannot reach/);
    expect(screen.getByRole("heading", { name: copy.title })).toBeTruthy();
  });

  it("no hard-coded colours in the status screen, and the copy has no operator or secret words", () => {
    expect(fs.readFileSync(path.resolve(__dirname, "../src/status/StatusPage.tsx"), "utf8")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    expect(JSON.stringify(copy).toLowerCase()).not.toMatch(/operator|token|api key|password/);
  });
});
