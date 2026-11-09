import type { components } from "./schema";

type S = components["schemas"];
export type EpisodeState = S["EpisodeStateDto"];
export type EpisodeListItem = S["EpisodeListItemDto"];
export type Bars = S["BarsDto"];
export type Bar = S["BarDto"];
export type PredictionItem = S["PredictionItemDto"];
export type Predictions = S["PredictionsDto"];
export type Score = S["ScoreDto"];
export type Bin = S["BinDto"];
export type Reveal = S["RevealDto"];
export type Progress = S["ProgressDto"];
export type GlossaryTerm = S["GlossaryTermDto"];
export type TraceEntry = S["TraceEntryDto"];
export type SystemInfo = S["SystemDto"];
export type Health = S["HealthDto"];
export type TokenReply = S["TokenDto"];
export type Learner = S["LearnerDto"];

/** A server problem turned into a sentence a beginner can read. Never carries tokens or URLs. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export const API_BASE: string = (import.meta.env?.VITE_API_BASE as string | undefined) ?? "http://127.0.0.1:3000";
export const CANNOT_REACH = "MarketLab cannot reach its server. Is it running?";

export interface ClientOptions {
  base?: string;
  getToken: () => string | null;
  onUnauthorized?: () => void;
}

export function createApi({ base = API_BASE, getToken, onUnauthorized }: ClientOptions) {
  async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const token = getToken();
    let res: Response;
    try {
      res = await fetch(base + path, {
        method,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, CANNOT_REACH);
    }
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      /* empty body */
    }
    if (!res.ok) {
      if (res.status === 401 && token) onUnauthorized?.();
      const message = typeof data?.message === "string" ? data.message : Array.isArray(data?.message) ? data.message[0] : "Something went wrong. Please try again.";
      throw new ApiError(res.status, message);
    }
    return data as T;
  }

  const get = <T>(p: string) => request<T>("GET", p);
  const post = <T>(p: string, b?: unknown) => request<T>("POST", p, b ?? {});

  return {
    health: () => get<Health>("/health"),
    register: (display_name: string, password: string) => post<TokenReply>("/auth/register", { display_name, password }),
    login: (display_name: string, password: string) => post<TokenReply>("/auth/login", { display_name, password }),
    me: () => get<Learner>("/me"),
    createEpisode: (b: { kind?: "mixed" | "real" | "synthetic"; n_bars?: number; initial_visible?: number; seed?: number }) => post<EpisodeState>("/episodes", b),
    listEpisodes: () => get<EpisodeListItem[]>("/episodes"),
    episode: (id: string) => get<EpisodeState>(`/episodes/${id}`),
    bars: (id: string) => get<Bars>(`/episodes/${id}/bars`),
    advance: (id: string, n: number) => post<EpisodeState>(`/episodes/${id}/advance`, { n }),
    guess: (id: string, horizon: 1 | 5 | 10, p_up: number) => post<PredictionItem>(`/episodes/${id}/predictions`, { horizon, p_up }),
    predictions: (id: string) => get<Predictions>(`/episodes/${id}/predictions`),
    score: (id: string) => get<Score>(`/episodes/${id}/score`),
    reveal: (id: string) => post<Reveal>(`/episodes/${id}/reveal`),
    progress: () => get<Progress>("/me/progress"),
    glossary: (q?: string) => get<GlossaryTerm[]>(`/glossary${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    term: (slug: string) => get<GlossaryTerm>(`/glossary/${encodeURIComponent(slug)}`),
    system: () => get<SystemInfo>("/system"),
    trace: (limit = 30) => get<TraceEntry[]>(`/trace?limit=${limit}`),
  };
}

export type Api = ReturnType<typeof createApi>;
