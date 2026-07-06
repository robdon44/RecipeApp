# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Single-user recipe app: capture recipes from any URL (recipe sites, Instagram/TikTok), estimate macros, browse/filter, and merge selected recipes into one shopping list pushed to AnyList. Next.js App Router (TypeScript) + Tailwind v4 + Supabase (Postgres), deployed on Vercel.

The original spec lives in `docs/BUILD_BRIEF.md`. Its architecture decisions are settled — don't re-litigate them. Known deviations from the brief (all deliberate, user-approved): discovery gate is now `ratingValue ≥ 4.5 && reviewCount ≥ 5` (`lib/config.ts`), `recipes.image_url` was added to the schema, delete/re-import endpoints exist, and solids are stored by weight (see below).

## Commands

```bash
npm run dev          # local dev server
npm run build        # production build (also the de-facto type check gate)
npm run lint         # eslint
npx tsc --noEmit     # standalone type check
```

There is no test framework. Pure logic (`lib/merge.ts`, `lib/normalize.ts`, JSON-LD parsing in `lib/extract.ts`) has been verified with ad-hoc `npx tsx` scripts asserting against fixtures; follow that pattern for regression checks.

## Live infrastructure

- **Supabase project**: `wnrjqguqxbacybwvwvkt` (ap-southeast-2). Schema mirror in `supabase/schema.sql`; apply changes as MCP migrations AND update that file.
- **Vercel**: deploys from the GitHub repo; env vars are set in the Vercel dashboard (names in `.env.example`). Env changes require a redeploy.
- `GET /api/health` on a deployment reports which env vars are set (presence/length only) — use it before debugging config issues.
- In the Claude Code cloud sandbox, outbound calls to Spoonacular, Tavily, AnyList, `*.supabase.co`, and `api.vercel.com` are **blocked** (Anthropic API is allowed). Use the Supabase MCP tools for DB work; external-API behavior can only be verified on the deployed app.

## Architecture

### Ingestion pipeline (the core)

`app/api/ingest/route.ts` → `lib/extract.ts` → `lib/nutrition.ts` → `lib/store.ts`:

1. `extractRecipe(url)` picks a path by hostname: web pages try schema.org Recipe JSON-LD first (free, no quota), then Spoonacular's website extractor; Instagram/TikTok pull og-meta caption text and structure it with the Anthropic API (strict JSON, one retry on parse failure).
2. `storeRecipe()` sends raw ingredient lines to Spoonacular Parse Ingredients **once** — that single call returns structured `{name, amount, unit}`, per-line macros, consistency (SOLID/LIQUID), and gram weight.
3. Normalization (`lib/normalize.ts`) assigns `canonical_name` (AU/US synonyms + last-word singularization) and `unit_class`.

Resilience contract: every step may fail without losing data — recipes store with raw ingredient text and null macros if parsing fails; `raw_text` is always kept.

### Import-time vs read-time (the key invariant)

Unit conversion and normalization happen **at import time** and are baked into `ingredients` rows. Changing parsing/normalization logic does NOT fix already-stored recipes — they must be re-imported (`POST /api/ingest {url, force:true}`, or the ↻ Re-import button on the recipe page, which deletes and re-ingests under a new id). Macros are stored **per serving** and scaled on read.

Rules baked in at import: solids measured by volume are converted to grams using Spoonacular's reported weight (liquids stay ml); nutrition prefers source-provided JSON-LD values (`is_estimated=false`) over API estimates (`is_estimated=true` — the UI surfaces this distinction).

### Shopping-list merge (`lib/merge.ts`)

Scale by `portions / base_servings`, group by `canonical_name`, sum within a `unit_class` via the conversion table (mass→g, volume→ml), present as g/kg / ml/l. Cross-class conflicts (e.g. cups + grams of the same ingredient) are deliberately NOT density-converted — they emit as separate flagged lines. Synonym normalization is the linchpin: two names that don't canonicalize identically will never merge.

### External-service rules

- All Spoonacular calls go through `lib/nutrition.ts` — never call it from elsewhere (single-interface rule for future provider swap). Quota is points-based: dedupe on `source_url` happens before any API spend; never re-parse stored recipes implicitly.
- The `anylist` lib is reverse-engineered and fragile: it must stay in `serverExternalPackages` (next.config.ts) because its deps break when bundled, login must be `login(false)` (the websocket path crashes serverless), and every push failure degrades to returning the list as plain text — never let AnyList errors block the user. Types are hand-declared in `types/anylist.d.ts`.
- Supabase access is server-only via `lib/supabase.ts` (service-role key, falls back to anon key — equivalent while tables have RLS disabled, which is intentional for this single-user app).

### Non-goals

Still out of scope per the brief: social-media crawling/engagement ranking, multi-user/auth, meal planning, native app, n8n. Whisper transcription for video-only posts (M6) is unbuilt. Don't add speculative abstractions.
