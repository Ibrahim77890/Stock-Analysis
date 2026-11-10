# Testing accessibility: keyboard, the accessibility tree and screen readers

**Sprint:** 08    **Used by tasks:** 08_01, 08_05, 08_07

## Why this matters for MarketLab
The product is for beginners, and some beginners use a keyboard or a screen reader. Sprint 07 added a keyboard-only browser walk and an accessibility-tree check, but nobody has listened to a screen reader or watched a stranger use the app (still pending). The lessons are mostly text and small controls, so they are the place where this matters most.

## Plain-language explanation
Three levels of check, from cheap to costly:
1. **Automated structure checks.** A script reads the browser's accessibility tree and asserts that every control has a name and every image has a text alternative. It catches missing labels quickly; it cannot tell whether the names make sense.
2. **Keyboard-only runs.** A script (or a person) completes the task with Tab, Shift+Tab, Enter, Space, arrows and typing. It catches controls that cannot be reached or operated without a mouse, and focus traps.
3. **Screen reader and real users.** A person listens with a screen reader such as the free NVDA on Windows, or watches someone who has never seen the app. This finds confusing order, unclear names and words nobody understands.

Example: a button drawn only as an icon has no name in the tree; the script fails. A dialog that does not return focus when closed passes the structure check but fails the keyboard run when the next Tab goes to the top of the page.

## Key terms
- accessibility tree: the browser's list of the page's elements with roles, names and states, which assistive technology reads.
- accessible name: the text a screen reader announces for a control (from its label, text or `aria-label`).
- focus order: the order in which Tab moves through controls.
- screen reader: software that reads the screen aloud.
- text alternative: words that describe an image or chart.

## Common mistakes / pitfalls
- Treating a passing accessibility-tree check as a screen-reader test.
- `aria-label` text that differs from the visible text (voice control users say what they see).
- Removing the focus outline.
- A custom widget (slider, dialog) without the keyboard behaviour users expect; follow the patterns in the ARIA Authoring Practices Guide.
- Announcing live updates too often.
- Testing only the happy path; test the error and the empty states too.

## What to implement in this domain
- Extend `apps/web/scripts/walk.mjs` with a `--lessons` walk (keyboard-only variant included) that opens a lesson, reads the steps, answers one question wrongly and then rightly, and runs the accessibility-tree check on each page.
- A written script for a person-run session (30 minutes, 14 plus lesson steps) and a place to record hesitations; do the NVDA listening on the score screen and one lesson.
- Record results honestly: what was tested, by whom, what was not.

## How to check you understood
1. What can the accessibility-tree check not tell you? (Whether names make sense, or how the page sounds.)
2. Why run the walk with the keyboard only? (To find controls that need a mouse.)
3. Where do real hesitations show up? (With a person who did not build the app.)

## References
- [W3C: ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/): patterns and keyboard interaction for common widgets (home page opened 2026-11-09).
- [WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/): success criteria including keyboard access and text alternatives (read in Sprint 06).
- [NVDA user guide](https://download.nvaccess.org/documentation/userGuide.html): the free Windows screen reader (the older link redirects here; the page itself was not opened).
- MarketLab `docs/02-domain/learning-walkthrough.md` and `apps/web/scripts/walk.mjs`.
