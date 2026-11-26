# Accessibility

How Islestone checks that people who use a keyboard, a screen reader or voice control can use it. Hardening H2 part 5 (`docs/porting/maps/H2.md`, "Drag and drop: keyboard and screen readers"; owner decision 177) sets the bar for the board: automated checks in a real browser on every pull request, and a manual screen-reader pass, scripted below, once per hardening gate.

## What runs automatically

| Layer | Where | What it proves |
|---|---|---|
| jsdom, per component | `tests/rendered/*.test.tsx` with `jest-axe` | Structure and logic: roles, names, the board's keyboard moves, the live region's sentences, rollback after a refusal, focus held after a move and released when the person moves it. |
| A real browser | `tests/e2e/board-accessibility.spec.ts` (Playwright, Chromium) | What jsdom cannot see: colour contrast, visible focus, the computed accessibility tree, focus after a virtualised column re-renders. |

The browser spec runs on an isolated workspace with three states (Todo, Done, Cancelled), two lanes by priority and 120 cards, so Todo, with fifty cards loaded, virtualises when the board has no lanes. It checks:

- **Browser axe** (`@axe-core/playwright`, a dev-only dependency, MPL-2.0, used unmodified) on the whole page against WCAG 2.0, 2.1 and 2.2 A and AA, at rest, with a card picked up, during a move, after a cancel, with a refusal shown, with a virtualised column, and after a drop into it. Nothing is excluded: no rule, no element. A new exclusion needs its reason written beside it in the spec.
- **Accessibility-tree snapshots** (`toMatchAriaSnapshot`) of the focused card (a `button`, `pressed` while picked up, named "KEY: title", described by the instructions) and of the live region ("Board announcements") at every step: a pick-up, each move (the card, the column, the position and, on a board with lanes, the lane), a drop (the same), a cancel (the card is back).
- **Keyboard-only flows**: Tab to a card, Space to pick it up, the arrows across columns and lanes and within a cell, Space or Enter to drop, Escape to cancel; a drop the server refuses (a type whose review must finish before Done, 2.8c), after which the card is back, focused, and the server's sentence is in a polite live region; a drop at the bottom of the virtualised column, after which focus stays on the moved card and it is in view; "Load more" by keyboard, after which focus is on the first card the page brought.
- **Focus visible** on the layout switch, the swimlanes picker, and every card, "Move to" menu button, column "+" and "Load more" on the board, walked in Tab order: each matches `:focus-visible` and shows an indicator; a card's indicator is the `--ring` token.

## What the browser pass found (H2e)

Fixed in the components, each with a test that fails without the fix:

1. **Label in name (WCAG 2.5.3).** A card's name is "ISL-1: Title", but its two text lines rendered as "ISL-1Title" with nothing between them, so the visible words were not in the name. A space now separates them. The account menu's name ("Account menu for Ada Lovelace") did not contain the initials its avatar shows ("AL"); it now ends with them, so a voice-control user can say what they see.
2. **Toast contrast (WCAG 1.4.3).** Sonner's light-theme error and info text measured 4.35:1 and warning text 3.07:1 on their tints. `globals.css` darkens the three (5.8, 5.7 and 5.5:1); the dark theme already passed.
3. **Announcements.** A move announced only the place ("Todo, position 2 of 5"), not the card, and a drop on a board with lanes did not name the lane. Each move now names the card, and a drop names the lane.
4. **Focus after a drop into a virtualised column.** A virtualised column renders only the rows in view, so a card dropped below them was never mounted and focus fell to the page. The cell now scrolls the focused card into its window and the card takes focus when it mounts. A card carried within its cell kept its element, which React refocuses without scrolling, so it moved out of view; each step now scrolls it into view.
5. **A drop after the last card loaded.** In a column with more pages, the list leaves a row that sorts after everything loaded for the next page; a drop there (the last position the keyboard offers) took the card, and focus, off the board. The board now loads the next page with such a drop.
6. **Focus theft.** After a move the board gave focus back to the moved card on every later render, so a page loaded, a filter typed or the server's answer took focus back from wherever the person had moved it. The hold now ends when focus moves anywhere else.
7. **"Load more" lost focus.** Activating the last "Load more" removed the button and focus fell to the page. Focus now goes to the first card the page brought.

The virtualised column's list was unnamed (its label sat on a wrapper with no role), unlike every other cell's; it is now the named list, its windowed scroller presentational.

## The manual pass

The automated checks prove structure. Only a person can say what a screen reader speaks, and when. The pass below is done once per hardening gate, by a person, and recorded here. **It has not been run yet**: H2e wrote the script; nobody has performed it. The first run is due before H2 closes.

### Set-up

- A build of the release candidate (`npm run build`, `npm run start`), or production after the release.
- A workspace of your own with the board's shape: a team with Todo, In progress and Done, a project, two people (so lanes by assignee show two lanes), about 60 items in Todo (so the column virtualises with no lanes; `tests/e2e/board-accessibility.spec.ts`'s `seedBoard` shows the API calls), and one item of a type whose review must finish before Done (Settings → Work item types → the type → Review steps, "Review must finish before Done", one step) so a drop into Done is refused.
- Readers and browsers, each at its current release:
  - NVDA with Chrome on Windows;
  - NVDA with Firefox on Windows;
  - VoiceOver with Safari on macOS.
- Speech output recorded as text: NVDA's Speech Viewer (NVDA menu → Tools → Speech Viewer); on macOS the VoiceOver caption panel (VoiceOver Utility → Visuals → Show caption panel). Copy each announcement verbatim.

NVDA: use focus mode on the board (NVDA+Space toggles; the board's keys are the browser's only in focus mode). VoiceOver: keep Quick Nav off and use Tab and the arrows; VO+Space activates.

### Flows

For each reader and browser, do every flow, and record what is spoken at each numbered step.

1. **Reach the board.** Open the project, choose Board in Layout, choose "By assignee" in Swimlanes. Tab to the first card. *Expect:* the card's key and title, "button", the instructions (NVDA may read the description after a pause).
2. **Pick up.** Space. *Expect:* "pressed" (or "toggle button pressed"), then "Picked up KEY. Todo, position 1 of N. Lane Person."
3. **Move within the cell.** Down arrow. *Expect:* "Moving KEY. Todo, position 2 of N. Lane Person."
4. **Move to the next lane.** Down arrow until the cell ends, once more. *Expect:* the next lane named.
5. **Move across columns.** Right arrow. *Expect:* "Moving KEY. In progress, position … Lane …"
6. **Drop.** Space. *Expect:* "Dropped KEY in In progress at position P. Lane …", and focus still on the card (it is read again, not pressed).
7. **Cancel.** Pick up another card, Right arrow, Escape. *Expect:* "Move cancelled. KEY is back where it was.", the card where it started, focused.
8. **Refusal.** Pick up the gated item, move it to Done, drop. *Expect:* "Dropped …", then the server's sentence ("KEY cannot move to Done until its review is complete …") from the notification; the card back in its column and focused.
9. **Virtualised column.** Swimlanes → "No swimlanes". Pick up a card in another column, Left arrow into Todo, Down arrow to the last position, drop. *Expect:* the drop announced, focus on the card, the card visible.
10. **Load more.** Tab to Todo's "Load more", Enter. *Expect:* focus on the first new card, its key and title spoken.
11. **Move to… menu.** Tab to a card's "Move to another column" button, Enter, pick a column. *Expect:* the menu and its options spoken, the drop announced.
12. **Open.** Enter on a card. *Expect:* the detail sheet opens and its title is spoken; Escape returns focus to the board.

### What to record

For each reader and browser: the date, the build (`BUILD_SHA` or the release), the versions of the reader, the browser and the operating system, who ran it, and for each flow the announcements verbatim and "as expected" or the difference. File every difference as an issue (label `accessibility`) and link it here.

### Runs

| Date | Gate | Reader and browser | Build | By | Result |
|---|---|---|---|---|---|
| — | H2 | NVDA + Chrome | — | — | Not run yet |
| — | H2 | NVDA + Firefox | — | — | Not run yet |
| — | H2 | VoiceOver + Safari | — | — | Not run yet |

## Rules for new UI

- A drag interaction has a keyboard path and a non-drag path ("Move to…"), each step announced in a named live region; the board and the timeline (3.1c's schedule table, decision 203) are the patterns.
- A control's visible text is in its accessible name (WCAG 2.5.3): when an `aria-label` replaces the content, the visible words appear in it in the same order.
- After an action re-renders what holds focus, focus lands somewhere on purpose (the moved card, the first new card), and is never taken back once the person moves it.
- A new page or flow with drag, live regions or virtualisation gets a browser check in the shape of `board-accessibility.spec.ts`.
