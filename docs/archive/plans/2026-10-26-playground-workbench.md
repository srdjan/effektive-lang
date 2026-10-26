# Playground workbench

The playground looks like a light web page with two dark code boxes. This plan
makes it look and work like an IDE workbench. The user asked for this on
2026-10-26. The decisions below took the recommended option, because the user
did not answer within the question window.

## Decisions

| ID | Decision | Choice |
| --- | --- | --- |
| PW-D1 | Wide layout | A workbench: a file explorer, two editor groups side by side (the source and the generated TypeScript), a bottom Problems panel, and a status bar. |
| PW-D2 | Color scheme | One dark navy surface family for the whole page, with the Effektive orange as the accent. |
| PW-D3 | Phone layout | The file tabs stay at the top. The Source, Problems, and TypeScript switch moves to a bottom bar. The status bar sits above it. |

## Constraints

- Keep every element ID that `playground/src/app.ts` reads, the `#path` URL
  hash, and the keyboard model of the tablists.
- The accessible name of each region starts with "Source", "Problems", or
  "TypeScript". In the wide layout the file name follows, for example
  "Source users.eff".
- Keep the tab names of the files, `#problems li`, and `#no-problems`, because
  the demo plan in `demos/recordings/plan.json` selects them.
- Every interactive element keeps a hit area of at least 44 by 44 CSS pixels.
- Text keeps a contrast of at least 4.5:1, and focus rings and underlines keep
  at least 3:1, against their surface.
- No new dependency, no framework, and no inline style.
- `deno task check` passes. The build stays the same apart from the page files.

## Layout

Three widths. The base rules are the phone layout. `min-width` rules add the
rest.

| Width | Files | Regions | Status bar | View switch |
| --- | --- | --- | --- | --- |
| Below 720 px | Horizontal tab strip under the title bar | One region at a time | Above the view switch, wraps | Bottom bar, three equal tabs |
| 720 to 1023 px | Horizontal tab strip under the title bar | Source and TypeScript side by side, Problems panel below both | Bottom, one line | Hidden |
| 1024 px and up | Vertical explorer in a left sidebar | As at 720 px, right of the sidebar | Bottom, full width, one line | Hidden |

The title bar holds the `h1` and the "Read the book" link. The compile time
moves from the title bar to the status bar.

Below 720 px, `body` stays a flex column, as now. From 720 px, `body` is a grid
with named areas, so `#files` can sit beside `main` with no wrapper element.
`#views` is hidden there, because `enterWide` sets `hidden` on it. A hidden
element takes no row.

```css
/* 720 to 1023 px */
body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto auto auto auto minmax(0, 1fr) auto;
  grid-template-areas: "title" "loading" "error" "files" "main" "status";
}

/* 1024 px and up */
body {
  grid-template-columns: 15rem minmax(0, 1fr);
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
  grid-template-areas:
    "title title" "loading loading" "error error" "files main"
    "status status";
}
```

Inside `main`, from 720 px, the DOM order is source, problems, output, so the
grid places each region explicitly:

```css
main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) clamp(8rem, 28%, 16rem);
}
#source-region { grid-area: 1 / 1; }
#output-region { grid-area: 1 / 2; }
#problems-region { grid-column: 1 / -1; grid-row: 2; }
```

## Units

PW1 changes the page. PW2 updates the documents. Each unit is one commit.

### PW1: the workbench

Markup, `playground/index.html`:

1. The `h1` keeps the text "Effektive playground". Wrap "playground" in a span
   so CSS can draw it in the muted color.
2. Move `#status` out of the title bar into a new `<footer class="statusbar">`
   at the end of `body`, before the script. The footer holds, in order,
   `#cursor-position` (new, the line and column), `#cursor-line` (moved out of
   `#source-region`, still `aria-live="polite"`), and `#status`.
3. Move `nav#views` after `main` and after the footer, so the DOM order matches
   the bottom position on a phone.
4. Change `#source-title` to
   `<span class="sr-only">Source </span><span id="source-file"></span>` and
   `#output-title` to
   `<span class="sr-only">TypeScript </span><span id="output-file"></span>`.
   The region names stay "Source" and "TypeScript" for screen readers, and the
   visible text is the file name, as on an editor tab.

Script, `playground/src/app.ts` and `playground/src/model.ts`:

1. Import `generatedPathOf` from `../../src/core/mod.ts`, which `app.ts`
   already imports. It gives `users.ts` for `users.eff` and
   `host/providers.effi.ts` for `host/providers.effi`. Add no new helper.
2. Set `#source-file` to the active path and `#output-file` to
   `generatedPathOf(active)` at start and in `selectFile`.
3. Set `#cursor-position` to `Ln <line>, Col <column>` from the main selection
   head, at start, on each selection change, on each document change, and on
   each file change. The column counts from 1. This update is immediate. The
   contract in `#cursor-line` keeps its 300 ms pause.
4. In `wireTablist`, also treat `ArrowDown` as next and `ArrowUp` as previous.
   This applies to every tablist, including the horizontal ones. That is
   intended: one key model for every tablist on the page.
5. Add a second media query, `(min-width: 1024px)`. When it matches, set
   `aria-orientation="vertical"` on `#file-tabs`. When it does not match, set
   `aria-orientation="horizontal"`. Keep the value in step on each change.

Styles, `playground/app.css`. Rewrite the file. Keep the font face, the
`[hidden]` rule, `.sr-only`, the reduced-motion block, and the comment style.
Keep the existing `--code-*` tokens and their values, because `editor.ts` reads
them. Add these tokens and use only tokens in the rules:

| Token | Value | Use |
| --- | --- | --- |
| `--deck` | `#0d1426` | Title bar, sidebar, tab strips, panel header |
| `--well` | `#111a2e` | Problems panel body |
| `--rule` | `rgba(244, 244, 242, 0.08)` | Separators between areas |
| `--deck-ink` | `#f4f4f2` | Text on the deck |
| `--deck-muted` | `#aab3c6` | Inactive tabs, explorer rows, the "playground" word, the book link |
| `--hover` | `rgba(244, 244, 242, 0.05)` | Hover fill of tabs, explorer rows, and problem rows |

Set `color-scheme: dark`, the body background to `--deck`, and the body text
to `--deck-ink`. Remove the light tokens that nothing uses any more.

Rules:

- Focus ring: `2px solid var(--accent)` with an inset offset on tabs, rows, and
  panes. Orange on the navy surfaces reaches 3:1.
- File tabs (horizontal): height 44 px, `--deck` background, `--deck-muted`
  text, a `--rule` bottom edge on the strip. The selected tab takes
  `--deck-ink` text and an inset 2 px orange line at its bottom edge. It keeps
  the `--deck` background, because the editor group header below it already
  draws the file as an editor tab. Hover takes `--hover` and `--deck-ink`.
  Keep the 150 ms color transition, and wrap hover rules in
  `@media (hover: hover)`.
- Explorer (1024 px and up): `#files` becomes a 15rem left column for the full
  height between the title bar and the status bar, on `--deck` with a `--rule`
  edge. The tablist is a vertical list. Each row is 44 px high, starts with
  the file name, and the selected row takes `--code-selection` with an inset
  2 px orange line at its start edge. The `host/` part of a path stays in the
  name. The error badge sits at the row end.
- Editor groups, from 720 px only: each source and TypeScript region header is
  a 36 px row on `--deck` that shows the `h2` as one editor tab: `--code-bg`
  background under the name, an inset 2 px orange line at its top,
  `--deck-ink` text. The pane below fills the rest. Below 720 px, every region
  `h2` stays visually hidden, as now, because the view tab names the region.
  The stale banner sits between the header and the TypeScript pane as one
  orange strip with navy text, as now. `#output-message` keeps the `--code-bg`
  surface. `#loading` and `noscript` sit on `--deck` with `--deck-muted` and
  `--deck-ink` text.
- Problems panel, from 720 px: spans both editor groups in the second grid
  row of `main`. Its header is a 36 px row on `--deck` with the
  uppercase "Problems" title, 0.8125rem, letter spacing 0.04em, and the count.
  The body is `--well`. Each problem row is 44 px minimum, `--deck-ink` text,
  a `--rule` separator, and a 0.5rem circle before the location: `--code-error`
  for `data-severity="error"` and `--accent` for a warning. "No problems" is
  `--deck-muted`.
- Status bar: full width, the orange `--accent` fill and `--accent-ink` navy
  text, 0.8125rem. From 720 px it is one 28 px line: the position, the contract
  with an ellipsis, and the compile time at the end. Below 720 px the contract
  wraps and the bar grows. It holds no control.
- Phone view switch: a bottom bar of three equal 52 px tabs on `--deck` with a
  `--rule` top edge. The selected tab takes `--deck-ink` and an inset 2 px
  orange line at its top. Add `padding-bottom: env(safe-area-inset-bottom)`.
- Error region and loading text: on `--deck`, with an orange start edge for the
  error, as now.

### PW2: documents

1. Update the playground paragraph of `docs/api.md`: replace "Below 720 pixels,
   the page shows one region at a time." with the three widths of the layout
   table, in two or three sentences.
2. Add one line to the "Unreleased" section of `CHANGELOG.md`.
3. Mark PW1 and PW2 done in this plan, then move it to `docs/archive/plans/`
   and update the registry row, as `AGENTS.md` requires.

## Verification

For PW1, in this order:

1. `deno task check` exits 0.
2. `deno task playground:serve`, then a browser at 375 by 812, 800 by 800, and
   1280 by 800. A screenshot at each width shows the layout of the table, with
   no horizontal page scroll.
3. At 1280 px: the Tab key reaches the explorer, the source editor, the
   problems, and the TypeScript pane in DOM order. `ArrowDown` and `ArrowUp`
   move between explorer rows and open the file. At 375 px: `ArrowLeft` and
   `ArrowRight` move between the view tabs of the bottom bar.
4. Type an error in `users.eff`. The badge, the problem row, the stale banner,
   and the wavy underline appear. A click on the problem row moves the cursor
   to the error. Remove the error, and each one clears.
5. The status bar shows `Ln`, `Col`, the contract at the cursor, and the
   compile time, and it updates when the cursor moves.
6. The demo plan still rehearses:
   `deno run -A <skill>/scripts/demo.ts rehearse ./demos/recordings/plan.json`.

For PW2: `deno test --allow-read tests/docs_test.ts` and `deno task check`.

## Validation

A Fable review on 2026-10-26 found eleven points. The plan now uses the core `generatedPathOf`, states the body and `main` grids, keeps the region headers visually hidden below 720 px, places the Problems panel, gives the horizontal file tab an underline so it does not repeat the editor tab, relaxes the region-name constraint, covers `#output-message`, `#loading`, and `noscript`, states the arrow-key model, and runs the view-tab key check at 375 px. The review confirmed the contrast values: the lowest is 4.89:1, orange on `--code-selection`.

## Progress

| Unit | State | Commit |
| --- | --- | --- |
| PW1 | Done | `4031957` |
| PW2 | Done | this commit |
