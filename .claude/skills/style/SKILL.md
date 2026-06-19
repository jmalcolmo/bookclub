---
name: style
description: Style UI in The Reading Room's "Deranged Granny Square" design system. Use when adding or changing any visual/CSS — new components, colors, spacing, buttons, cards, layout — so it stays on-theme. Reference for the design tokens, fonts, and component classes.
---

# Style — "Deranged Granny Square"

A warm parchment + crochet-blanket aesthetic: each section is its own "patch" with a
thick yarn-colored border, slightly off-kilter, warm offset shadows. Organized chaos —
nothing sterile, nothing material-design.

**Base theme tokens + components live in `styles.css`. New book-club components go in
`club.css`. Reuse tokens; don't hardcode hex or introduce new fonts.**

## Tokens (CSS variables in `styles.css :root`)

- Surfaces: `--bg` (parchment), `--surface`, `--surface-2`, `--text-primary`, `--text-muted`
- Yarn accents: `--yarn-ochre`, `--yarn-sage`, `--yarn-rust`, `--yarn-slate`,
  `--yarn-mauve`, `--yarn-bark` (darkest), `--yarn-moss`, `--yarn-clay`
- Semantic: `--positive`, `--negative`, `--warning`
- Shadows (warm, offset — NOT soft material shadows): `--shadow-soft`, `--shadow-lift`,
  `--shadow-deep`
- Fonts: `--font-display` = **Crimson Pro** (serif, headings/body),
  `--font-mono` = **DM Mono** (labels, numbers, meta). Never use Inter/Roboto/system.

## Component vocabulary (already defined — reuse)

- `.patch` — the core card: thick border, rounded, offset shadow, slight rotation.
  Tint with `background: color-mix(in srgb, var(--yarn-x) 12%, var(--surface))` and
  `border-color: var(--yarn-x)`.
- Buttons: `.btn-primary` (sage fill), `.btn-ghost`, `.btn-back`, `.btn-icon`,
  `.btn-close`; size modifiers `.big`, `.small`.
- Headings: `.stamp-title` (hand-stamped, letter-spaced; `.small` variant).
  `.subtitle`, `.faint` (mono muted text).
- Layout: `.screen-pad` (page container), `.screen-header` (back/title/action row).
- Forms: `.field`, `.field-label`; inputs/textareas inherit the bordered mono style.
- Feedback: `.toast` + `.toast-success/-error/-info` (call `toast()` from `ui.js`).
- Avatars: build via `avatarHTML()` in `ui.js` (photo or initials on a yarn color).

## Rules of thumb

- Borders 3–5px, rounded 8–18px, in a `--yarn-*` color (vary by section for the
  patchwork feel). Apply warm offset shadows, not blurry drop shadows.
- A little rotation/irregularity is good; uniform grids are not the vibe.
- Lowercase, letter-spaced mono for labels/meta; serif for content and titles.
- Color carries meaning sparingly: `--positive` (done/started), `--warning`/`--negative`
  (deadlines overdue), accents for sections.
- Mobile: stack with the existing `@media (max-width: 600px)` patterns; keep `.patch`
  rows readable.

## Don't

- Don't add a CSS framework or new font family.
- Don't put book-club styles in `styles.css` (keep that as the shared base); use `club.css`.
- Don't use pure white/black or cool grays — stay in the warm palette via tokens.

After any visual change, verify on localhost:5174 with a screenshot (preview tools) and,
for exact values, `preview_inspect` rather than eyeballing.
