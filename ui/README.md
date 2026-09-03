# ui — Vanilla Extract Design System

`ui` is a small React (TypeScript) component library and design token layer
shared by the client. All styles are authored with Vanilla Extract
(`@vanilla-extract/css` for per-component `.css.ts` recipes and
`@vanilla-extract/sprinkles` for an atomic, constraint-based utility layer). It
is published as the `ui` npm workspace package (`ui/package.json`), with
`src/index.ts` as its entry point; the client imports from it as
`import { ... } from "ui"`.

## Design Tokens

Token and atomic-utility exports live in `src/sprinkles.css.ts`:

- `space` — the numeric spacing scale backing every gap/margin/padding utility:
  `none 0, xs 4, sm 8, md 12, lg 16, xl 24, xxl 32, xxxl 48`, plus `full: "100%"`.
- `radii` — the corner-radius scale: `sm 8, md 12, lg 16, full 999` (a 999px
  radius produces fully-rounded pills).
- `sprinkles` — a generated atomic-class function over three property groups, so
  declarative layout can avoid ad-hoc `style` props:
  - **Layout** — `display`, `flexDirection`, `alignItems`, `justifyContent`,
    `flexWrap`, and `gap`/`rowGap`/`columnGap`, with a `placeItems` shorthand.
  - **Spacing** — `margin`/`padding` on all four sides plus `marginX`/`marginY`/
    `paddingX`/`paddingY` shorthands (horizontal margins also accept `auto` for
    centering), and positioning offsets `top`/`right`/`bottom`/`left`. Each
    direction has its own rule so a single longhand like `marginTop` is set
    independently; sibling-context conditions (`followedByType`/`precededByType`)
    are also provided for spacing between repeated elements.
  - **Visual** — `borderRadius` (from the `radii` scale) and `textAlign`.

Convention: use `sprinkles(...)` directly in JSX for one-off layout, but never
inside `*.css.ts` files — those should reference the raw token scales (`space`,
`radii`) so the layer boundaries stay explicit. `Button`, `Tabs`, `Panel`, etc.
illustrate the intended split: shared geometry lives in `.css.ts` recipes while
page-level arrangement composes with `sprinkles`.

## Component Inventory

Most components are thin presentational wrappers that spread standard
HTML/React props, accept `children`, and take an optional `className` for
composition. Stateful composites instead expose purpose-built props
(`Tabs` takes `tabs`/`defaultTab`; `TransactionsHistory` takes
`transactions`/`title`).

### Layout

- `AppShell` — root application frame.
- `Layout` — the scrollable `<main>` content area rendered inside `AppShell`.
- `TopBar` — the top navigation/header bar (the client supplies brand/links).
- `Panel` — a titled content card.
- `Eyebrow` — small overline label above panel/content headings.

### Stats & Tables

- `Stat` and `StatsGrid` — a labeled stat readout and the grid that aligns several.
- `Table` + `TableHeader`, `TableBody`, `TableRow`, `TableCell`,
  `TableHeaderCell`, and `TableEmpty` — a semantic, styleable table kit.
- `TransactionsHistory` — a ready-to-use, stateful transactions view built on the
  table kit: type and status chip filters, a min/max price filter, and
  click-to-sort columns (time, type, side, quantity, price, amount, status) with
  status-aware coloring.

### Forms & Actions

- `Field` — labeled form field wrapper (`<label>`).
- `Input` — styled text/number input.
- `PriceInput` — dollar-aware input that sanitizes to up to two decimal places.
- `Button` — a primary/secondary action button (two variants, plus a `disabled`
  state), typically paired with `ButtonRow`, `Field`/`Input`/`PriceInput`.
- `ButtonRow` — right-aligned row used to lay out action buttons.

### Market / Chart

- `ChartShell` — the frame used to host the client's canvas price chart widget.

### Feedback

- `MessageBox` — inline status/confirmation banner (e.g. trade confirmations).

### Chat

- `ChatHeader` / `ChatLog` — the chat panel's header and auto-scrolling message
  thread.
- `ChatBubble` — an individual message, with `role` variants `user` and
  `assistant` (default).
- `ChatForm` — the composer's `<form>`.
- `Receipt` (+ `ReceiptRow`, `ReceiptNote`) — the structured order/trade receipt
  shown in the chat thread.

## Typing & Composition Notes

- Use `type` rather than `interface` for component prop contracts.
- Split shorthand properties into longhands when the sides differ (e.g. set
  `marginTop` and `marginBottom` separately instead of `margin`).
