# BANA User Website — Cobalt/Emerald design system update

This replaces the earlier Black & White direction (newer instruction wins).

## Design system
- `src/index.css`: single brand token. Cobalt Blue #1D4ED8 (hover #1E40AF); in dark mode a lighter blue (#3B82F6) so text/links stay readable. Emerald is used for story ring, active/online/progress highlights.
- Neutral surfaces tuned: light #F8FAFC / #F1F5F9 / #E2E8F0 / #CBD5E1; dark page #09090B, cards #121216, borders #27272A.
- All former `#1877F2`/`#166FE5` usages now use the brand token (~50 files). Indigo/sky/violet/purple/cyan mapped to blue so the palette stays tight. Red/amber/emerald kept only for errors, warnings, status.
- `index.html`: theme-color and favicon use cobalt.
- Logo (`BanaLogo.tsx`): geometric "B" mark with emerald accent dot.

## Upload screens (unchanged structure from previous step)
Post, Story and Reel remain three independent screens (Create button shows a Post / Story / Reel picker). Shared styling in `create/uploadUi.tsx`, now cobalt primary buttons, grey secondary buttons. Upload/publish logic untouched. Story backgrounds: Cobalt, Emerald, Charcoal, Midnight; previously saved colored story backgrounds still render.

## Auth modal
Added a Show/Hide password toggle (local UI state only). Sign In / Create Account tabs, Google, Forgot password and "Firebase Auth secured" were already present.

## NOT implemented (would be new features / need new data, which you ruled out)
- **Group Buy** (deals, SAVE %, buyer progress, Join/Invite, create-deal modal): the app has no Group Buy data model or rules. Communities are untouched.
- **Messenger "Marketplace" filter and product-context card**: not in the app today. Existing tabs (All, Unread, Groups, Requests, Calls) kept.
- **Phone sign-in**: not in the app's auth logic; not added.
- Light-mode body text is still the app's existing near-black (#09090B), not #0F172A, because the same shade is also the dark background.
