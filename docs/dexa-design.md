# DEXA application design

MotiFrame follows the DEXA Design System's application theme: Paper app shell and Signal Orange actions, with an Ink bezel and a Near Black inset display for previews. Dexa Cyan marks selection guides and data inside that display. Artwork retains its authored colors.

`apps/editor/src/dexa-tokens.css` maps the canonical DEXA colors directly; `styles.css` applies them to controls, timelines, review cards, dialogs and progress. Space Grotesk and JetBrains Mono are bundled locally with their SIL Open Font License texts. Fonts do not require a CDN. The DEXA triad geometry and light-surface point color are retained beside the MotiFrame name.

The UI uses English labels, a compact desktop tool layout, keyboard focus indicators and reduced-motion control transitions. Timeline labels remain unselectable during scrubbing, with pointer capture continuing outside the ruler. Layout and interaction are checked at desktop sizes; a touch-first mobile editor is not a claimed release target.

Source baseline: DEXA Design System, `DESIGN.md` and light triad asset, inspected 2026-10-12. Its cross-project application surface rules take precedence over sibling exhibition apps that use full-screen dark surfaces. This is an implementation of the design system in MotiFrame's React components.
