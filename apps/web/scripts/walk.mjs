// Repeatable browser walk for MarketLab (Sprint 07, task 07_01 and 07_08).
//
//   npm run walk                     the 14-step learning walkthrough with mouse and keyboard
//   npm run walk -- --keyboard       steps 2 to 9 with the keyboard only (Tab, Shift+Tab, Enter, Space, arrows, typing); fails on any click
//   npm run walk -- --lab            the Strategy Lab walk (start a study, run rules, open the vault once)
//   npm run walk -- --lab --keyboard the same, keyboard only
//   npm run walk -- --lessons        the learning path: read a lesson with a demo, answer wrongly then rightly, follow the practice link
//   npm run walk -- --lessons --keyboard   the same, keyboard only
//   npm run walk -- --journal        indicators on the chart, a practice decision, the My decisions page
//   npm run walk -- --journal --keyboard   the same, keyboard only
//   npm run walk -- --status         the Data page: sources, coverage, freshness, checks, caveats, health
//   npm run walk -- --status --keyboard   the same, keyboard only
//   npm run walk -- --acceptance     one journey through the blueprint MVP criteria (see docs/05-acceptance/mvp-matrix.md)
//   npm run walk -- --acceptance --keyboard   the same, keyboard only
//
// Needs the three servers running (Python :8000, gateway :3000, web :5173). Uses the system Edge or Chrome
// (set BROWSER_PATH to choose). It creates throwaway learners named walk-xxxx in the real database and saves screenshots
// under data/reports/walk/ (git-ignored). The exit code is 1 if any step fails.
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const args = new Set(process.argv.slice(2));
const KEYBOARD = args.has("--keyboard");
const LAB = args.has("--lab");
const LESSONS = args.has("--lessons");
const JOURNAL = args.has("--journal");
const STATUS = args.has("--status");
const ACCEPTANCE = args.has("--acceptance");
const BASE = process.env.WEB_URL ?? "http://127.0.0.1:5173";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = path.join(ROOT, "data", "reports", "walk") + path.sep;
mkdirSync(OUT, { recursive: true });

const CANDIDATES = [
  process.env.BROWSER_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) { console.error("No Edge or Chrome found. Set BROWSER_PATH."); process.exit(2); }
console.log(`browser: ${executablePath}\nmode: ${ACCEPTANCE ? "acceptance" : LESSONS ? "lessons" : JOURNAL ? "journal" : STATUS ? "status" : LAB ? "lab" : "learning"}${KEYBOARD ? " + keyboard only" : ""}\n`);

const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1500 });
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(`console error: ${m.text().slice(0, 200)}`); });
page.on("pageerror", (e) => problems.push("pageerror: " + e.message.slice(0, 200)));
page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

// ---------------------------------------------------------------------------------------------- helpers
let clicks = 0;
const results = [];
async function step(n, name, fn) {
  const t0 = Date.now();
  try { const note = await fn(); results.push([n, name, "PASS", `${Date.now() - t0} ms`, note ?? ""]); }
  catch (e) { results.push([n, name, "FAIL", `${Date.now() - t0} ms`, String(e.message).slice(0, 220)]); await page.screenshot({ path: `${OUT}fail-${ACCEPTANCE ? "acceptance-" : LESSONS ? "lessons-" : JOURNAL ? "journal-" : STATUS ? "status-" : LAB ? "lab-" : ""}${n}.png` }).catch(() => {}); }
}
const text = async (sel = "body") => page.$eval(sel, (el) => el.innerText);
const waitText = (t, timeout = 20000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);
// case-insensitive: small labels such as "Step 1 of 5" are drawn in capitals by the style sheet
const waitTextI = (t, timeout = 20000) => page.waitForFunction((x) => document.body.innerText.toLowerCase().includes(x.toLowerCase()), { timeout }, t);
const shot = (name) => page.screenshot({ path: `${OUT}${ACCEPTANCE ? "acceptance-" : LESSONS ? "lessons-" : JOURNAL ? "journal-" : STATUS ? "status-" : LAB ? "lab-" : ""}${name}.png` });

/** A mouse click. In keyboard mode this is a failure: the walk must never need the mouse. */
async function mouse(handleOrSelector) {
  if (KEYBOARD) throw new Error("a mouse click was needed in keyboard-only mode");
  clicks++;
  const h = typeof handleOrSelector === "string" ? await page.$(handleOrSelector) : handleOrSelector;
  if (!h) throw new Error(`nothing to click: ${handleOrSelector}`);
  await h.click();
}
const buttonByLabel = async (label) => { const [h] = await page.$$(`xpath/.//button[normalize-space(.)="${label}"] | .//a[normalize-space(.)="${label}"] | .//summary[normalize-space(.)="${label}"]`); if (!h) throw new Error(`button not found: ${label}`); return h; };

/** Tab (never more than `max` presses) until the focused element satisfies `test`, which runs in the page. */
async function tabTo(test, arg, max = 140) {
  for (let i = 0; i < max; i++) {
    const hit = await page.evaluate(({ t, a }) => { const el = document.activeElement; return el && el !== document.body ? new Function("el", "a", `return (${t})(el, a)`)(el, a) : false; }, { t: test.toString(), a: arg });
    if (hit) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached: ${arg}`);
}
const isButton = (el, label) => (el.tagName === "BUTTON" || el.tagName === "A" || el.tagName === "SUMMARY") && el.innerText.trim() === label;
const isId = (el, id) => el.id === id;

/** Press a button or link: with the mouse, or by tabbing to it and pressing Enter (keyboard mode). */
async function press(label) {
  if (!KEYBOARD) return mouse(await buttonByLabel(label));
  await tabTo(isButton, label);
  await page.keyboard.press("Enter");
}
async function go(urlPath) {
  await page.goto(BASE + urlPath, { waitUntil: "networkidle0" });
  if (KEYBOARD) await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
}
async function typeInto(id, value) {
  if (KEYBOARD) await tabTo(isId, id); else await mouse(`#${id}`);
  await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
  await page.keyboard.type(value);
}

/** Accessibility tree check (not a screen-reader test): every control has a name, images have text alternatives. */
async function a11y(label) {
  const snap = await page.accessibility.snapshot({ interestingOnly: false });
  const need = new Set(["button", "link", "textbox", "combobox", "checkbox", "radio", "slider", "spinbutton", "searchbox", "img"]);
  const bad = [];
  (function walk(n) { if (!n) return; if (need.has(n.role) && !(n.name ?? "").trim()) bad.push(`${n.role} without a name`); (n.children ?? []).forEach(walk); })(snap);
  if (bad.length) throw new Error(`${label}: ${[...new Set(bad)].join(", ")}`);
  return `${label}: every control has a name`;
}

const name = "walk-" + Date.now().toString(36);
const PASSWORD = "a few random words here";

// ---------------------------------------------------------------------------------------------- shared: account and tour
async function createAccount() {
  await go("/sign-in?mode=register");   // plain /sign-in opens the login form
  await waitText("10 or more characters");
  await typeInto("name", name);
  await typeInto("password", PASSWORD);
  if (KEYBOARD) await page.keyboard.press("Enter"); else await press("Create account");
  await waitText("A quick tour");
}
async function skipTour() {
  await press("Skip the tour");
  await page.waitForFunction(() => !document.body.innerText.includes("A quick tour"));
}

// ---------------------------------------------------------------------------------------------- learning walk
async function learningWalk() {
  if (!KEYBOARD) {
    await step(1, "open the home page", async () => {
      await go("/");
      await waitText("Learn to doubt your own guesses");
      await shot("01-home");
    });
  }
  await step(2, "create an account", createAccount);
  await step(3, "take the whole tour with Next, ending with Got it", async () => {
    for (let i = 0; i < 14; i++) {
      const last = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "Got it"));
      if (last) break;
      await press("Next");
    }
    await press("Got it");
    await page.waitForFunction(() => !document.querySelector("[role=alertdialog]"), { timeout: 10000 });
  });
  await step(4, "the Tutorial button in the header opens the tour again, and Skip closes it", async () => {
    await press("Tutorial");
    await waitText("A quick tour");
    await press("Skip the tour");
    await page.waitForFunction(() => !document.querySelector("[role=alertdialog]"), { timeout: 10000 });
  });
  await step(5, "start a mixed episode", async () => {
    await go("/learn");
    if (KEYBOARD) {
      await tabTo(isId, "length");
      await page.keyboard.type("About s"); // type-ahead picks "About six months (120 days)"
    } else await page.select("#length", "120");
    await press("Start");
    await page.waitForFunction(() => /Day 60 of 120/.test(document.body.innerText), { timeout: 20000 });
    await page.waitForSelector("canvas", { timeout: 10000 });
    await shot("05-episode");
  });
  await step(6, "the page shows no name, dates or years", async () => {
    const body = await text();
    const bad = body.match(/\b(19|20)\d{2}-\d{2}-\d{2}\b|\b(200[5-9]|201\d|202[0-5])\b|\bAAPL\b|symbol/);
    if (bad) throw new Error("identity-like text on the page: " + bad[0]);
    return "no dates, years or tickers in the visible text";
  });
  await step(7, "send a guess (5 days ahead, 65%)", async () => {
    if (KEYBOARD) {
      await tabTo((el) => el.type === "radio" && el.name === "horizon" && el.checked, "horizon");
      await page.keyboard.press("ArrowRight"); // 1 day -> 5 days
    } else await mouse('input[name="horizon"][value="5"]');
    await typeInto("percent-number", "65");
    await waitText("6.5 out of 10");
    await press("Send my guess");
    await waitText("Waiting");
  });
  await step(8, "send the same guess again: it says it already exists", async () => {
    await press("Send my guess");
    await waitText("You already sent this guess");
  });
  await step(9, "move forward 5 days: the guess is answered", async () => {
    await press("5 days");
    await waitText("Answered", 20000);
    await waitText("One guess tells you almost nothing");
    await shot("09-answered");
    return (await text("table[aria-label='Your guesses']")).replace(/\s+/g, " ").slice(0, 120);
  });
  if (KEYBOARD) return;
  await step(10, "reload the page: the episode and the guess are still there", async () => {
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForFunction(() => /Day 65 of 120/.test(document.body.innerText) && /Answered/.test(document.body.innerText), { timeout: 20000 });
    return await a11y("episode screen");
  });
  await step(11, "finish: open the score", async () => {
    await press("Finish and see my score");
    await press("Show my score");
    await waitText("Your score");
    await waitText("Too few guesses");
    await shot("11-score");
    return await a11y("score screen");
  });
  await step(12, "reveal what it was", async () => {
    await press("Reveal what it was");
    await press("Yes, reveal it");
    await waitText("What this does not tell you");
    await shot("12-reveal");
    const t = await text();
    return t.includes("This was a real stock") ? "it was a real stock" : "it was a made-up chart";
  });
  await step(13, "open How does this work?", async () => {
    await go("/hood");
    await waitText("Is everything running?");
    await waitText("Front desk: running");
    await page.waitForFunction(() => /Moved the episode forward/.test(document.body.innerText), { timeout: 10000 });
    await shot("13-hood");
  });
  await step(14, "keyboard: Tab reaches the main controls on the start page", async () => {
    await go("/learn");
    const seen = new Set();
    for (let i = 0; i < 30; i++) { await page.keyboard.press("Tab"); seen.add(await page.evaluate(() => (document.activeElement?.innerText || document.activeElement?.id || document.activeElement?.tagName || "").trim().slice(0, 30))); }
    for (const need of ["Learn", "Start"]) if (![...seen].some((s) => s.includes(need))) throw new Error(`Tab never reached: ${need}`);
  });
}

// ---------------------------------------------------------------------------------------------- Strategy Lab walk
async function labWalk() {
  await step(1, "create an account", createAccount);
  await step(2, "skip the tour and open the Lab", async () => {
    await skipTour();
    await press("Lab");
    await waitText("What this is, and what it is not");
    await shot("01-lab-home");
  });
  await step(3, "pick a stock and start a study", async () => {
    await page.waitForSelector("#stock-search", { timeout: 20000 });
    await typeInto("stock-search", "AAPL");
    if (KEYBOARD) { await page.keyboard.press("Tab"); await page.keyboard.press("Enter"); }
    else await mouse(await (async () => { const [h] = await page.$$("xpath/.//button[contains(@class,'stock-btn')][.//span[normalize-space(.)='AAPL']]"); if (!h) throw new Error("AAPL not listed"); return h; })());
    await press("Start study");
    await waitText("AAPL study");
    await waitText("Vault locked");
  });
  await step(4, "run the default rule on the practice years", async () => {
    await press("Run on practice years");
    await waitText("What happened on the practice years", 60000);
    await waitText("What this does not tell you");
    await shot("04-lab-results");
  });
  await step(5, "the result shows both lines, the benchmark and no vault date", async () => {
    const body = await text();
    const bad = body.match(/\b(2022|2023|2024|2025|2026)\b|\d{4}-\d{2}-\d{2}/);
    if (bad) throw new Error("vault-era date on the page before the vault is opened: " + bad[0]);
    for (const need of ["Your rule", "Buy and hold", "Growth of 100 (log scale)", "What costs do to it", "Could this be luck?", "Ideas tried"]) if (!body.includes(need)) throw new Error(`missing: ${need}`);
    for (const banned of ["beats the market", "profit", "alpha", "guarantee"]) if (body.toLowerCase().includes(banned)) throw new Error(`banned word: ${banned}`);
    await page.waitForSelector("canvas");
    return await a11y("study page");
  });
  await step(6, "an invalid rule is refused next to the field and nothing is sent", async () => {
    await typeInto("fast", "200");
    await typeInto("slow", "50");
    await press("Run on practice years");
    await waitText("The short average must be shorter than the long average.");
  });
  await step(7, "run a second rule: it counts as a second idea", async () => {
    await typeInto("fast", "10");
    await typeInto("slow", "50");
    await press("Run on practice years");
    await page.waitForFunction(() => /2 ideas tried/.test(document.body.innerText), { timeout: 60000 });
    await shot("07-lab-two-ideas");
  });
  await step(8, "run the same rule again: it is not counted twice", async () => {
    await press("Run on practice years");
    await waitText("not counted again", 60000);
    if (!/2 ideas tried/.test(await text())) throw new Error("the repeat changed the count");
  });
  await step(9, "open the vault: cancel first, then confirm with OPEN", async () => {
    await press("Open the vault");
    await waitText("Open the vault?");
    const focused = await page.evaluate(() => document.activeElement?.innerText?.trim());
    if (focused !== "Cancel") throw new Error(`focus should start on Cancel, it is on: ${focused}`);
    await press("Cancel");
    await page.waitForFunction(() => !document.body.innerText.includes("Open the vault?"));
    await press("Open the vault");
    await waitText("Open the vault?");
    await typeInto("vault-confirm", "OPEN");
    await press("Open the vault now");
    await waitText("The vault is open", 90000);
    await shot("09-lab-vault-open");
  });
  await step(10, "the vault result compares practice and vault, and a reload shows the same", async () => {
    const t = await text();
    for (const need of ["Practice years and vault, side by side", "You tried 2 ideas before opening the vault."]) if (!t.includes(need)) throw new Error(`missing: ${need}`);
    await page.reload({ waitUntil: "networkidle0" });
    await waitText("The vault is open", 60000);
    return await a11y("vault screen");
  });
  await step(11, "the vault cannot be opened a second time", async () => {
    const t = await text();
    if (t.includes("Open the vault now")) throw new Error("the open button is still offered");
  });
}

// ---------------------------------------------------------------------------------------------- lessons walk
const COMPETITION = /\b(score|rank|points|level)\b/i;
async function chooseOption(optionText) {
  if (KEYBOARD) {
    // Tab reaches a radio group once; the arrow keys move inside it (the browser's own behaviour)
    const label = () => page.evaluate(() => document.activeElement?.closest?.("label")?.innerText.trim() ?? "");
    await tabTo((el) => el.type === "radio", "a radio option");
    for (let i = 0; i < 5 && (await label()) !== optionText; i++) await page.keyboard.press("ArrowDown");
    if ((await label()) !== optionText) throw new Error(`could not reach the option with the arrow keys: ${optionText}`);
    await page.keyboard.press("Space");
  } else {
    const [h] = await page.$$(`xpath/.//label[normalize-space(.)=${JSON.stringify(optionText)}]`);
    if (!h) throw new Error(`option not found: ${optionText}`);
    await mouse(h);
  }
}
const waitVerdict = (kind) => page.waitForSelector(`.verdict.${kind}`, { timeout: 20000 });
async function lessonsWalk() {
  await step(1, "create an account", createAccount);
  await step(2, "skip the tour: the path lists seven lessons and marks where to start", async () => {
    await skipTour();
    await waitText("Your learning path");
    const body = await text();
    for (const need of ["Start here", "Reading a candle chart", "Costs, buy and hold, and the vault", "private"]) if (!body.includes(need)) throw new Error(`missing: ${need}`);
    const count = await page.$$eval(".path > li", (els) => els.length);
    if (count !== 7) throw new Error(`expected 7 lessons, saw ${count}`);
    // the Brier lesson is about the score by name, so its title is taken out of the scan
    // the Brier lesson teaches the score by name, so its whole card is taken out of the scan
    const cards = await page.$$eval(".path > li", (els) => els.map((e) => e.innerText));
    const hit = cards.filter((_, i) => i !== 2).join(" ").match(COMPETITION);
    if (hit) throw new Error(`competition word on the path page: ${hit[0]}`);
    await shot("01-path");
    return await a11y("path page");
  });
  await step(3, "open lesson 2 and read it step by step", async () => {
    await go("/path/what-a-guess-means");
    await waitTextI("Step 1 of 5");
    await press("Next");
    await waitTextI("Step 2 of 5");
    await press("Back");
    await waitTextI("Step 1 of 5");
    await press("Next");
    await waitTextI("Step 2 of 5");
    await shot("03-lesson-step");
    return await a11y("lesson page");
  });
  await step(4, "the demo shows a sentence and another seed changes it", async () => {
    await waitText("What does 70% look like?");
    const before = (await text(".demo-result")).trim();
    if (!/\d+ of 20 went up\./.test(before)) throw new Error(`no result sentence: ${before}`);
    if (!(await text(".demo")).includes("made-up data")) throw new Error("the demo does not say made-up data");
    let changed = false;
    for (let i = 0; i < 6 && !changed; i++) {
      await press("Try another seed");
      changed = (await text(".demo-result")).trim() !== before;
    }
    if (!changed) throw new Error("six seeds gave the same picture");
  });
  await step(5, "read the other steps and go to the questions", async () => {
    for (const n of [3, 4, 5]) { await press("Next"); await waitTextI(`Step ${n} of 5`); }
    await press("Go to the questions");
    await waitText("Check your understanding");
    await waitTextI("Question 1 of 3");
  });
  await step(6, "a wrong answer says Not yet with a reason and nothing about the right option; then try again", async () => {
    await chooseOption("Never.");
    await press("Check my answer");
    await waitVerdict("notyet");
    const t = await text();
    if (t.includes("The right answer is")) throw new Error("the right option was shown after one wrong answer");
    if (!t.includes("100%")) throw new Error("no reason shown");
    await press("Try again");
  });
  await step(7, "the right answer says Right; the next question follows", async () => {
    await chooseOption("About 3 times.");
    await press("Check my answer");
    await waitVerdict("right");
    await press("Next question");
    await waitTextI("Question 2 of 3");
  });
  await step(8, "answer questions 2 and 3 rightly and finish", async () => {
    await chooseOption("Not by itself. One miss is normal.");
    await press("Check my answer"); await waitVerdict("right");
    await press("Next question"); await waitTextI("Question 3 of 3");
    await chooseOption("You have no view. It is the same as a coin flip.");
    await press("Check my answer"); await waitVerdict("right");
    await press("Finish the lesson");
    await waitText("Lesson finished");
    const hit = (await text()).match(COMPETITION);
    if (hit) throw new Error(`competition word on the lesson page: ${hit[0]}`);
    await shot("08-lesson-done");
  });
  await step(9, "the path shows the lesson as done and the practice link opens the guess game", async () => {
    await press("Back to the path");
    await waitText("Your learning path");
    const items = await page.$$eval(".path > li", (els) => els.map((e) => e.innerText));
    if (!/Done/.test(items[1])) throw new Error("lesson 2 is not marked Done");
    if (/Start here/.test(items[1])) throw new Error("Start here is still on a finished lesson");
    await go("/path/what-a-guess-means");
    await waitText("Lesson finished");
    await press("Practise in the guess game");
    await page.waitForFunction(() => location.pathname === "/learn", { timeout: 20000 });
  });
  await step(10, "a lesson shows its diagram and calculation, and can be marked complete by hand", async () => {
    await go("/path/brier-score");
    await waitTextI("Step 1 of 5");
    await press("Next");
    await page.waitForSelector("figure.visual svg[role=img], figure.visual table", { timeout: 20000 });
    const fig = await text("figure.visual");
    if (!/Score = \(guess − outcome\)²/.test(fig) || !fig.includes("0.81")) throw new Error("the Brier calculation is not shown");
    await press("Mark as complete");
    await waitText("Marked complete by you");
    await go("/path");
    await waitText("Your learning path");
    const items = await page.$$eval(".path > li", (els) => els.map((e) => e.innerText));
    if (!/Done/.test(items[2]) || !items[2].includes("Marked complete by you")) throw new Error("lesson 3 is not shown as done and marked by you");
    await go("/path/brier-score");
    await press("Mark as not complete");
    await waitText("You can mark a lesson complete yourself");
  });
}

// ---------------------------------------------------------------------------------------------- journal walk
async function chooseStance(label) {
  const readLabel = () => page.evaluate(() => document.activeElement?.closest?.("label")?.innerText.trim() ?? "");
  if (KEYBOARD) {
    await tabTo((el) => el.type === "radio" && el.name === "stance", "stance");
    for (let i = 0; i < 3 && (await readLabel()) !== label; i++) await page.keyboard.press("ArrowDown");
    if ((await readLabel()) !== label) throw new Error(`could not reach the stance: ${label}`);
    await page.keyboard.press("Space");
  } else {
    const [h] = await page.$$(`xpath/.//label[normalize-space(.)=${JSON.stringify(label)}]`);
    if (!h) throw new Error(`stance not found: ${label}`);
    await mouse(h);
  }
}
async function journalWalk() {
  await step(1, "create an account", createAccount);
  await step(2, "skip the tour and start a 120-day episode", async () => {
    await skipTour();
    await go("/learn");
    if (KEYBOARD) {
      await tabTo(isId, "length");
      await page.keyboard.type("About s");
    } else await page.select("#length", "120");
    await press("Start");
    await page.waitForFunction(() => /Day 60 of 120/.test(document.body.innerText), { timeout: 20000 });
    await shot("02-episode");
  });
  await step(3, "switch on the 20-day average: it is pressed, explained, and its numbers are in a table", async () => {
    await press("20-day average");
    await page.waitForFunction(() => document.querySelector('button[aria-pressed="true"]')?.innerText.trim() === "20-day average", { timeout: 20000 });
    await waitText("None of these numbers is a forecast.");
    await waitText("The 20-day average is the mean of the last 20 closing prices.");
    await press("Show the numbers");
    await page.waitForFunction(() => document.querySelector("details[open] table[aria-label*='20-day average']") && document.querySelectorAll("table[aria-label*='20-day average'] tbody tr").length === 10, { timeout: 20000 });
    const last = await page.$$eval("table[aria-label*='20-day average'] tbody tr td:first-child", (els) => els.map((e) => Number(e.innerText)).at(-1));
    if (last !== 60) throw new Error(`the last day in the table is ${last}, not 60`);
  });
  await step(4, "switch on the RSI: a panel with a text alternative appears", async () => {
    await press("RSI (14 days)");
    await page.waitForSelector("[data-testid='rsi-chart']", { timeout: 20000 });
    const label = await page.$eval("[data-testid='rsi-chart']", (e) => e.getAttribute("aria-label"));
    if (!/RSI panel/.test(label)) throw new Error("the RSI panel has no text alternative");
    return await a11y("episode with indicators");
  });
  await step(5, "record a practice decision with a reason: it is saved and waits for the next day", async () => {
    await chooseStance("Hold the stock (long)");
    await typeInto("decision-reason", "The price has stayed above its average.");
    await press("Record my decision");
    await waitText("Saved for day 60. The result appears after the next day.");
    await shot("05-decision-saved");
  });
  await step(6, "a second decision on the same day is refused in plain words", async () => {
    await typeInto("decision-reason", "Trying again on the same day.");
    await press("Record my decision");
    await waitText("already recorded a decision for this day");
  });
  await step(7, "move one day on, then the journal shows the reason and a result in words", async () => {
    await press("Next day");
    await page.waitForFunction(() => /Day 61 of 120/.test(document.body.innerText), { timeout: 20000 });
    await go("/journal");
    await waitText("The price has stayed above its average.");
    await waitText("after costs");
    const t = await text();
    for (const bad of [/win rate/i, /\b(score|rank|points|level)\b/i, /you should/i]) if (bad.test(t)) throw new Error(`banned wording on the journal: ${bad}`);
    if (!t.includes("1 decision. That is far too few to say anything.")) throw new Error("the count line is missing");
    await shot("07-journal");
    return await a11y("journal page");
  });
}

// ---------------------------------------------------------------------------------------------- status walk
async function statusWalk() {
  await step(1, "create an account", createAccount);
  await step(2, "skip the tour and open the Data page from the top bar", async () => {
    await skipTour();
    await press("Data");
    await waitText("Where the data come from");
    await waitText("What the data cannot tell you");
    await shot("02-status");
  });
  await step(3, "the sources table, coverage and freshness are there, with numbers", async () => {
    await page.waitForSelector("table[aria-label='Data sources'] tbody tr", { timeout: 20000 });
    const first = await page.$$eval("table[aria-label='Data sources'] tbody tr:first-child td", (els) => els.map((e) => e.innerText));
    if (first.length !== 6 || !/\d/.test(first[1]) || !/\d{4}-\d{2}-\d{2}/.test(first[3])) throw new Error(`unexpected first row: ${first.join(" | ")}`);
    const t = await text();
    for (const need of ["What is covered", "How fresh it is", "Checks that ran"]) if (!t.includes(need)) throw new Error(`missing: ${need}`);
  });
  await step(4, "the caveats are always shown and the page never says the data are clean", async () => {
    const t = await text();
    for (const need of ["survivorship bias", "one free vendor feed", "licensed for private learning", "not investment advice"]) if (!t.toLowerCase().includes(need.toLowerCase())) throw new Error(`missing caveat: ${need}`);
    if (/all checks passed|data are clean|guarantee/i.test(t)) throw new Error("the page overclaims");
  });
  await step(5, "the health card names each part in words", async () => {
    await waitText("Is MarketLab working now?");
    await waitText("Number service: Working");
    return await a11y("status page");
  });
}

// ---------------------------------------------------------------------------------------------- acceptance walk
// One journey through the blueprint's MVP criteria (docs/05-acceptance/mvp-matrix.md). Items 1 to 10 map to steps 2 to 10 here.
async function acceptanceWalk() {
  await step(1, "MVP 1: register and reach the learning area", async () => {
    await createAccount();
    await skipTour();
    await waitText("Your learning path");
  });
  await step(2, "MVP 2: complete a market-fundamentals lesson (read every step, answer the questions)", async () => {
    await go("/path/reading-candles");
    await waitTextI("Step 1 of 5");
    for (let n = 2; n <= 5; n++) { await press("Next"); await waitTextI(`Step ${n} of 5`); }
    await press("Go to the questions");
    const answers = ["The price fell.", "The highest and lowest price of the day.", "No. A chart shows the past only."];
    for (const [i, a] of answers.entries()) {
      await chooseOption(a);
      await press("Check my answer");
      await waitVerdict("right");
      await press(i === 2 ? "Finish the lesson" : "Next question");
    }
    await waitText("Lesson finished");
  });
  await step(3, "MVP 3: search a supported US stock", async () => {
    await go("/lab");
    await page.waitForSelector("#stock-search", { timeout: 20000 });
    await typeInto("stock-search", "AAPL");
    await page.waitForFunction(() => [...document.querySelectorAll(".stock-btn")].some((b) => b.innerText.includes("AAPL")), { timeout: 20000 });
  });
  await step(4, "MVP 4 and 5: view historical candles and inspect an indicator", async () => {
    await go("/learn");
    if (KEYBOARD) { await tabTo(isId, "length"); await page.keyboard.type("About s"); } else await page.select("#length", "120");
    await press("Start");
    await page.waitForFunction(() => /Day 60 of 120/.test(document.body.innerText), { timeout: 20000 });
    await page.waitForSelector("canvas", { timeout: 20000 });
    await press("20-day average");
    await page.waitForFunction(() => document.querySelector('button[aria-pressed="true"]')?.innerText.trim() === "20-day average", { timeout: 20000 });
    await waitText("None of these numbers is a forecast.");
  });
  await step(5, "MVP 6: replay a period one day at a time with no real symbol or date shown", async () => {
    await press("Next day");
    await page.waitForFunction(() => /Day 61 of 120/.test(document.body.innerText), { timeout: 20000 });
    const t = await text("main");
    if (/\b(19|20)\d{2}\b/.test(t) || /\b[A-Z]{2,5}\b(?= stock)/.test(t) || /\d{4}-\d{2}-\d{2}/.test(t)) throw new Error("a year, date or symbol is visible before the reveal");
  });
  await step(6, "MVP 7: record a simulated trading decision with a reason", async () => {
    await chooseStance("Hold the stock (long)");
    await typeInto("decision-reason", "The price has stayed above its average.");
    await press("Record my decision");
    await waitText("Saved for day 61.");
  });
  await step(7, "MVP 8 and 9: run a reproducible backtest and read results, costs and risk", async () => {
    await go("/lab");
    await page.waitForSelector("#stock-search", { timeout: 20000 });
    await typeInto("stock-search", "AAPL");
    if (KEYBOARD) { await page.keyboard.press("Tab"); await page.keyboard.press("Enter"); }
    else await mouse(await (async () => { const [h] = await page.$$("xpath/.//button[contains(@class,'stock-btn')][.//span[normalize-space(.)='AAPL']]"); if (!h) throw new Error("AAPL not listed"); return h; })());
    await press("Start study");
    await waitText("AAPL study");
    await press("Run on practice years");
    await waitText("What happened on the practice years", 60000);
    const t = await text();
    for (const need of ["Your rule", "Buy and hold", "What costs do to it", "Could this be luck?", "Ideas tried", "Worst fall"]) if (!t.includes(need)) throw new Error(`missing: ${need}`);
    await press("Run on practice years");
    await waitText("not counted again", 60000);   // the same rule gives the same numbers and counts once
  });
  await step(8, "MVP 10: inspect the source, coverage and quality status of the data", async () => {
    await go("/status");
    await waitText("Where the data come from");
    await page.waitForSelector("table[aria-label='Data sources'] tbody tr", { timeout: 20000 });
    const t = await text();
    for (const need of ["Checks that ran", "survivorship bias", "licensed for private learning"]) if (!t.toLowerCase().includes(need.toLowerCase())) throw new Error(`missing: ${need}`);
  });
  await step(9, "engineering: the request id is on every reply and the metrics route is closed to a learner", async () => {
    const info = await page.evaluate(async () => {
      const s = JSON.parse(sessionStorage.getItem("marketlab.session"));
      const r = await fetch("http://127.0.0.1:3000/me", { headers: { authorization: `Bearer ${s.token}` } });
      const m = await fetch("http://127.0.0.1:3000/metrics", { headers: { authorization: `Bearer ${s.token}` } });
      return { id: r.headers.get("x-request-id"), metrics: m.status };
    });
    if (!/^[0-9a-f-]{36}$/.test(info.id ?? "")) throw new Error("no request id header");
    if (info.metrics !== 401) throw new Error(`a learner token opened /metrics (${info.metrics})`);
  });
}

if (ACCEPTANCE) await acceptanceWalk(); else if (STATUS) await statusWalk(); else if (JOURNAL) await journalWalk(); else if (LESSONS) await lessonsWalk(); else if (LAB) await labWalk(); else await learningWalk();

const failed = results.filter((r) => r[2] === "FAIL").length;
console.log(results.map((r) => r.join(" | ")).join("\n"));
console.log(`\nmouse clicks: ${clicks}${KEYBOARD ? " (must be 0 in keyboard mode)" : ""}`);
if (KEYBOARD && clicks !== 0) results.push(["-", "no mouse clicks in keyboard mode", "FAIL", "", String(clicks)]);
console.log("browser problems:", problems.length ? "\n  " + [...new Set(problems)].join("\n  ") : "none");
await browser.close();
process.exit(failed || (KEYBOARD && clicks) ? 1 : 0);
