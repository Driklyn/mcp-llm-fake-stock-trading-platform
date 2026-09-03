### General Rules

- Don't try to build the client/server after changes.
- When refactoring, don't worry about keeping backwards compatibility. This is a portfolio project, so there's no need to preserve any original functionality/state.
- Always capitalize the first letter of each word in headings/buttons (Title Case), including README files.

### TypeScript

- Use type instead of interfaces

### Components

- Components are built using Vanilla Extract (`@vanilla-extract/css`)
- Avoid using the `style` property on JSX components, instead use the `sprinkles` design system values from the `ui` package whenever possible, such as via:
  ```javascript
  <div className={sprinkles({ display: "flex", gap: "sm" })}>
  ```
- Do NOT use the `sprinkles` function inside of `*.css.ts` files, but use the raw design system variables instead, so rather than:
  ```javascript
  export const filterGroup = style([
    sprinkles({ display: "flex", gap: "xs" }),
    {},
  ]);
  ```
  use this:
  ```javascript
  export const filterGroup = style({
    display: "flex",
    gap: space.xs,
  });
  ```
- Split shorthand properties that use different values into longhand properties, such as `margin: "4px 0 16px` should become `marginTop: "xs", marginBottom: "lg"`
