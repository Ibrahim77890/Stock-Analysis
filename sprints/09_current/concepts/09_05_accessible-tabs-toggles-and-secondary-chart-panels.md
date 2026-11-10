# Accessible toggles, tabs and secondary chart panels

**Used by tasks:** 09_05, 09_06

## What it is
Indicator controls (show the 20-day average, show RSI) are toggles; a journal and a chart on one page may use tabs. The WAI-ARIA Authoring Practices describe the keyboard behaviour users expect: Tab reaches the tab list, arrow keys move between tabs, Enter or Space activates.

## Why it matters here
The interface must stay usable with the keyboard and a screen reader (open item 08_P01). A chart is a canvas, so every indicator needs a text alternative (a small table or a sentence) and a label.

## Key ideas
- Toggle buttons use `aria-pressed`; tabs use `role=tablist`, `tab`, `tabpanel`.
- A chart's information must also exist as text.
- Colour is never the only signal.

## Common mistakes
Unnamed icon buttons; toggles that look pressed only by colour; a RSI panel with no text version.

## Check yourself
1. Which keys move between tabs? 2. What is the text alternative of the RSI panel?

## References
- WAI-ARIA Authoring Practices, Tabs pattern: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/ (verified reachable 2026-11-10)
- MDN, tabpanel role: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/tabpanel_role (verified reachable 2026-11-10)
