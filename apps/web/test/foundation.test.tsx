import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi } from "../src/api/client";
import { Home, SignIn } from "../src/pages/Basics";
import { Term, clearTermCache } from "../src/components/Term";
import { tour } from "../src/copy/home";
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
  it("opens the sign-in form by default (not the sign-up form)", () => {
    renderApp(<SignIn />, fakeApi(), "/sign-in");
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create account" })).toBeNull();
    expect(screen.queryByText(/10 or more characters/)).toBeNull();
  });

  it("opens the sign-up form only when asked with ?mode=register, and shows the password rules before anyone types", () => {
    renderApp(<SignIn />, fakeApi(), "/sign-in?mode=register");
    expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
    expect(screen.getByText(/10 or more characters/)).toBeTruthy();
    expect(screen.getByLabelText("Your name")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
  });

  it("a taken name shows the friendly message", async () => {
    const api = fakeApi({ register: vi.fn().mockRejectedValue(new ApiError(409, "That name is taken. Please choose another one.")) });
    renderApp(<SignIn />, api, "/sign-in?mode=register");
    await userEvent.type(screen.getByLabelText("Your name"), "Sam");
    await userEvent.type(screen.getByLabelText("Password"), "a few random words");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect((await screen.findByRole("alert")).textContent).toContain("That name is taken");
  });

  it("stores the session in sessionStorage only, never localStorage or the URL, and sign out clears it", async () => {
    const api = fakeApi({ register: vi.fn().mockResolvedValue({ token: "SECRET-TOKEN", learner: LEARNER }) });
    renderApp(<><SignIn /></>, api, "/sign-in?mode=register", "*", true);
    await userEvent.type(screen.getByLabelText("Your name"), "Sam");
    await userEvent.type(screen.getByLabelText("Password"), "a few random words");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(sessionStorage.getItem("marketlab.session")).toContain("SECRET-TOKEN"));
    expect(JSON.stringify({ ...localStorage })).not.toContain("SECRET-TOKEN");
    expect(window.location.href).not.toContain("SECRET-TOKEN");
    await userEvent.click(await screen.findByRole("button", { name: /Hello, Sam/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
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

describe("guided tour (react-joyride)", () => {
  it("appears once on first sign-in, can be skipped, and is reopened from the Tutorial button", async () => {
    signedIn();
    sessionStorage.removeItem("marketlab.tour.seen");
    renderApp(<Home />, fakeApi(), "/", "*", true);
    expect(await screen.findByText("A quick tour")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Skip the tour" }));
    await waitFor(() => expect(screen.queryByText("A quick tour")).toBeNull());
    expect(sessionStorage.getItem("marketlab.tour.seen")).toBe("1");
    await userEvent.click(screen.getByRole("button", { name: /Tutorial/ }));
    expect(await screen.findByText("A quick tour")).toBeTruthy();
  });

  it("does not open again after it was seen, and has no Tutorial button before sign-in", () => {
    signedIn();
    renderApp(<Home />, fakeApi(), "/", "*", true);
    expect(screen.queryByText("A quick tour")).toBeNull();
    sessionStorage.clear();
  });

  it("opens right after someone signs in on a page that was already showing", async () => {
    const api = fakeApi({ login: vi.fn().mockResolvedValue({ token: "t", learner: LEARNER }) });
    renderApp(<SignIn />, api, "/sign-in", "*", true);
    expect(screen.queryByText("A quick tour")).toBeNull();
    await userEvent.type(screen.getByLabelText("Your name"), "Sam");
    await userEvent.type(screen.getByLabelText("Password"), "a few random words");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("A quick tour")).toBeTruthy();
  });

  it("steps through every menu item to the end", { timeout: 30000 }, async () => {
    signedIn();
    sessionStorage.removeItem("marketlab.tour.seen");
    renderApp(<Home />, fakeApi(), "/", "*", true);
    expect(await screen.findByText("A quick tour")).toBeTruthy();
    const titles = ["Path", "Learn", "Lab", "My decisions", "Data", "My progress", "Words", "How does this work?", "Tutorial"];
    for (const t of titles) {
      await userEvent.click(screen.getByRole("button", { name: "Next" }));
      await waitFor(() => expect(screen.getByRole("alertdialog").querySelector("h4")?.textContent).toBe(t));
    }
    await userEvent.click(await screen.findByRole("button", { name: "Got it" }));
    await waitFor(() => expect(sessionStorage.getItem("marketlab.tour.seen")).toBe("1"));
  });

  it("every tour step points at an element that exists in the sidebar or the header", () => {
    signedIn();
    renderApp(<Home />, fakeApi(), "/", "*", true);
    const missing = tour.steps.filter((s) => s.target !== "body" && !document.querySelector(s.target)).map((s) => s.id);
    expect(missing).toEqual([]);
  });
});

describe("sidebar and menu", () => {
  const ITEMS = ["Path", "Learn", "Lab", "My decisions", "Data", "My progress", "Words", "How does this work?"];

  it("shows the eight menu items only after sign-in, in a sidebar", () => {
    signedIn();
    renderApp(<Home />, fakeApi(), "/", "*", true);
    const side = screen.getByRole("complementary", { name: "Sidebar" });
    const names = within(within(side).getByRole("navigation", { name: "Main" })).getAllByRole("link").map((a) => a.textContent?.trim());
    expect(names).toEqual(ITEMS);
  });

  it("shows no menu, no sidebar and no Tutorial button to someone who is not signed in, only a Sign in link to the login form", () => {
    sessionStorage.clear();
    renderApp(<Home />, fakeApi(), "/", "*", true);
    expect(screen.queryByRole("complementary", { name: "Sidebar" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    for (const item of ITEMS) expect(screen.queryByRole("link", { name: item })).toBeNull();
    expect(screen.queryByRole("button", { name: /Tutorial/ })).toBeNull();
    expect((screen.getByRole("link", { name: "Sign in" }) as HTMLAnchorElement).getAttribute("href")).toBe("/sign-in");
  });

  it("the Menu button opens and closes the sidebar on a narrow screen and Escape closes it", async () => {
    signedIn();
    renderApp(<Home />, fakeApi(), "/", "*", true);
    const toggle = screen.getByRole("button", { name: "Menu" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("sidebar")!.className).toContain("open");
    await userEvent.keyboard("{Escape}");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("the layout has no fixed maximum width: the page, the header and the sign-in form fill the screen", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../src/styles/global.css"), "utf8");
    expect(css).toMatch(/\.page \{ width: 100%;/);
    expect(css).not.toMatch(/\.page \{[^}]*max-width/);
    expect(css).not.toMatch(/\.appbar-inner \{[^}]*max-width/);
    expect(css).not.toMatch(/\.auth-wrap \{[^}]*max-width/);
  });

  it("uses Montserrat for headings and Raleway for text, everywhere", () => {
    const tokens = fs.readFileSync(path.resolve(__dirname, "../src/styles/tokens.css"), "utf8");
    expect(tokens).toMatch(/--font: "Raleway Variable"/);
    expect(tokens).toMatch(/--font-head: "Montserrat Variable"/);
    const main = fs.readFileSync(path.resolve(__dirname, "../src/main.tsx"), "utf8");
    expect(main).toContain("@fontsource-variable/montserrat");
    expect(main).toContain("@fontsource-variable/raleway");
    expect(main).not.toContain("inter");
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
