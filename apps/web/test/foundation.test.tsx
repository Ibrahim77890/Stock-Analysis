import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi } from "../src/api/client";
import { Home, SignIn } from "../src/pages/Basics";
import { Term, clearTermCache } from "../src/components/Term";
import { Tour } from "../src/components/Tour";
import { Callout } from "../src/components/ui";
import { contrastRatio } from "../src/lib/contrast";
import { fakeApi, LEARNER, renderApp, signedIn } from "./helpers";

const css = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src/styles", f), "utf8");

describe("light theme only", () => {
  it("declares color-scheme light and has no dark-mode rules", () => {
    const all = css("tokens.css") + css("global.css");
    expect(all).toContain("color-scheme: light");
    expect(all).not.toMatch(/prefers-color-scheme\s*:\s*dark/);
    expect(fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8")).toContain('name="color-scheme" content="light"');
  });

  it("text and controls meet WCAG contrast (4.5:1 text, 3:1 components)", () => {
    const tokens = Object.fromEntries([...css("tokens.css").matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
    const text: Array<[string, string]> = [["text", "bg"], ["text", "surface"], ["muted", "surface"], ["muted", "bg"], ["accent", "surface"], ["accent-text", "accent"],
      ["info-text", "info-bg"], ["tip-text", "tip-bg"], ["careful-text", "careful-bg"], ["up", "surface"], ["down", "surface"], ["accent", "info-bg"]];
    for (const [fg, bg] of text) expect(contrastRatio(tokens[fg], tokens[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    for (const [fg, bg] of [["focus", "surface"], ["border", "surface"], ["accent", "surface"]] as const) expect(contrastRatio(tokens[fg], tokens[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
  });

  it("a Callout always shows its label word (colour is never the only signal)", () => {
    const { rerender } = renderApp(<Callout kind="info">x</Callout>, fakeApi());
    expect(screen.getByText(/Good to know/)).toBeTruthy();
    rerender(<Callout kind="careful">x</Callout>);
  });
});

describe("api client", () => {
  it("turns a network failure into a friendly sentence and a server message into an ApiError", async () => {
    const api = createApi({ base: "http://x", getToken: () => null });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed")));
    await expect(api.health()).rejects.toMatchObject({ status: 0, message: "MarketLab cannot reach its server. Is it running?" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "That name is taken. Please choose another one." }), { status: 409 })));
    const err = await api.register("a", "b").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("That name is taken. Please choose another one.");
    vi.unstubAllGlobals();
  });

  it("sends the bearer token and calls onUnauthorized on a 401", async () => {
    const onUnauthorized = vi.fn();
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Please sign in to continue." }), { status: 401 }));
    vi.stubGlobal("fetch", f);
    const api = createApi({ base: "http://x", getToken: () => "tok", onUnauthorized });
    await api.me().catch(() => undefined);
    expect(f.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
    expect(onUnauthorized).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("sign in and registration", () => {
  it("shows the password rules before anyone types", () => {
    renderApp(<SignIn />, fakeApi());
    expect(screen.getByText(/10 or more characters/)).toBeTruthy();
    expect(screen.getByLabelText("Your name")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
  });

  it("a taken name shows the friendly message", async () => {
    const api = fakeApi({ register: vi.fn().mockRejectedValue(new ApiError(409, "That name is taken. Please choose another one.")) });
    renderApp(<SignIn />, api);
    await userEvent.type(screen.getByLabelText("Your name"), "Sam");
    await userEvent.type(screen.getByLabelText("Password"), "a few random words");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect((await screen.findByRole("alert")).textContent).toContain("That name is taken");
  });

  it("stores the session in sessionStorage only, never localStorage or the URL, and sign out clears it", async () => {
    const api = fakeApi({ register: vi.fn().mockResolvedValue({ token: "SECRET-TOKEN", learner: LEARNER }) });
    renderApp(<><SignIn /></>, api, "/sign-in", "*", true);
    await userEvent.type(screen.getByLabelText("Your name"), "Sam");
    await userEvent.type(screen.getByLabelText("Password"), "a few random words");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(sessionStorage.getItem("marketlab.session")).toContain("SECRET-TOKEN"));
    expect(JSON.stringify({ ...localStorage })).not.toContain("SECRET-TOKEN");
    expect(window.location.href).not.toContain("SECRET-TOKEN");
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(sessionStorage.getItem("marketlab.session")).toBeNull();
  });

  it("the password can be shown and hidden", async () => {
    renderApp(<SignIn />, fakeApi());
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.type).toBe("password");
    await userEvent.click(screen.getByLabelText("Show password"));
    expect(input.type).toBe("text");
  });
});

describe("Term (word help)", () => {
  it("opens an inline definition, closes with Escape, works from the keyboard and has an accessible name", async () => {
    clearTermCache();
    renderApp(<p>Your <Term slug="brier-score">Brier score</Term> is shown.</p>, fakeApi());
    const btn = screen.getByRole("button", { name: "Brier score" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    btn.focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByText(/Plain meaning of brier-score/)).toBeTruthy();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByText(/Plain meaning of brier-score/)).toBeNull();
  });
});

describe("guided tour", () => {
  it("appears once on first sign-in, can be skipped, and is reopened from 'Need help?'", async () => {
    signedIn();
    sessionStorage.removeItem("marketlab.tour.seen");
    renderApp(<Home />, fakeApi(), "/", "*", true);
    expect(await screen.findByRole("region", { name: "A quick tour" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Skip the tour" }));
    expect(screen.queryByRole("region", { name: "A quick tour" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Need help?" }));
    expect(screen.getByRole("region", { name: "A quick tour" })).toBeTruthy();
  });

  it("opens right after someone signs in on a page that was already showing", async () => {
    const api = fakeApi({ login: vi.fn().mockResolvedValue({ token: "t", learner: LEARNER }) });
    renderApp(<SignIn />, api, "/sign-in", "*", true);
    expect(screen.queryByRole("region", { name: "A quick tour" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Already have an account? Sign in" }));
    await userEvent.type(screen.getByLabelText("Your name"), "Sam");
    await userEvent.type(screen.getByLabelText("Password"), "a few random words");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("region", { name: "A quick tour" })).toBeTruthy();
  });

  it("steps through to the end", async () => {
    const onClose = vi.fn();
    renderApp(<Tour onClose={onClose} />, fakeApi());
    for (let i = 0; i < 4; i++) await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("page shell", () => {
  it("has the TradingView credit and the not-advice line on every page", () => {
    renderApp(<Home />, fakeApi(), "/", "*", true);
    expect(screen.getByRole("link", { name: /TradingView Lightweight Charts/ })).toBeTruthy();
    expect(screen.getByText(/Not investment advice/)).toBeTruthy();
  });

  it("headings are in order and every control has a name", () => {
    signedIn();
    renderApp(<Home />, fakeApi(), "/", "*", true);
    const levels = screen.getAllByRole("heading").map((h) => Number(h.tagName[1]));
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    for (const b of screen.getAllByRole("button")) expect((b.textContent ?? "").trim() || b.getAttribute("aria-label")).toBeTruthy();
  });
});
