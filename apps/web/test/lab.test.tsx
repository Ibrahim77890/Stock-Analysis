import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import { lab } from "../src/copy/lab";
import { LabHome, StockPicker } from "../src/lab/LabHome";
import { Results } from "../src/lab/Results";
import { checkRule, RuleForm } from "../src/lab/RuleForm";
import { StudyPage } from "../src/lab/StudyPage";
import { costSentence, headline, luckSentence, vaultReading } from "../src/lab/readings";
import { VaultDialog } from "../src/lab/VaultPanel";
import { fallText, growthOf100, pctSigned, ratio, whole } from "../src/lib/format";
import { plainText } from "../src/components/Term";
import { flattenStrings } from "../src/lib/readability";
import { contrastRatio } from "../src/lib/contrast";
import { fakeApi, renderApp, signedIn } from "./helpers";
import { costs, overview, run, vault } from "./labFixtures";

// jsdom has no canvas: the chart library is replaced by a recorder
const chartCalls: Array<{ kind: string; data?: any; options?: any }> = [];
vi.mock("lightweight-charts", () => ({
  LineSeries: "line", LineStyle: { Dashed: 2 }, PriceScaleMode: { Logarithmic: 2 },
  CandlestickSeries: "candles", HistogramSeries: "hist",
  createChart: (_el: HTMLElement, opts: any) => {
    chartCalls.push({ kind: "create", options: opts });
    return {
      addSeries: (type: string, options: any) => ({ setData: (d: any) => chartCalls.push({ kind: type, data: d, options }) }),
      priceScale: () => ({ applyOptions: () => undefined }),
      timeScale: () => ({ fitContent: () => undefined }),
      remove: () => undefined,
    };
  },
}));

const STOCKS = [
  { symbol: "AAPL", name: "Apple Inc.", sector: "Technology", first_date: "2005-01-03", bars: 5283, years: 21 },
  { symbol: "MSFT", name: "Microsoft Corp", sector: "Technology", first_date: "2005-01-03", bars: 5283, years: 21 },
];
const BANNED = ["beats the market", "edge", "profit", "alpha", "guarantee", "winning", "proof"];

function studyApi(over: Record<string, any> = {}) {
  return fakeApi({
    labStudy: vi.fn().mockResolvedValue(overview()), labRun: vi.fn().mockResolvedValue(run()),
    labVault: vi.fn().mockResolvedValue(vault()), labSavedVault: vi.fn().mockResolvedValue(vault()), ...over,
  });
}

describe("rule form", () => {
  it("refuses fast >= slow, slow 301, cost 51, empty and decimal input with a message next to the field, and sends nothing", async () => {
    const onRun = vi.fn();
    renderApp(<RuleForm busy={false} onRun={onRun} />, fakeApi());
    const set = async (id: string, v: string) => { const el = screen.getByLabelText(new RegExp(id)); await userEvent.clear(el); if (v) await userEvent.type(el, v); };
    const run = () => userEvent.click(screen.getByRole("button", { name: /Run on practice years/ }));

    await set("Short average", "40"); await set("Long average", "40"); await run();
    expect((await screen.findByRole("alert")).textContent).toBe(lab.errFastSlow);
    await set("Short average", "10"); await set("Long average", "301"); await run();
    expect(screen.getByText(lab.errSlow)).toBeTruthy();
    await set("Long average", "100"); await set("Cost per trade", "51"); await run();
    expect(screen.getByText(lab.errCost)).toBeTruthy();
    await set("Cost per trade", ""); await run();
    expect(screen.getByText(lab.errCost)).toBeTruthy();
    await set("Cost per trade", "2"); await set("Short average", "5.5"); await run();
    expect(screen.getByText(lab.errFast)).toBeTruthy();
    expect(onRun).not.toHaveBeenCalled();
  });

  it("sends exactly the typed numbers when valid, and is disabled while a run is in progress", async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    renderApp(<RuleForm busy={false} onRun={onRun} />, fakeApi());
    await userEvent.clear(screen.getByLabelText(/Short average/)); await userEvent.type(screen.getByLabelText(/Short average/), "8");
    await userEvent.clear(screen.getByLabelText(/Long average/)); await userEvent.type(screen.getByLabelText(/Long average/), "30");
    await userEvent.click(screen.getByRole("button", { name: /Run on practice years/ }));
    expect(onRun).toHaveBeenCalledWith({ fast: 8, slow: 30, cost_bps: 2 });
    expect(checkRule("2", "3", "0").rule).toEqual({ fast: 2, slow: 3, cost_bps: 0 });
    expect(checkRule("299", "300", "50").rule).not.toBeNull();
  });

  it("is disabled and says it is running while a run is in progress", () => {
    renderApp(<RuleForm busy onRun={vi.fn()} />, fakeApi());
    expect((screen.getByRole("button", { name: /Running/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("can be tabbed through in order: short, long, cost, run", async () => {
    renderApp(<RuleForm busy={false} onRun={vi.fn()} />, fakeApi());
    const order: string[] = [];
    for (let i = 0; i < 6; i++) { await userEvent.tab(); order.push((document.activeElement as HTMLElement).id || (document.activeElement as HTMLElement).textContent!.trim()); }
    const ids = order.filter((x) => ["fast", "slow", "cost"].includes(x));
    expect(ids).toEqual(["fast", "slow", "cost"]);
  });
});

describe("stock picker and lab home", () => {
  it("filters by symbol or name and selects a stock", async () => {
    const onChange = vi.fn();
    renderApp(<StockPicker stocks={STOCKS} value={null} onChange={onChange} />, fakeApi());
    await userEvent.type(screen.getByLabelText(lab.searchLabel), "micro");
    expect(screen.queryByText("AAPL")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /MSFT/ }));
    expect(onChange).toHaveBeenCalledWith("MSFT");
  });

  it("starts a study once even on a double click, and shows a cap message in the page", async () => {
    signedIn();
    const labCreate = vi.fn().mockResolvedValue({ study_id: 9 });
    const api = fakeApi({ labStocks: vi.fn().mockResolvedValue({ stocks: STOCKS }), labCreate });
    renderApp(<LabHome />, api, "/lab", "*");
    await userEvent.click(await screen.findByRole("button", { name: /AAPL/ }));
    const start = screen.getByRole("button", { name: /Start study/ });
    await userEvent.dblClick(start);
    expect(labCreate).toHaveBeenCalledTimes(1);
    expect(labCreate).toHaveBeenCalledWith("AAPL");
  });

  it("shows the gateway's plain message when the study cap is reached", async () => {
    signedIn();
    const api = fakeApi({ labStocks: vi.fn().mockResolvedValue({ stocks: STOCKS }), labCreate: vi.fn().mockRejectedValue(new ApiError(422, "You can have at most 20 studies. Please use one of the ones you have.")) });
    renderApp(<LabHome />, api, "/lab", "*");
    await userEvent.click(await screen.findByRole("button", { name: /AAPL/ }));
    await userEvent.click(screen.getByRole("button", { name: /Start study/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("at most 20 studies");
  });

  it("lists my studies with ideas tried and the vault state", async () => {
    signedIn();
    const api = fakeApi({ labStocks: vi.fn().mockResolvedValue({ stocks: STOCKS }), labStudies: vi.fn().mockResolvedValue([
      { study_id: 1, symbol: "AAPL", name: "Lab AAPL", practice_years: 17, vault_years: 4, vault_open: false, ideas_tried: 3, created_at: "2026-11-09T10:00:00Z" },
      { study_id: 2, symbol: "MSFT", name: "Lab MSFT", practice_years: 17, vault_years: 4, vault_open: true, ideas_tried: 1, created_at: "2026-11-09T11:00:00Z" }]) });
    renderApp(<LabHome />, api, "/lab", "*");
    const list = await screen.findByRole("list", { name: lab.yourStudies });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("3 ideas tried")).toBeTruthy();
    expect(within(list).getByText(lab.vaultOpened)).toBeTruthy();
  });
});

describe("results", () => {
  it("shows the headline and every rule number with its buy-and-hold number beside it", () => {
    renderApp(<Results run={run()} />, fakeApi());
    expect(screen.getByTestId("headline").textContent).toBe("In these 17.0 practice years, 100 in your rule became 180. 100 in buy and hold became 250.");
    const rule = screen.getByText(lab.lineRule, { selector: ".chip" }).closest(".col")!;
    const hold = screen.getByText(lab.lineHold, { selector: ".chip" }).closest(".col")!;
    for (const label of [lab.rows.perYear.label, lab.rows.fall.label, lab.rows.time.label, lab.rows.trades.label]) {
      expect(within(rule as HTMLElement).getByText(label)).toBeTruthy();
      expect(within(hold as HTMLElement).getByText(label)).toBeTruthy();
    }
    expect(within(rule as HTMLElement).getByText("+80%")).toBeTruthy();
    expect(within(hold as HTMLElement).getByText("+150%")).toBeTruthy();
  });

  it("always shows the 'does not tell you' list, also with warnings", () => {
    renderApp(<Results run={run({ warnings: ["The rule made only 12 trades. That is too few to learn much from."], rule: { ...run().rule, trades: 12 } })} />, fakeApi());
    expect(screen.getByText(lab.notTitle)).toBeTruthy();
    for (const t of lab.notList) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getAllByText(/too few/i).length).toBeGreaterThan(0);
  });

  it("uses no banned word anywhere in the rendered result text", () => {
    const { container } = renderApp(<Results run={run({ overfitting_meter: { trials: 2, best_sharpe: 1, expected_best_sharpe_by_luck: 0.02, dsr: 0.9, note: "n" } })} />, fakeApi());
    const all = (container.textContent ?? "").toLowerCase();
    for (const bad of BANNED) expect(all, bad).not.toMatch(new RegExp(`\\b${bad}\\b`));
  });

  it("draws the chart on a log scale with both lines starting at 100 and a keyboard-reachable table", async () => {
    chartCalls.length = 0;
    renderApp(<Results run={run()} />, fakeApi());
    expect(chartCalls.find((c) => c.kind === "create")!.options.rightPriceScale.mode).toBe(2);
    const lines = chartCalls.filter((c) => c.kind === "line");
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.data[0].value)).toEqual([100, 100]);
    expect(lines.every((l) => l.data.length <= 300)).toBe(true);
    expect(lines[1].options.lineStyle).toBe(2); // buy and hold is dashed
    const toggle = screen.getByRole("button", { name: lab.showTable });
    toggle.focus();
    await userEvent.keyboard("{Enter}");
    const table = screen.getByRole("table", { name: "Yearly change" });
    expect(within(table).getByText("2005")).toBeTruthy();
    expect(within(table).getAllByText("+10.0%").length).toBe(2); // rule in 2005 and buy and hold in 2006
  });

  it("the cost sentence is right when the sign flips and when it does not", () => {
    expect(costSentence(costs([0.9, 0.8, 0.6, 0.3, -0.1], [0.5, 0.5, 0.5, 0.5, 0.5]))).toBe(
      "The rule finished ahead of buy and hold at costs below 10 basis points, and behind it from 10 basis points up. At 20 basis points the rule no longer made money.");
    expect(costSentence(costs([1, 1, 1, 1, 1], [0.5, 0.5, 0.5, 0.5, 0.5]))).toBe("At every cost level shown, the rule finished ahead of buy and hold in this sample.");
    expect(costSentence(costs([0.1, 0.1, 0.1, 0.1, 0.1], [0.5, 0.5, 0.5, 0.5, 0.5]))).toBe("At every cost level shown, the rule finished behind buy and hold in this sample.");
    expect(costSentence([])).toBeNull();
  });

  it("a missing cost table shows a plain note and does not crash (negative)", () => {
    renderApp(<Results run={run({ costs: [] })} />, fakeApi());
    expect(screen.getByText("The cost table is not available for this run.")).toBeTruthy();
  });

  it("the luck sentence counts the mixed-up histories", () => {
    expect(luckSentence(run().luck)).toBe("Mixing up the order of the days 100 times, 35 of 100 mixed-up histories did as well as your rule or better. Most mixed-up histories ended between +10% and +200%.");
  });

  it("flags a run that was already counted", async () => {
    signedIn();
    renderApp(<StudyPage />, studyApi({ labRun: vi.fn().mockResolvedValue(run({ counted: false })) }), "/lab/7", "/lab/:id");
    await userEvent.click(await screen.findByRole("button", { name: /Run on practice years/ }));
    expect(await screen.findByText(lab.alreadyCounted)).toBeTruthy();
  });
});

describe("study page", () => {
  it("runs a rule through the gateway with the typed numbers and refreshes the ideas tried", async () => {
    signedIn();
    const labStudy = vi.fn().mockResolvedValueOnce(overview({ ideas_tried: 0, trials: [] })).mockResolvedValue(overview());
    const labRun = vi.fn().mockResolvedValue(run());
    renderApp(<StudyPage />, studyApi({ labStudy, labRun }), "/lab/7", "/lab/:id");
    expect(await screen.findByText(lab.ideasNone)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Run on practice years/ }));
    await waitFor(() => expect(labRun).toHaveBeenCalledWith("7", { fast: 20, slow: 100, cost_bps: 2, seed: 1, n_paths: 100 }));
    expect(await screen.findByText(lab.resultsTitle)).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText("1 idea tried").length).toBeGreaterThan(0));
  });

  it("shows plain messages for 429, 504 and 422 and the form works again afterwards", async () => {
    signedIn();
    const labRun = vi.fn()
      .mockRejectedValueOnce(new ApiError(429, "You are going a little fast. Please wait 12 seconds before the next run."))
      .mockRejectedValueOnce(new ApiError(504, "The number service took too long. Please try again."))
      .mockRejectedValueOnce(new ApiError(422, "The long average can be at most 300 days."))
      .mockResolvedValue(run());
    renderApp(<StudyPage />, studyApi({ labRun }), "/lab/7", "/lab/:id");
    const button = async () => screen.findByRole("button", { name: /Run on practice years/ });
    await userEvent.click(await button());
    expect((await screen.findByRole("alert")).textContent).toBe(lab.errors[429]);
    await userEvent.click(await button());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(lab.errors[504]));
    await userEvent.click(await button());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The long average can be at most 300 days."));
    await userEvent.click(await button());
    expect(await screen.findByText(lab.resultsTitle)).toBeTruthy();
  });

  it("renders no date after the practice window and none of the vault words before the vault opens", async () => {
    signedIn();
    const { container } = renderApp(<StudyPage />, studyApi(), "/lab/7", "/lab/:id");
    await userEvent.click(await screen.findByRole("button", { name: /Run on practice years/ }));
    await screen.findByText(lab.resultsTitle);
    await userEvent.click(screen.getByRole("button", { name: lab.showTable }));
    const text = container.textContent ?? "";
    expect((text.match(/\b(20\d{2})\b/g) ?? []).every((y) => Number(y) <= 2021)).toBe(true);
    expect(text).not.toMatch(/The vault is open|Practice years and vault/);
  });
});

describe("vault flow", () => {
  async function toDialog(api = studyApi()) {
    signedIn();
    const r = renderApp(<StudyPage />, api, "/lab/7", "/lab/:id");
    await userEvent.click(await screen.findByRole("button", { name: lab.vaultButton }));
    return { api, ...r };
  }

  it("the locked state shows no vault number and no date", async () => {
    signedIn();
    const { container } = renderApp(<StudyPage />, studyApi(), "/lab/7", "/lab/:id");
    await screen.findAllByText(lab.vaultLocked, { selector: ".chip" });
    expect(container.textContent).toContain("It opens once");
    expect(container.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("starts with focus on Cancel, closes with Escape and Cancel, and sends nothing", async () => {
    const { api } = await toDialog();
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: lab.dialogCancel }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: lab.vaultButton }));
    await userEvent.click(screen.getByRole("button", { name: lab.dialogCancel }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.labVault).not.toHaveBeenCalled();
  });

  it("cannot be confirmed with a wrong or empty word (negative)", async () => {
    const { api } = await toDialog();
    const confirm = screen.getByRole("button", { name: lab.dialogConfirm }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(lab.dialogType), "open");
    expect(confirm.disabled).toBe(true);
    await userEvent.clear(screen.getByLabelText(lab.dialogType));
    await userEvent.type(screen.getByLabelText(lab.dialogType), "OPE");
    fireEvent.submit(screen.getByLabelText(lab.dialogType).closest("form")!);
    expect(api.labVault).not.toHaveBeenCalled();
  });

  it("sends exactly one request even if the button is clicked twice or Enter is pressed twice", async () => {
    const { api } = await toDialog();
    await userEvent.type(screen.getByLabelText(lab.dialogType), "OPEN");
    const confirm = screen.getByRole("button", { name: lab.dialogConfirm });
    const form = screen.getByLabelText(lab.dialogType).closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form); // Enter twice in a row
    await userEvent.dblClick(confirm).catch(() => undefined);
    await screen.findByText(lab.vaultOpenTitle);
    expect(api.labVault).toHaveBeenCalledTimes(1);
    expect(api.labVault).toHaveBeenCalledWith("7", { fast: 10, slow: 40, cost_bps: 2 });
  });

  it("after opening: side by side, a reading, the tries line, no way to open again", async () => {
    await toDialog();
    await userEvent.type(screen.getByLabelText(lab.dialogType), "OPEN");
    await userEvent.click(screen.getByRole("button", { name: lab.dialogConfirm }));
    expect(await screen.findByText(lab.vaultOpenTitle)).toBeTruthy();
    expect(screen.getByTestId("vault-reading").textContent).toBe(lab.readingMuchWorse);
    expect(screen.getByText(lab.vaultTried(3))).toBeTruthy();
    expect(screen.getByRole("table", { name: lab.vaultCompare })).toBeTruthy();
    expect(screen.queryByRole("button", { name: lab.vaultButton })).toBeNull();
    expect(screen.getByText(lab.vaultAfterNote)).toBeTruthy();
  });

  it("a 409 (opened in another tab) shows the saved result instead of an error", async () => {
    const labVault = vi.fn().mockRejectedValue(new ApiError(409, "The vault of this study was already opened."));
    await toDialog(studyApi({ labVault }));
    await userEvent.type(screen.getByLabelText(lab.dialogType), "OPEN");
    await userEvent.click(screen.getByRole("button", { name: lab.dialogConfirm }));
    expect(await screen.findByText(lab.vaultOpenTitle)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("an already opened vault is shown after a reload", async () => {
    signedIn();
    renderApp(<StudyPage />, studyApi({ labStudy: vi.fn().mockResolvedValue(overview({ vault_open: true })) }), "/lab/7", "/lab/:id");
    expect(await screen.findByText(lab.vaultOpenTitle)).toBeTruthy();
  });

  it("the reading follows the Sharpe rule for much worse, similar and better", () => {
    const base = vault();
    const mk = (practice: number, vaultSharpe: number | null) => ({ ...base, rule: { ...base.rule, sharpe: vaultSharpe }, practice: { ...base.practice, rule: { ...base.practice.rule, sharpe: practice } } });
    expect(vaultReading(mk(0.9, 0.1))).toBe("worse");
    expect(vaultReading(mk(0.9, 0.7))).toBe("similar");
    expect(vaultReading(mk(0.4, 1.0))).toBe("better");
    expect(vaultReading(mk(0.9, null))).toBe("unknown");
  });

  it("the dialog traps Tab inside itself", async () => {
    const onConfirm = vi.fn();
    renderApp(<VaultDialog trial={overview().trials[0]} busy={false} onCancel={vi.fn()} onConfirm={onConfirm} />, fakeApi());
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: lab.dialogCancel }));
    for (let i = 0; i < 6; i++) { await userEvent.tab(); const a = document.activeElement as HTMLElement; expect(dialog.contains(a), `${i}: ${a.tagName} ${a.textContent}`).toBe(true); }
  });
});

describe("number formatting", () => {
  it("signs, rounding, zero, null and large values", () => {
    expect(pctSigned(0.8734)).toBe("+87.3%");
    expect(pctSigned(-0.12)).toBe("-12.0%");
    expect(pctSigned(0)).toBe("0.0%");
    expect(pctSigned(null)).toBe("-");
    expect(pctSigned(51.78, 0)).toBe("+5178%");
    expect(whole(5278.4)).toBe("5,278");
    expect(whole(18360.9)).toBe("18,361");
    expect(growthOf100(0.87)).toBeCloseTo(187);
    expect(ratio(1.056)).toBe("1.06");
    expect(ratio(null)).toBe("-");
    expect(fallText(-0.3)).toBe("30%");
    expect(headline(run())).toContain("100 in your rule became 180");
  });
});

describe("Lab copy and design checks", () => {
  const strings = flattenStrings(lab).map(plainText);
  it("never uses the banned words", () => {
    const all = strings.join(" ").toLowerCase();
    for (const bad of BANNED) expect(all, bad).not.toMatch(new RegExp(`\\b${bad}\\b`));
  });

  it("the banned-word check would catch 'edge' (negative)", () => {
    expect("this rule has an edge over the market".match(/\bedge\b/)).not.toBeNull();
  });

  it("every {{slug|label}} in the Lab copy resolves to a seeded glossary term", () => {
    const seed = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../api/seed/learning-terms.json"), "utf8")) as Array<{ slug: string }>;
    const general = fs.readFileSync(path.resolve(__dirname, "../../../docs/02-domain/glossary.md"), "utf8");
    const slugs = new Set(seed.map((t) => t.slug));
    for (const m of general.matchAll(/^\|\s*\d+\s*\|\s*([^|]+?)\s*\|/gm)) slugs.add(m[1].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
    const used = flattenStrings(lab).flatMap((t) => [...t.matchAll(/\{\{([a-z0-9-]+)\|[^}]+\}\}/g)].map((m) => m[1]));
    expect(used.length).toBeGreaterThan(5);
    expect(used.filter((u) => !slugs.has(u))).toEqual([]);
  });

  it("Lab components use design tokens only: no hard-coded colours in src/lab", () => {
    const dir = path.resolve(__dirname, "../src/lab");
    const bad: string[] = [];
    for (const f of fs.readdirSync(dir)) if (/\.tsx?$/.test(f) && /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(fs.readFileSync(path.join(dir, f), "utf8"))) bad.push(f);
    expect(bad).toEqual([]);
  });

  it("the series colours differ enough from the surface and from each other", () => {
    const tokens = Object.fromEntries([...fs.readFileSync(path.resolve(__dirname, "../src/styles/tokens.css"), "utf8").matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
    expect(contrastRatio(tokens["series-rule"], tokens.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(tokens["series-hold"], tokens.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(tokens["accent-strong"], tokens["accent-soft"])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens.teal, tokens["teal-soft"])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens.muted, tokens["surface-2"])).toBeGreaterThanOrEqual(4.5);
  });
});
