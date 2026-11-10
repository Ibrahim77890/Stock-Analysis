import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import { decision, indicators, journal } from "../src/copy/journal";
import { IndicatorTable, IndicatorToggles, useIndicators } from "../src/episode/Indicators";
import type { IndicatorName } from "../src/episode/Indicators";
import { DecisionCard } from "../src/journal/DecisionCard";
import { countLine, JournalPage, resultWords } from "../src/journal/JournalPage";
import { fakeApi, renderApp, signedIn } from "./helpers";
import { useState } from "react";

vi.mock("lightweight-charts", () => ({
  LineSeries: "line", LineStyle: { Dashed: 2 }, CandlestickSeries: "candles", HistogramSeries: "hist",
  createChart: () => ({
    addSeries: () => ({ setData: () => undefined, createPriceLine: () => undefined }),
    priceScale: () => ({ applyOptions: () => undefined }), timeScale: () => ({ fitContent: () => undefined }), remove: () => undefined,
  }),
}));

const values = (from: number, to: number, f = (d: number) => 100 + d) => Array.from({ length: to - from + 1 }, (_, i) => ({ day: from + i, value: f(from + i) }));
const saved = (over: object = {}) => ({ decision_id: 1, day: 60, stance: "long", reason: "x", cost_bps: 2, days_marked: 0, status: "pending", result: null, created: true, ...over });

describe("decision card", () => {
  it("sends the stance, the trimmed reason and a key; a double click sends one request; then clears the field", async () => {
    signedIn();
    let resolve!: (v: any) => void;
    const onSend = vi.fn().mockImplementation(() => new Promise((r) => { resolve = r; }));
    renderApp(<DecisionCard day={60} onSend={onSend} />, fakeApi());
    await userEvent.click(screen.getByRole("radio", { name: decision.long }));
    await userEvent.type(screen.getByLabelText(decision.reasonLabel), "  Above its average.  ");
    await userEvent.dblClick(screen.getByRole("button", { name: decision.record }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toMatchObject({ stance: "long", reason: "Above its average." });
    expect(String(onSend.mock.calls[0][0].client_key).length).toBeGreaterThanOrEqual(8);
    resolve(saved());
    expect(await screen.findByText(decision.saved(60))).toBeTruthy();
    expect((screen.getByLabelText(decision.reasonLabel) as HTMLTextAreaElement).value).toBe("");
  });

  it("asks for a reason first and sends nothing; the counter is shown", async () => {
    signedIn();
    const onSend = vi.fn();
    renderApp(<DecisionCard day={60} onSend={onSend} />, fakeApi());
    expect(screen.getByText(decision.reasonCounter(0))).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: decision.record }));
    expect(screen.getByText(decision.needReason)).toBeTruthy();
    expect(onSend).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(decision.reasonLabel), "abc");
    expect(screen.getByText(decision.reasonCounter(3))).toBeTruthy();
    expect((screen.getByLabelText(decision.reasonLabel) as HTMLTextAreaElement).maxLength).toBe(280);
  });

  it("plain messages for 422 (server sentence), 429 and a network error; the words are kept and a retry reuses the key", async () => {
    signedIn();
    const onSend = vi.fn()
      .mockRejectedValueOnce(new ApiError(422, "You already recorded a decision for this day. Move on a day first."))
      .mockRejectedValueOnce(new ApiError(0, "MarketLab cannot reach its server. Is it running?"))
      .mockResolvedValueOnce(saved());
    renderApp(<DecisionCard day={60} onSend={onSend} />, fakeApi());
    await userEvent.type(screen.getByLabelText(decision.reasonLabel), "My reason");
    await userEvent.click(screen.getByRole("button", { name: decision.record }));
    expect(await screen.findByText(/already recorded a decision/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: decision.record }));
    expect(await screen.findByText(decision.errors[0])).toBeTruthy();
    expect((screen.getByLabelText(decision.reasonLabel) as HTMLTextAreaElement).value).toBe("My reason");
    await userEvent.click(screen.getByRole("button", { name: decision.record }));
    expect(await screen.findByText(decision.saved(60))).toBeTruthy();
    const keys = onSend.mock.calls.map((c) => c[0].client_key);
    expect(new Set(keys).size).toBe(1); // the same key until saved
  });

  it("works from the keyboard and is replaced by a note when the episode is revealed", async () => {
    signedIn();
    const onSend = vi.fn().mockResolvedValue(saved({ stance: "flat" }));
    const { unmount } = renderApp(<DecisionCard day={60} onSend={onSend} />, fakeApi());
    const user = userEvent.setup();
    await user.tab(); // first radio
    await user.tab(); // second radio group member is skipped by the browser; the textarea or the next stop
    screen.getByLabelText(decision.reasonLabel).focus();
    await user.keyboard("Waiting for more days");
    await user.tab();
    expect(document.activeElement?.textContent).toBe(decision.record);
    await user.keyboard("{Enter}");
    expect(await screen.findByText(decision.saved(60))).toBeTruthy();
    unmount();
    renderApp(<DecisionCard day={60} disabled onSend={onSend} />, fakeApi());
    expect(screen.getByText(decision.revealedNote)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

function Harness({ api }: { api: any }) {
  const [active, setActive] = useState<Set<IndicatorName>>(new Set());
  const { series } = useIndicators(api, "e1", 60, active);
  return (
    <>
      <IndicatorToggles active={active} onToggle={(n) => setActive((c) => { const x = new Set(c); x.has(n) ? x.delete(n) : x.add(n); return x; })} />
      <IndicatorTable series={series} active={active} />
    </>
  );
}

describe("indicators", () => {
  it("toggles are named, expose their pressed state, and ask for the indicator once per toggle", async () => {
    signedIn();
    const api = fakeApi({ indicators: vi.fn().mockImplementation(async (_id: string, name: string) => ({ episode_id: "e1", name, window: 20, day: 60, values: values(20, 60) })) });
    renderApp(<Harness api={api} />, api);
    const sma = screen.getByRole("button", { name: indicators.toggles.sma });
    expect(sma.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(sma);
    expect(sma.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect((api as any).indicators).toHaveBeenCalledTimes(1));
    expect((api as any).indicators).toHaveBeenCalledWith("e1", "sma", 20);
    await userEvent.click(screen.getByRole("button", { name: indicators.toggles.rsi }));
    await waitFor(() => expect((api as any).indicators).toHaveBeenCalledWith("e1", "rsi", 14));
    expect(screen.getByText(indicators.explain.sma)).toBeTruthy();
    expect(screen.getByText(indicators.notForecast)).toBeTruthy();
    await userEvent.click(sma);
    expect(sma.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText(indicators.explain.sma)).toBeNull();
  });

  it("the text table equals the values from the server (last 10) and nothing beyond the revealed day appears", async () => {
    signedIn();
    const api = fakeApi({ indicators: vi.fn().mockResolvedValue({ episode_id: "e1", name: "sma", window: 20, day: 60, values: values(20, 60, (d) => d * 1.5) }) });
    renderApp(<Harness api={api} />, api);
    await userEvent.click(screen.getByRole("button", { name: indicators.toggles.sma }));
    await userEvent.click(await screen.findByText(indicators.showNumbers));
    const table = await screen.findByRole("table", { name: new RegExp(indicators.toggles.sma) });
    const rows = within(table).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual(["51", "76.5"]);
    expect(rows[9]).toEqual(["60", "90.0"]);
    expect(Math.max(...rows.map((r) => Number(r[0])))).toBeLessThanOrEqual(60);
  });

  it("it reloads when the episode moves on a day, with exactly the new day added", async () => {
    signedIn();
    const fn = vi.fn().mockImplementation(async () => ({ episode_id: "e1", name: "sma", window: 20, day: 60, values: values(20, 60) }));
    const api = fakeApi({ indicators: fn });
    function Moving() {
      const [day, setDay] = useState(60);
      const { series } = useIndicators(api, "e1", day, new Set<IndicatorName>(["sma"]));
      return <><button onClick={() => setDay(61)}>next</button><span data-testid="n">{series.sma?.length ?? 0}</span></>;
    }
    renderApp(<Moving />, api);
    await waitFor(() => expect(screen.getByTestId("n").textContent).toBe("41"));
    fn.mockImplementation(async () => ({ episode_id: "e1", name: "sma", window: 20, day: 61, values: values(20, 61) }));
    await userEvent.click(screen.getByText("next"));
    await waitFor(() => expect(screen.getByTestId("n").textContent).toBe("42"));
  });

  it("an indicator error shows a plain message and the toggles stay usable", async () => {
    signedIn();
    const api = fakeApi({ indicators: vi.fn().mockRejectedValue(new ApiError(0, "MarketLab cannot reach its server. Is it running?")) });
    function WithError() {
      const [active, setActive] = useState<Set<IndicatorName>>(new Set());
      const { error } = useIndicators(api, "e1", 60, active);
      return <><IndicatorToggles active={active} onToggle={() => setActive(new Set<IndicatorName>(["sma"]))} />{error && <p role="alert">{error}</p>}</>;
    }
    renderApp(<WithError />, api);
    await userEvent.click(screen.getByRole("button", { name: indicators.toggles.sma }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/cannot reach/);
    expect((screen.getByRole("button", { name: indicators.toggles.rsi }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("journal page", () => {
  const ep = (id: string, status: string, over: object = {}) => ({ episode_id: id, n_bars: 250, initial_visible: 60, day: 70, status, kind_requested: "mixed", created_at: "2026-01-01T00:00:00Z", ...over });
  const jr = (id: string, decisions: any[]) => ({ episode_id: id, day: 70, decisions, totals: { decisions: decisions.length, marked: decisions.filter((d) => d.status === "marked").length, pending: 0, growth: null, note: "n" } });
  const dec = (over: object = {}) => ({ decision_id: 1, day: 60, stance: "long", reason: "Above its average.", cost_bps: 2, days_marked: 3, status: "marked", result: 0.0123, ...over });

  it("lists decisions with the reason, the result in words and a count line; no win rate", async () => {
    signedIn();
    const api = fakeApi({
      listEpisodes: vi.fn().mockResolvedValue([ep("a", "open"), ep("b", "open")]),
      journal: vi.fn().mockImplementation(async (id: string) => (id === "a" ? jr("a", [dec(), dec({ decision_id: 2, day: 65, stance: "flat", result: null, status: "pending", days_marked: 0 })]) : jr("b", []))),
    });
    renderApp(<JournalPage />, api, "/journal");
    expect((await screen.findAllByText("Above its average.")).length).toBe(2);
    expect(screen.getByText("+1.2% after costs")).toBeTruthy();
    expect(screen.getByText(journal.waiting)).toBeTruthy();
    expect(screen.getByText(journal.count(2))).toBeTruthy();
    expect(screen.queryByText(journal.reviewTitle)).toBeNull(); // review prompts only after the reveal
    expect(document.body.textContent).not.toMatch(/win rate|\b(score|rank|points|level)\b|you should|well done|you lost/i);
    expect(screen.getAllByRole("table")).toHaveLength(1); // the episode without decisions is not listed
  });

  it("shows the look-back prompts only for a revealed episode, and an empty state otherwise", async () => {
    signedIn();
    const api = fakeApi({ listEpisodes: vi.fn().mockResolvedValue([ep("a", "revealed")]), journal: vi.fn().mockResolvedValue(jr("a", [dec()])) });
    const { unmount } = renderApp(<JournalPage />, api, "/journal");
    expect(await screen.findByText(journal.reviewTitle)).toBeTruthy();
    for (const p of journal.prompts) expect(screen.getByText(p)).toBeTruthy();
    unmount();
    renderApp(<JournalPage />, fakeApi({ listEpisodes: vi.fn().mockResolvedValue([]) }), "/journal");
    expect(await screen.findByText(journal.none)).toBeTruthy();
  });

  it("the counts shown equal the numbers from the server (reconciliation) and result words are right", () => {
    expect(countLine(1)).toBe(journal.count(1));
    expect(countLine(12)).toBe(journal.count(12));
    expect(countLine(30)).toBe(journal.manyCount(30));
    expect(resultWords(null)).toBe(journal.waiting);
    expect(resultWords(-0.0081)).toBe("-0.8% after costs");
    expect(resultWords(0)).toBe("+0.0% after costs");
  });

  it("a failed load shows a plain message", async () => {
    signedIn();
    renderApp(<JournalPage />, fakeApi({ listEpisodes: vi.fn().mockRejectedValue(new ApiError(0, "MarketLab cannot reach its server. Is it running?")) }), "/journal");
    expect((await screen.findByRole("alert")).textContent).toMatch(/cannot reach/);
  });

  it("no hard-coded colours in the new screens", () => {
    for (const f of ["src/journal/DecisionCard.tsx", "src/journal/JournalPage.tsx", "src/episode/Indicators.tsx"]) {
      expect(fs.readFileSync(path.resolve(__dirname, "..", f), "utf8"), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    }
  });
});

describe("wording", () => {
  it("indicator and decision copy never says buy, sell, signal or a forecast promise", () => {
    const text = JSON.stringify({ indicators, decision, journal }).toLowerCase();
    expect(text).not.toMatch(/\b(buy|sell|signal|signals|will rise|will fall|guarantee)\b/);
    expect(text).toContain("is a forecast");   // "None of these numbers is a forecast."
    expect(text).toContain("does not tell you what comes next");
  });
});
