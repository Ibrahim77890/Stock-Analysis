import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EpisodeScreen, Learn } from "../src/pages/Learn";
import { GuessForm, outOfTen } from "../src/episode/GuessForm";
import { GuessList, verdict } from "../src/episode/GuessList";
import { formatDay, toTime } from "../src/episode/EpisodeChart";
import { bar, bars, fakeApi, pred, renderApp, signedIn, state } from "./helpers";

// jsdom has no canvas: the chart library is replaced by a recorder
const chartCalls: Array<{ kind: string; data?: any }> = [];
vi.mock("lightweight-charts", () => ({
  CandlestickSeries: "candles", HistogramSeries: "hist",
  createChart: (_el: HTMLElement, opts: any) => {
    chartCalls.push({ kind: "create", data: opts });
    return {
      addSeries: (type: string) => ({ setData: (d: any) => chartCalls.push({ kind: type, data: d }) }),
      priceScale: () => ({ applyOptions: () => undefined }),
      timeScale: () => ({ fitContent: () => undefined }),
      remove: () => chartCalls.push({ kind: "remove" }),
    };
  },
}));

const IDENTITY = /\b(19|20)\d{2}-\d{2}-\d{2}\b|\b(200[5-9]|201\d|202[0-5])\b|\b[A-Z]{3,5}\b stock|symbol|start_date/;

function episodeApi(over: Record<string, any> = {}) {
  return fakeApi({
    episode: vi.fn().mockResolvedValue(state()), bars: vi.fn().mockResolvedValue({ episode_id: "e1", bars: bars(60) }),
    predictions: vi.fn().mockResolvedValue({ episode_id: "e1", predictions: [], counts: { resolved: 0, void: 0, pending: 0, total: 0 } }),
    advance: vi.fn().mockResolvedValue(state({ day: 61 })),
    ...over,
  });
}

describe("GuessForm", () => {
  it("shows what the percentage means in words", () => {
    expect(outOfTen(70)).toBe("7 out of 10");
    expect(outOfTen(55)).toBe("5.5 out of 10");
  });

  it("only accepts whole numbers from 1 to 99", async () => {
    renderApp(<GuessForm day={60} nBars={250} onSend={vi.fn()} />, fakeApi());
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    const send = screen.getByRole("button", { name: "Send my guess" }) as HTMLButtonElement;
    for (const bad of ["0", "100", "-5", "", "7.5", "abc"]) {
      fireEvent.change(input, { target: { value: bad } });
      expect(send.disabled, `value ${bad}`).toBe(true);
    }
    fireEvent.change(input, { target: { value: "70" } });
    expect(send.disabled).toBe(false);
    expect(screen.getByText(/7 out of 10/)).toBeTruthy();
  });

  it("sends once even on a double click", async () => {
    let release: (v: any) => void = () => undefined;
    const onSend = vi.fn().mockImplementation(() => new Promise((r) => (release = r)));
    renderApp(<GuessForm day={60} nBars={250} onSend={onSend} />, fakeApi());
    const send = screen.getByRole("button", { name: "Send my guess" });
    fireEvent.click(send); fireEvent.click(send); fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(1, 0.5);
    release({ ...pred(), created: true });
  });

  it("says when a guess was already recorded", async () => {
    const onSend = vi.fn().mockResolvedValue({ ...pred(), created: false });
    renderApp(<GuessForm day={60} nBars={250} onSend={onSend} />, fakeApi());
    await userEvent.click(screen.getByRole("button", { name: "Send my guess" }));
    expect((await screen.findByRole("status")).textContent).toContain("You already sent this guess");
  });

  it("disables distances that would look past the end, with the reason", () => {
    renderApp(<GuessForm day={246} nBars={250} onSend={vi.fn()} />, fakeApi());
    expect((screen.getByRole("radio", { name: /In 5 days/ }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("radio", { name: /In 10 days/ }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("radio", { name: /Next day/ }) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getAllByText(/past the end of the episode/).length).toBe(2);
  });
});

describe("GuessList", () => {
  it("uses words and arrows, not only colour, for answered guesses", () => {
    renderApp(<GuessList items={[pred({ status: "resolved", outcome: 1, p_up: 0.7 }), pred({ prediction_id: 2, status: "resolved", outcome: 1, p_up: 0.3 }), pred({ prediction_id: 3 })]} />, fakeApi());
    expect(screen.getAllByText(/▲ The price went up/)).toHaveLength(2);
    expect(screen.getByText(/You were right/)).toBeTruthy();
    expect(screen.getByText(/You were off/)).toBeTruthy();
    expect(screen.getByText("Waiting")).toBeTruthy();
  });

  it("gives no verdict at exactly 50%", () => {
    expect(verdict(pred({ status: "resolved", outcome: 1, p_up: 0.5 }) as any)).toBe("none");
  });
});

describe("chart helpers", () => {
  it("number days, never dates", () => {
    expect(formatDay(toTime(87))).toBe("Day 87");
    expect(formatDay(toTime(1))).toBe("Day 1");
  });
});

describe("episode screen", () => {
  it("coach starts at step 1, moves to step 2 when the form is touched and step 3 after sending", async () => {
    signedIn();
    const api = episodeApi({ guess: vi.fn().mockResolvedValue({ ...pred(), created: true }) });
    renderApp(<EpisodeScreen />, api, "/learn/e1", "/learn/:id");
    await screen.findByText(/Day 60 of 250/);
    const current = () => within(screen.getByRole("list", { name: "Steps" })).getByRole("listitem", { current: "step" }).textContent;
    expect(current()).toBe("1 Look");
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "65" } });
    expect(current()).toBe("2 Guess");
    await userEvent.click(screen.getByRole("button", { name: "Send my guess" }));
    await waitFor(() => expect(current()).toBe("3 Move on"));
  });

  it("shows only blind information: no dates, years or names in the page", async () => {
    signedIn();
    // defence in depth: a reply that wrongly carries identity fields must not be rendered
    const leaky = { ...state(), symbol: "AAPL", start_date: "2015-03-02" };
    const leakyBars = { episode_id: "e1", bars: bars(60).map((b) => ({ ...b, date: "2015-03-02", symbol: "AAPL" })) };
    renderApp(<EpisodeScreen />, episodeApi({ episode: vi.fn().mockResolvedValue(leaky), bars: vi.fn().mockResolvedValue(leakyBars) }), "/learn/e1", "/learn/:id");
    await screen.findByText(/Day 60 of 250/);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/AAPL|2015|start_date/);
    expect(text).toMatch(/name, dates and price level still hidden/);
    expect(IDENTITY.test(text.replace(/Day \d+ of \d+/g, ""))).toBe(false);
  });

  it("an advance turns a waiting guess into an answered one with words", async () => {
    signedIn();
    const predictions = vi.fn()
      .mockResolvedValueOnce({ episode_id: "e1", predictions: [pred()], counts: {} })
      .mockResolvedValue({ episode_id: "e1", predictions: [pred({ status: "resolved", outcome: 1, p_up: 0.7 })], counts: {} });
    renderApp(<EpisodeScreen />, episodeApi({ predictions }), "/learn/e1", "/learn/:id");
    await screen.findByText("Waiting");
    await userEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(await screen.findByText(/▲ The price went up/)).toBeTruthy();
    expect(screen.getByText(/You were right/)).toBeTruthy();
    expect(screen.getByText(/One guess tells you almost nothing/)).toBeTruthy();
  });

  it("the status sentence follows the state and the advance button stops at the last day", async () => {
    signedIn();
    renderApp(<EpisodeScreen />, episodeApi({ episode: vi.fn().mockResolvedValue(state({ day: 250 })), predictions: vi.fn().mockResolvedValue({ episode_id: "e1", predictions: [pred(), pred({ prediction_id: 2 })], counts: {} }) }), "/learn/e1", "/learn/:id");
    expect((await screen.findByRole("status", { name: "" })).textContent ?? "").toBeTruthy();
    await screen.findByText(/Day 250 of 250 - 2 guesses waiting/);
    expect((screen.getByRole("button", { name: "Next day" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("You are at the last day.")).toBeTruthy();
  });

  it("the chart gets day numbers and a labelled legend; the finish step asks first", async () => {
    signedIn();
    chartCalls.length = 0;
    renderApp(<EpisodeScreen />, episodeApi(), "/learn/e1", "/learn/:id");
    await screen.findByText(/Day 60 of 250/);
    const candles = chartCalls.find((c) => c.kind === "candles")!;
    expect(candles.data).toHaveLength(60);
    expect(candles.data[0].time).toBe(toTime(1));
    expect(screen.getByText("▲ Up day")).toBeTruthy();
    expect(screen.getByText("▼ Down day")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Finish and see my score" }));
    expect(screen.getByText("Ready to see your score?")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Keep playing" }));
    expect(screen.queryByText("Ready to see your score?")).toBeNull();
  });

  it("shows a friendly message when the server cannot be reached", async () => {
    signedIn();
    const down = vi.fn().mockRejectedValue(new Error("MarketLab cannot reach its server. Is it running?"));
    renderApp(<EpisodeScreen />, episodeApi({ episode: down }), "/learn/e1", "/learn/:id");
    expect((await screen.findByRole("alert")).textContent).toContain("cannot reach its server");
  });
});

describe("start screen", () => {
  it("offers a mixed default and creates an episode", async () => {
    signedIn();
    const createEpisode = vi.fn().mockResolvedValue(state({ episode_id: "new1" }));
    renderApp(<Learn />, fakeApi({ createEpisode }), "/learn", "*");
    expect((screen.getByLabelText(/What kind of chart/) as HTMLSelectElement).value).toBe("mixed");
    expect(screen.getByText(/cannot cheat from memory/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(createEpisode).toHaveBeenCalledWith({ kind: "mixed", n_bars: 250 }));
  });
});
