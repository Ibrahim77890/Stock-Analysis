// Accessibility self-check of the ten main screens (Sprint 11, task 11_07). NOT a conformance claim and not a screen-reader test.
//   npm run a11y            needs the three servers running; prints a table and writes data/reports/a11y.json
// Checks per screen: page language and title, one h1, headings that do not skip a level, a main landmark, a name for every
// control and image, a label for every field, visible focus on the first 12 Tab stops, no sideways scrolling at 320 px wide
// (about 400% zoom of a 1280 px screen), and no text smaller than 12 px.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const BASE = process.env.WEB_URL ?? "http://127.0.0.1:5173";
const GATEWAY = process.env.GATEWAY_URL ?? "http://127.0.0.1:3000";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CANDIDATES = [process.env.BROWSER_PATH, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) { console.error("No Edge or Chrome found. Set BROWSER_PATH."); process.exit(2); }

const name = "a11y-" + Date.now().toString(36);
const reg = await (await fetch(GATEWAY + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ display_name: name, password: "an accessibility check password" }) })).json();
const H = { "content-type": "application/json", authorization: `Bearer ${reg.token}` };
const ep = await (await fetch(GATEWAY + "/episodes", { method: "POST", headers: H, body: JSON.stringify({ kind: "synthetic", n_bars: 120, initial_visible: 60, seed: 9 }) })).json();
const study = await (await fetch(GATEWAY + "/lab/studies", { method: "POST", headers: H, body: JSON.stringify({ symbol: "AAPL" }) })).json();

const SCREENS = [
  ["Home (signed in)", "/"], ["Sign in", "/sign-in"], ["Path", "/path"], ["Lesson", "/path/what-a-guess-means"], ["Learn", "/learn"],
  ["Episode", `/learn/${ep.episode_id}`], ["Lab", "/lab"], ["Lab study", `/lab/${study.study_id}`], ["My decisions", "/journal"], ["Data", "/status"],
  ["Words", "/glossary"], ["My progress", "/progress"],
];

const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.evaluateOnNewDocument((s) => {
  sessionStorage.setItem("marketlab.session", JSON.stringify(s));
  sessionStorage.setItem("marketlab.tour.seen", "1");
}, { token: reg.token, learner: reg.learner });

const results = [];
for (const [title, url] of SCREENS) {
  const problems = [];
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(BASE + url, { waitUntil: "networkidle0", timeout: 60000 });
  const facts = await page.evaluate(() => {
    const out = {};
    out.lang = document.documentElement.lang;
    out.title = document.title;
    const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => Number(h.tagName[1]));
    out.h1 = hs.filter((n) => n === 1).length;
    out.skips = hs.some((n, i) => i > 0 && n - hs[i - 1] > 1);
    out.main = Boolean(document.querySelector("main"));
    out.smallText = [...document.querySelectorAll("body *")].filter((e) => e.childNodes.length && [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 12).length;
    out.unlabelled = [...document.querySelectorAll("input:not([type=hidden]),select,textarea")].filter((e) => !(e.labels && e.labels.length) && !e.getAttribute("aria-label") && !e.getAttribute("aria-labelledby")).map((e) => e.id || e.name || e.type);
    return out;
  });
  if (!facts.lang) problems.push("no page language");
  if (!facts.title) problems.push("no page title");
  if (facts.h1 !== 1) problems.push(`${facts.h1} h1 headings (needs 1)`);
  if (facts.skips) problems.push("a heading level is skipped");
  if (!facts.main) problems.push("no main landmark");
  if (facts.smallText) problems.push(`${facts.smallText} text elements under 12 px`);
  if (facts.unlabelled.length) problems.push(`fields without a label: ${facts.unlabelled.join(", ")}`);
  const snap = await page.accessibility.snapshot({ interestingOnly: false });
  const need = new Set(["button", "link", "textbox", "combobox", "checkbox", "radio", "slider", "spinbutton", "searchbox", "img", "tab", "switch"]);
  const unnamed = [];
  (function walk(n) { if (!n) return; if (need.has(n.role) && !(n.name ?? "").trim()) unnamed.push(n.role); (n.children ?? []).forEach(walk); })(snap);
  if (unnamed.length) problems.push(`controls without a name: ${[...new Set(unnamed)].join(", ")}`);
  // visible focus on the first 12 Tab stops
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  let invisible = 0, stops = 0;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
      const shadow = cs.boxShadow && cs.boxShadow !== "none";
      return { visible: outline || shadow, label: (el.innerText || el.getAttribute("aria-label") || el.id || el.tagName).slice(0, 30) };
    });
    if (!r) continue;
    stops++;
    if (!r.visible) { invisible++; problems.push(`no visible focus on: ${r.label}`); }
  }
  // reflow at 320 px
  await page.setViewport({ width: 320, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) problems.push(`sideways scrolling at 320 px (${overflow} px too wide)`);
  results.push({ screen: title, url, tab_stops_checked: stops, invisible_focus: invisible, problems });
}
await browser.close();

mkdirSync(path.join(ROOT, "data", "reports"), { recursive: true });
writeFileSync(path.join(ROOT, "data", "reports", "a11y.json"), JSON.stringify(results, null, 2));
for (const r of results) console.log(`${r.problems.length ? "FAIL" : "PASS"} | ${r.screen} | tab stops ${r.tab_stops_checked} | ${r.problems.join("; ") || "no problems found"}`);
const failed = results.filter((r) => r.problems.length).length;
console.log(`\n${results.length - failed} of ${results.length} screens had no problems in these checks.`);
process.exit(failed ? 1 : 0);
