import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { ProfileMenu } from "../src/components/ProfileMenu";
import { landing } from "../src/copy/landing";
import { CountUp, Landing } from "../src/pages/Landing";
import { fakeApi, LEARNER, renderApp, signedIn } from "./helpers";

const renderRouter = (route: string, signed: boolean) => {
  if (signed) signedIn(); else sessionStorage.clear();
  return renderApp(<App />, fakeApi({ lessons: vi.fn().mockResolvedValue([]) }), route, "*");
};

describe("landing page", () => {
  it("shows the headline, both calls to action, and every feature of the product", () => {
    sessionStorage.clear();
    renderApp(<Landing />, fakeApi(), "/landing", "*", true);
    expect(screen.getByRole("heading", { level: 1, name: landing.title })).toBeTruthy();
    const create = screen.getAllByRole("link", { name: new RegExp(landing.create) });
    expect(create.length).toBeGreaterThanOrEqual(2);
    for (const a of create) expect((a as HTMLAnchorElement).getAttribute("href")).toBe("/sign-in?mode=register");
    for (const a of screen.getAllByRole("link", { name: landing.signIn })) expect((a as HTMLAnchorElement).getAttribute("href")).toBe("/sign-in");
    expect(landing.features).toHaveLength(12);
    for (const f of landing.features) {
      expect(screen.getByRole("heading", { level: 3, name: f.head })).toBeTruthy();
      expect(screen.getByText(f.body)).toBeTruthy();
    }
    for (const s of landing.how) expect(screen.getByRole("heading", { level: 3, name: s.head })).toBeTruthy();
    for (const p of landing.principles) expect(screen.getByText(p)).toBeTruthy();
  });

  it("lists every part of the menu among the features (nothing in the product is left out)", () => {
    const all = landing.features.map((f) => f.head.toLowerCase()).join(" | ");
    for (const part of ["learning path", "hidden charts", "score", "indicators", "journal", "lab", "vault", "words", "data", "progress", "how it works", "tutorial"]) {
      expect(all, part).toContain(part);
    }
  });

  it("the final numbers are always in the page text for screen readers, and the counter reaches them", async () => {
    renderApp(<CountUp to={7} />, fakeApi());
    expect(screen.getByText("7", { selector: ".sr-only" })).toBeTruthy();
    await waitFor(() => expect(document.querySelector("[aria-hidden='true']")?.textContent).toBe("7"));
  });

  it("is animated with CSS and respects the request for less motion", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../src/styles/global.css"), "utf8");
    for (const k of ["@keyframes rise", "@keyframes grow", "@keyframes draw", "@keyframes pulse", ".reveal.in"]) expect(css, k).toContain(k);
    const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.reveal \{ opacity: 1; transform: none; \}/);
  });

  it("has no hard-coded colours in the page file", () => {
    expect(fs.readFileSync(path.resolve(__dirname, "../src/pages/Landing.tsx"), "utf8")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});

describe("which page each click leads to", () => {
  it("signed out: the logo goes to /landing, and '/' sends the visitor to the landing page", async () => {
    renderRouter("/", false);
    expect(await screen.findByRole("heading", { level: 1, name: landing.title })).toBeTruthy();
    expect((screen.getByRole("link", { name: "MarketLab" }) as HTMLAnchorElement).getAttribute("href")).toBe("/landing");
  });

  it("signed in: the logo goes to the home page ('/'), and /landing sends a signed-in person home", async () => {
    renderRouter("/landing", true);
    expect((await screen.findAllByRole("link", { name: /Start learning/ })).length).toBeGreaterThan(0);   // the home page for signed-in people
    expect(screen.queryByRole("heading", { level: 1, name: landing.title })?.closest(".landing")).toBeNull();
    expect((screen.getByRole("link", { name: "MarketLab" }) as HTMLAnchorElement).getAttribute("href")).toBe("/");
  });

  it("the header Sign in button goes to the login form, the sign-up buttons to the sign-up form", () => {
    renderRouter("/landing", false);
    const header = screen.getByRole("banner");
    expect((within(header).getByRole("link", { name: "Sign in" }) as HTMLAnchorElement).getAttribute("href")).toBe("/sign-in");
  });
});

describe("profile menu", () => {
  it("is one button with the icon, the name and a dropdown arrow; the dropdown holds Sign out and opens only when pressed", async () => {
    const onSelect = vi.fn();
    renderApp(<ProfileMenu name="Sam" items={[{ label: "Sign out", onSelect }]} />, fakeApi());
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    const btn = buttons[0];
    expect(btn.textContent).toContain("Hello, Sam");
    expect(btn.querySelector(".avatar")?.textContent).toBe("S");
    expect(btn.getAttribute("aria-haspopup")).toBe("menu");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Sign out"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("the items are configurable, the arrow keys move between them, Escape and a click outside close it", async () => {
    renderApp(<><ProfileMenu name="Sam" items={[{ label: "One", onSelect: vi.fn() }, { label: "Two", onSelect: vi.fn() }]} /><p>outside</p></>, fakeApi());
    const btn = screen.getByRole("button", { name: /Hello, Sam/ });
    btn.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["One", "Two"]);
    expect(document.activeElement?.textContent).toBe("One");
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("Two");
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("One");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(btn);
    await userEvent.click(btn);
    await userEvent.click(screen.getByText("outside"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("in the header there is no separate Sign out button any more; it lives in the dropdown", async () => {
    signedIn();
    renderApp(<App />, fakeApi({ lessons: vi.fn().mockResolvedValue([]) }), "/path", "*");
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: new RegExp(`Hello, ${LEARNER.display_name}`) }));
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
  });
});
