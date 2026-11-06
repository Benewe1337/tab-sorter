# Design – Tab Sorter

Functional tool UI (options page + toolbar popup). Methodology: Material-style
clarity for the controls, but with its own identity instead of a component kit.

## Direction: "Setzkasten" (type case / card catalogue)

Every tab group is a **drawer**: a warm paper-dark surface with a **folder tab**
sticking out on top in the group's real Chrome tab-group color. Rules inside
are **monospace chips** labelled with their kind (domain, path, title, regex,
prefix, combo), like index cards in a drawer. Big ordinal numbers (`01`, `02`)
sit in the left margin and show priority, since the first matching group wins.

Why: the tool is about filing things into labelled places. The drawer/tab
metaphor mirrors the browser's own tab groups, and color carries meaning (it
*is* the group color) instead of decoration.

## Color

Warm neutrals, dark by default (`prefers-color-scheme`), light variant on warm paper.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--paper` | `#14110e` | `#f2ece1` | page |
| `--paper-2` | `#1d1915` | `#fbf8f2` | drawers, popup cards |
| `--paper-3` | `#29231d` | `#e9e1d3` | inputs, chips |
| `--ink` | `#efe7da` | `#1d1813` | text |
| `--ink-2` | `#b5aa99` | `#5a5045` | secondary text |
| `--ink-3` | `#82786b` | `#857a6c` | hints, ordinals |
| `--line` | `#3a322a` | `#d8cdbb` | hairlines |
| `--signal` | `#ec8a43` | `#b9541a` | primary action, focus ring |
| `--danger` | `#e5694f` | `#b3261e` | errors, delete |

Group colors follow Chromium's tab-group palette (lighter set in dark mode,
saturated set in light mode) so the drawer tab looks like the real group.

Texture: SVG `feTurbulence` grain over the page at ~6 % opacity (`mix-blend-mode: overlay`).

## Type

- **Bricolage Grotesque** (variable, bundled): wordmark, headings, UI text.
  Display sizes get `letter-spacing: -0.03em`, optical sizing on.
- **JetBrains Mono** (variable, bundled): patterns, ordinals, kind labels.
- Fonts are shipped inside the extension (no Google Fonts request, no tracking).

## Layout

- Options: asymmetric two columns. Narrow sticky aside (wordmark, behaviour
  settings, URL tester, import/export, syntax cheat sheet), wide main column
  with the drawers. Ordinals hang outside the drawer on the left.
- Popup: 340 px, status number large, per-group breakdown with color pegs,
  one primary action.

## Components

- Drawer tab: rounded top corners only, title is an inline-editable input.
- Color picker: 9 round swatches (radio group), selected one gets a ring.
- Chips: kind label in small caps mono + pattern; × removes, click edits.
- Pattern input: live parse feedback (kind or error) and live count of open
  tabs it would catch.
- Toast with undo for destructive actions (delete group, remove chip).

## Motion

Drawer and chip entry: short translate+fade (160 ms). Everything disabled under
`prefers-reduced-motion: reduce`.

## Accessibility

Focus ring = 2 px `--signal` outline with offset. Hit targets ≥ 36 px on the
desktop UI (mouse first; no touch use expected). Icon buttons carry
`aria-label`, swatches are real radio inputs, status messages use `aria-live`.
