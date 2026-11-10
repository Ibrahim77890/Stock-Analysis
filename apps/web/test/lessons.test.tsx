import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import { lessons } from "../src/copy/lessons";
import { LessonPage } from "../src/lessons/LessonPage";
import { PathPage, lessonState, nextLesson } from "../src/lessons/PathPage";
import { fakeApi, renderApp, signedIn } from "./helpers";
import { lessonDetail, PATH, right, summary, wrong } from "./lessonFixtures";

const LESSON = "/path/what-a-guess-means";
const renderLesson = (api: any) => renderApp(<LessonPage />, api, LESSON, "/path/:slug");
const readApi = () => vi.fn().mockImplementation(async (_s: string, n: number) => ({ lesson_slug: "x", step: n, steps_read: n, steps_total: 3 }));

describe("learning path", () => {
  it("shows six lessons in order with progress lines, a state chip each, and Start here on the first unfinished one", async () => {
    signedIn();
    renderApp(<PathPage />, fakeApi({ lessons: vi.fn().mockResolvedValue(PATH) }), "/path");
    expect(await screen.findByRole("heading", { name: lessons.pathTitle })).toBeTruthy();
    const items = screen.getAllByRole("listitem").filter((li) => li.querySelector("h2"));
    expect(items).toHaveLength(6);
    expect(within(items[0]).getByText("Done")).toBeTruthy();
    expect(within(items[1]).getByText("In progress")).toBeTruthy();
    expect(within(items[2]).getByText("Not started")).toBeTruthy();
    expect(within(items[1]).getByText(lessons.startHere)).toBeTruthy();
    expect(screen.getAllByText(lessons.startHere)).toHaveLength(1);
    expect(within(items[1]).getByText("2 of 5 steps, 1 of 3 questions")).toBeTruthy();
    expect(screen.getByText(lessons.privacy)).toBeTruthy();
  });

  it("the progress bar equals the numbers from the gateway (reconciliation)", async () => {
    signedIn();
    renderApp(<PathPage />, fakeApi({ lessons: vi.fn().mockResolvedValue(PATH) }), "/path");
    const bars = await screen.findAllByRole("progressbar");
    expect(bars).toHaveLength(6);
    expect(bars[1].getAttribute("aria-valuenow")).toBe("3"); // 2 steps + 1 question
    expect(bars[1].getAttribute("aria-valuemax")).toBe("8");
    expect(bars[0].getAttribute("aria-valuenow")).toBe("8");
  });

  it("state and next-lesson rules", () => {
    expect(lessonState(summary())).toBe("notStarted");
    expect(lessonState(summary({ steps_read: 1 }))).toBe("inProgress");
    expect(lessonState(summary({ done: true }))).toBe("done");
    expect(nextLesson(PATH)).toBe("what-a-guess-means");
    expect(nextLesson(PATH.map((l) => ({ ...l, done: true })))).toBeNull();
  });

  it("a network failure shows a plain message", async () => {
    signedIn();
    renderApp(<PathPage />, fakeApi({ lessons: vi.fn().mockRejectedValue(new ApiError(0, "MarketLab cannot reach its server. Is it running?")) }), "/path");
    expect((await screen.findByRole("alert")).textContent).toMatch(/cannot reach/);
  });
});

describe("lesson page: steps", () => {
  it("steps forward and back, marks each step once, and keeps the glossary marker working", async () => {
    signedIn();
    const lessonRead = readApi();
    renderLesson(fakeApi({ lesson: vi.fn().mockResolvedValue(lessonDetail()), lessonRead }));
    expect(await screen.findByText("Step 1 of 3")).toBeTruthy();
    await waitFor(() => expect(lessonRead).toHaveBeenCalledTimes(1));
    expect(lessonRead).toHaveBeenLastCalledWith("what-a-guess-means", 1);
    expect(screen.getByRole("button", { name: "guess" })).toBeTruthy(); // marker became a term button
    await userEvent.click(screen.getByRole("button", { name: lessons.next }));
    expect(await screen.findByText("Step 2 of 3")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: lessons.back }));
    await userEvent.click(screen.getByRole("button", { name: lessons.next }));
    await userEvent.click(screen.getByRole("button", { name: lessons.next }));
    expect(await screen.findByText("Step 3 of 3")).toBeTruthy();
    expect(lessonRead.mock.calls.map((c) => c[1])).toEqual([1, 2, 3]); // each step once, though step 2 was shown twice
    expect(screen.getByRole("progressbar", { name: lessons.stepsBar }).getAttribute("aria-valuenow")).toBe("3");
  });

  it("Back is disabled on the first step; the more text is hidden until asked for; the demo shows on its step", async () => {
    signedIn();
    renderLesson(fakeApi({ lesson: vi.fn().mockResolvedValue(lessonDetail()), lessonRead: readApi() }));
    await screen.findByText("Step 1 of 3");
    expect((screen.getByRole("button", { name: lessons.back }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: lessons.next }));
    expect(screen.queryByText("This is extra detail.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: lessons.showMore }));
    expect(screen.getByText("This is extra detail.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "What does 70% look like?" })).toBeTruthy();
  });

  it("a lesson with steps already read starts at the first unread step, and does not mark read steps again", async () => {
    signedIn();
    const lessonRead = readApi();
    renderLesson(fakeApi({ lesson: vi.fn().mockResolvedValue(lessonDetail({ steps_read_list: [1, 2], steps_read: 2 })), lessonRead }));
    expect(await screen.findByText("Step 3 of 3")).toBeTruthy();
    await waitFor(() => expect(lessonRead).toHaveBeenCalledTimes(1));
    expect(lessonRead).toHaveBeenCalledWith("what-a-guess-means", 3);
  });

  it("an unknown lesson shows a plain message and a link back to the path", async () => {
    signedIn();
    renderLesson(fakeApi({ lesson: vi.fn().mockRejectedValue(new ApiError(404, "That lesson was not found.")) }));
    expect((await screen.findByRole("alert")).textContent).toBe(lessons.notFound);
    expect((screen.getByRole("link", { name: lessons.toPath }) as HTMLAnchorElement).getAttribute("href")).toBe("/path");
  });

  it("a failed mark-as-read keeps the page usable and shows a plain message", async () => {
    signedIn();
    const lessonRead = vi.fn().mockRejectedValue(new ApiError(0, "MarketLab cannot reach its server. Is it running?"));
    renderLesson(fakeApi({ lesson: vi.fn().mockResolvedValue(lessonDetail()), lessonRead }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/cannot reach/);
    expect((screen.getByRole("button", { name: lessons.next }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("lesson page: questions", () => {
  const goToQuestions = async (api: any) => {
    renderLesson(api);
    await screen.findByText("Step 1 of 3");
    for (let i = 0; i < 2; i++) await userEvent.click(screen.getByRole("button", { name: lessons.next }));
    await userEvent.click(screen.getByRole("button", { name: new RegExp(lessons.toQuestions) }));
  };

  it("never shows the right option before the server sends it: a first wrong answer shows only the explanation", async () => {
    signedIn();
    const lessonAnswer = vi.fn().mockResolvedValue(wrong("Only 100% means never wrong."));
    await goToQuestions(fakeApi({ lesson: vi.fn().mockResolvedValue(lessonDetail()), lessonRead: readApi(), lessonAnswer }));
    expect(screen.getByRole("group", { name: /You say 70% ten times/ })).toBeTruthy();
    await userEvent.click(screen.getByRole("radio", { name: "Never" }));
    await userEvent.click(screen.getByRole("button", { name: lessons.check }));
    expect(await screen.findByText(lessons.notYet)).toBeTruthy();
    expect(screen.getByText("Only 100% means never wrong.")).toBeTruthy();
    expect(screen.queryByText(/The right answer is/)).toBeNull();
    expect(lessonAnswer).toHaveBeenCalledWith("what-a-guess-means", 1, 1);
    expect(document.body.textContent).not.toMatch(/shame|wrong again|failed|you lost/i);
  });

  it("shows the right option when the server sends it, lets the learner try again, then goes on after a right answer", async () => {
    signedIn();
    const lessonAnswer = vi.fn()
      .mockResolvedValueOnce(wrong("Only 100% means never wrong.", { wrong_so_far: 2, correct_option: 0 }))
      .mockResolvedValueOnce(right());
    await goToQuestions(fakeApi({ lesson: vi.fn().mockResolvedValue(lessonDetail()), lessonRead: readApi(), lessonAnswer }));
    await userEvent.click(screen.getByRole("radio", { name: "About 7 times" }));
    await userEvent.click(screen.getByRole("button", { name: lessons.check }));
    expect(await screen.findByText("The right answer is: About 3 times")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: lessons.tryAgain }));
    expect(screen.queryByText(lessons.notYet)).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "About 3 times" }));
    await userEvent.click(screen.getByRole("button", { name: lessons.check }));
    expect(await screen.findByText(lessons.right)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: lessons.nextQuestion }));
    expect(screen.getByText(lessons.questionOf(2, 2))).toBeTruthy();
  });

  it("a double click on Check my answer sends one request", async () => {
    signedIn();
    let resolve!: (v: any) => void;
    const lessonAnswer = vi.fn().mockImplementation(() => new Promise((r) => { resolve = r; }));
    await goToQuestions(fakeApi({ lesson: vi.fn().mockResolvedValue(lessonDetail()), lessonRead: readApi(), lessonAnswer }));
    await userEvent.click(screen.getByRole("radio", { name: "Never" }));
    const button = screen.getByRole("button", { name: lessons.check });
    await userEvent.dblClick(button);
    expect(lessonAnswer).toHaveBeenCalledTimes(1);
    resolve(wrong());
    await screen.findByText(lessons.notYet);
  });

  it("the check button is disabled until an option is chosen", async () => {
    signedIn();
    await goToQuestions(fakeApi({ lesson: vi.fn().mockResolvedValue(lessonDetail()), lessonRead: readApi(), lessonAnswer: vi.fn() }));
    expect((screen.getByRole("button", { name: lessons.check }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a 429 shows the server wait message and keeps the question usable; a network error is plain", async () => {
    signedIn();
    const lessonAnswer = vi.fn()
      .mockRejectedValueOnce(new ApiError(429, "You are going a little fast. Please wait 12 seconds before the next answer."))
      .mockRejectedValueOnce(new ApiError(0, "MarketLab cannot reach its server. Is it running?"));
    await goToQuestions(fakeApi({ lesson: vi.fn().mockResolvedValue(lessonDetail()), lessonRead: readApi(), lessonAnswer }));
    await userEvent.click(screen.getByRole("radio", { name: "Never" }));
    await userEvent.click(screen.getByRole("button", { name: lessons.check }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/wait 12 seconds/);
    await userEvent.click(screen.getByRole("button", { name: lessons.check }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/cannot reach/));
    expect((screen.getByRole("button", { name: lessons.check }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("finishing offers the practice screen: Learn for lessons 1 to 4, Lab for 5 and 6", async () => {
    signedIn();
    for (const [position, href] of [[2, "/learn"], [5, "/lab"]] as const) {
      const lessonAnswer = vi.fn().mockResolvedValue(right());
      const detail = lessonDetail({ position, questions: [lessonDetail().questions[0]], questions_total: 1 });
      const { unmount } = renderApp(<LessonPage />, fakeApi({ lesson: vi.fn().mockResolvedValue(detail), lessonRead: readApi(), lessonAnswer }), LESSON, "/path/:slug");
      await screen.findByText("Step 1 of 3");
      for (let i = 0; i < 2; i++) await userEvent.click(screen.getByRole("button", { name: lessons.next }));
      await userEvent.click(screen.getByRole("button", { name: new RegExp(lessons.toQuestions) }));
      await userEvent.click(screen.getByRole("radio", { name: "About 3 times" }));
      await userEvent.click(screen.getByRole("button", { name: lessons.check }));
      await userEvent.click(await screen.findByRole("button", { name: lessons.finishLesson }));
      const link = await screen.findByRole("link", { name: new RegExp(position <= 4 ? lessons.practiceLearn : lessons.practiceLab) });
      expect(link.getAttribute("href")).toBe(href);
      expect(screen.getByText(lessons.doneBody)).toBeTruthy();
      unmount();
    }
  });
});

describe("keyboard and wording", () => {
  it("a lesson can be read and answered with the keyboard only", async () => {
    signedIn();
    const lessonAnswer = vi.fn().mockResolvedValue(right());
    renderLesson(fakeApi({ lesson: vi.fn().mockResolvedValue(lessonDetail({ questions: [lessonDetail().questions[0]], questions_total: 1 })), lessonRead: readApi(), lessonAnswer }));
    await screen.findByText("Step 1 of 3");
    const user = userEvent.setup();
    const press = async (name: RegExp | string) => {
      for (let i = 0; i < 40 && !(document.activeElement && (document.activeElement.textContent ?? "").match(name instanceof RegExp ? name : new RegExp(`^${name}$`))); i++) await user.tab();
      expect(document.activeElement?.textContent).toMatch(name instanceof RegExp ? name : new RegExp(`^${name}$`));
      await user.keyboard("{Enter}");
    };
    await press(lessons.next);
    await press(lessons.next);
    await press(new RegExp(lessons.toQuestions));
    const radio = await screen.findByRole("radio", { name: "About 3 times" });
    radio.focus();
    await user.keyboard(" ");
    await press(lessons.check);
    expect(await screen.findByText(lessons.right)).toBeTruthy();
  });

  it("no lesson screen text says score, rank, points or level (negative scan of the copy and a rendered page)", async () => {
    const own = JSON.stringify(lessons).replace(/"/g, " ");
    expect(own).not.toMatch(/\b(score|scores|rank|ranks|points|level|levels|leaderboard|badge)\b/i);
    signedIn();
    renderLesson(fakeApi({ lesson: vi.fn().mockResolvedValue(lessonDetail()), lessonRead: readApi() }));
    await screen.findByText("Step 1 of 3");
    expect(document.body.textContent).not.toMatch(/\b(score|rank|points|level)\b/i);
    // the scan really finds such words (negative control)
    expect("Your level is 3 points".match(/\b(score|rank|points|level)\b/i)).not.toBeNull();
  });

  it("no hard-coded colours in src/lessons", () => {
    const dir = path.resolve(__dirname, "../src/lessons");
    const files: string[] = [];
    const walk = (d: string) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else files.push(p); } };
    walk(dir);
    for (const f of files) expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});
