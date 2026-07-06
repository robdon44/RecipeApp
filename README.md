# Recipe Finder + Macros + Shopping List

Personal web app that captures recipes from any URL (recipe sites, Instagram, TikTok),
estimates calories + macros, and merges selected recipes into one shopping list pushed
to AnyList. See `CLAUDE.md` for the full build brief.

## Stack

Next.js (App Router, TypeScript) · Tailwind · Supabase (Postgres) · Vercel ·
Spoonacular (nutrition + parsing) · Tavily (discovery search) · Anthropic API
(LLM extraction fallback) · unofficial `anylist` lib.

## Setup

1. **Supabase** — create a project, then run `supabase/schema.sql` in the SQL editor.
2. **Env** — `cp .env.example .env.local` and fill in every key (see comments in the file).
3. **Install & run**

   ```bash
   npm install
   npm run dev
   ```

4. **Deploy** — import the repo into Vercel and set the same env vars in the project settings.
5. **AnyList** — create a list named `Recipe App` in the AnyList app (or set
   `ANYLIST_LIST_NAME` to an existing list).

## Pages

| Route | Purpose |
|---|---|
| `/` | Browse recipes with macro quick-filters (high-protein, under-X-calories) |
| `/recipe/[id]` | Single recipe: per-serving macros, ingredients, step-by-step |
| `/add` | Paste a URL to capture, or search the web for popular recipes |
| `/list` | Select recipes + portions → combined shopping list → AnyList |

## API routes

| Route | Body | Does |
|---|---|---|
| `POST /api/ingest` | `{ url }` | Extract (JSON-LD → Spoonacular → LLM) + store |
| `POST /api/discover` | `{ query }` | Tavily search → popularity gate (≥4.3★, ≥50 reviews) → auto-ingest |
| `POST /api/shopping-list` | `{ items: [{recipeId, portions}] }` | Scale + merge ingredients |
| `POST /api/anylist` | `{ items }` | Push to AnyList; returns plain text on failure |

## Notes

- Macros are stored **per serving**; `is_estimated` distinguishes API estimates (±15–20%)
  from source-provided nutrition, and the UI surfaces this.
- Spoonacular has a points-based daily quota — ingestion dedupes on `source_url` and never
  re-calls for stored recipes.
- Video-only social posts (recipe in audio) are milestone M6 and not built yet.
