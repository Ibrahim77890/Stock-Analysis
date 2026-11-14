import { render } from "@testing-library/react";
import { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import type { Api } from "../src/api/client";
import { AuthProvider } from "../src/auth/AuthContext";
import { Layout } from "../src/components/Layout";
import { TOUR_KEY } from "../src/components/Tour";

export const LEARNER = { learner_id: "L1", display_name: "Sam" };

export function signedIn(): void {
  sessionStorage.setItem("marketlab.session", JSON.stringify({ token: "t0ken", learner: LEARNER }));
  sessionStorage.setItem(TOUR_KEY, "1"); // tour already seen unless a test removes this
}

export function fakeApi(over: Partial<Record<keyof Api, any>> = {}): Api {
  const base: Record<string, any> = {
    health: vi.fn().mockResolvedValue({ status: "ok", gateway: "ok", database: "ok", python: "ok" }),
    register: vi.fn(), login: vi.fn(), me: vi.fn(),
    createEpisode: vi.fn(), listEpisodes: vi.fn().mockResolvedValue([]),
    episode: vi.fn(), bars: vi.fn(), advance: vi.fn(), guess: vi.fn(), predictions: vi.fn(), score: vi.fn(), reveal: vi.fn(),
    progress: vi.fn(), glossary: vi.fn().mockResolvedValue([]),
    term: vi.fn().mockImplementation(async (slug: string) => ({ slug, term: slug, plain_definition: `Plain meaning of ${slug}.`, example: "An example.", level: "beginner", category: "learning", related: [], source: "project definition" })),
    system: vi.fn(), trace: vi.fn().mockResolvedValue([]),
    labStocks: vi.fn().mockResolvedValue({ stocks: [] }), labStudies: vi.fn().mockResolvedValue([]), labCreate: vi.fn(), labStudy: vi.fn(),
    labRun: vi.fn(), labVault: vi.fn(), labSavedVault: vi.fn(),
    indicators: vi.fn().mockResolvedValue({ episode_id: "e1", name: "sma", window: 20, day: 60, values: [] }), decide: vi.fn(), journal: vi.fn().mockResolvedValue({ episode_id: "e1", day: 60, decisions: [], totals: { decisions: 0, marked: 0, pending: 0, growth: null, note: "" } }),
    dataStatus: vi.fn(), lessons: vi.fn().mockResolvedValue([]), lesson: vi.fn(), lessonRead: vi.fn(), lessonAnswer: vi.fn(),
  };
  return { ...base, ...over } as unknown as Api;
}

export function renderApp(ui: ReactElement, api: Api, route = "/", path = "*", withLayout = false) {
  const body = withLayout ? <Layout>{ui}</Layout> : ui;
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider apiOverride={api}>
        <Routes><Route path={path} element={body} /></Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

export const state = (over: Record<string, unknown> = {}): any => ({ episode_id: "e1", n_bars: 250, initial_visible: 60, day: 60, status: "open", kind_requested: "mixed", ...over });
export const bar = (day: number, close = 100) => ({ day, open: close - 0.5, high: close + 1, low: close - 1, close, rel_volume: 1 });
export const bars = (n: number) => Array.from({ length: n }, (_, i) => bar(i + 1, 100 + i * 0.1));
export const pred = (over: Record<string, unknown> = {}): any => ({ prediction_id: 1, day: 60, horizon: 5, p_up: 0.7, status: "pending", outcome: null, ...over });

export const emptyBins = () => Array.from({ length: 10 }, (_, i) => ({ bin_low: i / 10, bin_high: (i + 1) / 10, n: 0, mean_forecast: null, observed: null, wilson_low: null, wilson_high: null, sparse: false }));
export function score(over: Record<string, unknown> = {}) {
  return {
    episode_id: "e1", counts: { resolved: 4, void: 0, pending: 0, total: 4 }, n: 4, brier: 0.225, skill_vs_coin_flip: 0.1, log_loss: 0.6,
    bins: emptyBins(), murphy: {}, baselines: { coin_flip: 0.25 }, enough: false, min_enough: 30, warnings: [],
    luck: { real_brier: 0.225, luck_probability: 0.38, n_perm: 5000, seed: 1, count: 1900, not_reported: true, shuffled_quantiles: null },
    ...over,
  };
}
