# Recipe Finder + Macro + Shopping List — Build Brief

> This is the north-star spec for this project. The architecture decisions below
> were made deliberately with tradeoffs already weighed — **do not re-litigate them**
> unless something turns out to be technically impossible, in which case flag it and
> propose the smallest change. Build in the milestone order given. Ship each milestone
> as independently usable before starting the next.

---

## 1. What we're building

A personal web app that:

1. **Finds recipes** two ways — (a) automatic web search for popular/well-liked recipes, and (b) a URL box where the user pastes any webpage or social post (Instagram/TikTok) to capture.
2. **Extracts** the recipe into structured data (title, servings, ingredients, steps).
3. **Estimates calories + macros** when the source doesn't provide them.
4. **Stores** everything and lets the user browse/filter recipes and read step-by-step.
5. **Exports a combined shopping list** — user selects multiple recipes, sets desired portions per recipe, and the app scales + merges ingredients into one list, pushed to **AnyList**.

Single user. No auth needed for v1 (add Supabase Auth later only if sharing is wanted).

---

## 2. Design decisions (settled — build to these)

- **No autonomous social-media crawling.** Instagram/TikTok are fragile to scrape and engagement is a poor quality signal. Social recipes enter **only** via the paste-a-URL path. Discovery is **web-search based**.
- **One codebase: Next.js on Vercel + Supabase (Postgres).** No n8n in the critical path for v1. (n8n Cloud can't run arbitrary npm modules in Code nodes, which the AnyList library needs — Vercel functions can. n8n stays a *later* option if ingestion grows many sources.)
- **Do not build the nutrition engine by hand.** Use a nutrition API with a natural-language endpoint (Spoonacular or Edamam — see §5). It returns *both* parsed structured ingredients *and* macros from a line like `"200g chicken thigh"`. This one call solves macros AND provides the structured ingredients the shopping-list merge depends on.
- **Prefer source-provided data.** If a page's schema.org `Recipe` JSON-LD includes `nutrition`, use it; only call the nutrition API as fallback. Same for ingredients/steps — trust JSON-LD first.
- **Popularity gate is rating-based, not engagement-based.** A web recipe qualifies only if its JSON-LD `aggregateRating` clears `reviewCount ≥ 50` AND `ratingValue ≥ 4.3` (make these configurable constants).

---

## 3. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router, TypeScript) |
| Hosting | Vercel (serverless functions + Vercel Cron) |
| DB | Supabase (Postgres) |
| Styling | Tailwind CSS |
| Nutrition + ingredient parsing | Spoonacular (Parse Ingredients returns structure + macros in one call) |
| Recipe extraction | schema.org JSON-LD first; LLM fallback via Anthropic API |
| Transcription (video-only social posts) | Whisper (fallback path, build last) |
| Shopping list target | AnyList (unofficial `anylist` npm lib) |

---

## 4. Non-goals for v1 (explicitly out of scope)

- Autonomous scraping/ranking of TikTok/Instagram by engagement.
- Multi-user accounts, sharing, permissions.
- Meal planning / calendar scheduling.
- Native mobile app.
- Anything requiring n8n.

Don't build these. Don't add abstractions "in case" they're needed later.

---

## 5. External services & required secrets

Create `.env.local` (and set the same in Vercel project env). **Ask the user for values before wiring anything live** — do not hardcode.

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Nutrition + ingredient parsing — Spoonacular (locked)
SPOONACULAR_API_KEY=

# Anthropic (LLM extraction fallback)
ANTHROPIC_API_KEY=

# Web search for discovery — Tavily (locked)
TAVILY_API_KEY=

# AnyList (unofficial lib — email/password auth)
ANYLIST_EMAIL=
ANYLIST_PASSWORD=
```

**Nutrition API is locked to Spoonacular.** Its *Parse Ingredients* endpoint returns structured `{name, amount, unit}` **and** macros in one call — the single call that satisfies both macro estimation and the structured-ingredient prerequisite for the shopping-list merge. Its *Extract Recipe from Website* endpoint also accelerates §8. Still, build all nutrition/parse calls behind a **single internal module** (`lib/nutrition.ts`) with one interface, so a future provider swap doesn't touch callers. Mind the points-based daily quota: cache aggressively and never re-call for recipes already stored.

---

## 6. Data model (Supabase / Postgres)

```sql
create table recipes (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  source_url    text,
  source_type   text check (source_type in ('web','instagram','tiktok','manual')),
  base_servings int  not null default 1,
  steps         jsonb not null default '[]',   -- ordered array of step strings
  rating_value  numeric,                        -- from JSON-LD if present
  review_count  int,                            -- from JSON-LD if present
  created_at    timestamptz default now()
);

create table ingredients (
  id             uuid primary key default gen_random_uuid(),
  recipe_id      uuid references recipes(id) on delete cascade,
  canonical_name text not null,   -- normalized (e.g. "coriander" not "cilantro")
  amount         numeric,         -- for base_servings
  unit           text,            -- e.g. g, ml, cup, tbsp, clove, whole
  unit_class     text check (unit_class in ('mass','volume','count','other')),
  raw_text       text             -- original line, kept for display/debugging
);

create table nutrition (
  recipe_id    uuid primary key references recipes(id) on delete cascade,
  calories     numeric,
  protein_g    numeric,
  carbs_g      numeric,
  fat_g        numeric,
  per_serving  boolean not null default true,
  is_estimated boolean not null default true  -- true = from API, false = from source
);
```

Store macros **per serving** and scale on read. Keep `raw_text` on ingredients so the UI can always fall back to showing the original line.

---

## 7. Suggested folder structure

```
app/
  page.tsx                 # recipe list + filters
  recipe/[id]/page.tsx     # single recipe, step-by-step
  add/page.tsx             # URL paste box + discovery search box
  list/page.tsx            # select recipes, set portions, export
  api/
    ingest/route.ts        # POST { url } -> extract, store
    discover/route.ts      # POST { query } -> search, gate, ingest passers
    shopping-list/route.ts # POST { items:[{recipeId, portions}] } -> merged list
    anylist/route.ts       # POST { items } -> push to AnyList
lib/
  extract.ts               # JSON-LD parse + LLM fallback
  nutrition.ts             # single interface over Spoonacular
  merge.ts                 # ingredient scaling + combining
  anylist.ts               # wrapper over the unofficial lib
  supabase.ts              # server client
```

---

## 8. Ingestion pipeline (`lib/extract.ts` + `api/ingest`)

For a given URL:

1. Fetch the page HTML.
2. **Try schema.org `Recipe` JSON-LD** (free, no quota). If found, read title, `recipeIngredient`, `recipeInstructions`, `recipeYield` (→ base_servings), and `nutrition` + `aggregateRating` when present. Happy path for most recipe sites.
3. **Web page without JSON-LD:** fall back to Spoonacular's *Extract Recipe from Website* endpoint — more reliable than freeform LLM parsing for real recipe pages, and it returns structured ingredients directly.
4. **Social post (Instagram/TikTok):** pull the caption + pinned/top comment text and send it to the Anthropic API with a strict prompt to return **JSON only**: `{ title, servings, ingredients:[raw lines], steps:[strings] }`.
5. **Video-only social posts with the recipe in the audio** (build LAST): download audio, transcribe with Whisper, then run the same LLM structuring step. Skip in early milestones.
6. Send ingredient lines to `lib/nutrition.ts` (Spoonacular *Parse Ingredients*) → get structured `{name, amount, unit}` + per-serving macros in one call.
7. Normalize each ingredient: assign `canonical_name` (handle AU/US synonyms — coriander/cilantro, capsicum/pepper, prawns/shrimp, spring onion/scallion) and `unit_class`.
8. Write `recipes`, `ingredients`, `nutrition` rows.

Extraction must be resilient: if a step fails, store what you have, mark macros `is_estimated=true`/null, and never lose the raw text.

---

## 9. Shopping-list combining (`lib/merge.ts`)

Input: `[{ recipeId, portions }]`. For each recipe:

1. Load its ingredients (which are stored per `base_servings`).
2. Scale each amount by `portions / base_servings`.

Then across all selected recipes:

3. Group by `canonical_name`.
4. Within a group, sum amounts **per `unit_class`**, converting within the class (mass↔mass, volume↔volume) using a small conversion table.
5. **Cross-class conflicts** (e.g. `1 cup flour` + `200g flour`): do **not** attempt density conversion. Emit them as separate lines under the same ingredient name with a short note. Keep it simple — this is the deliberately-uncomplicated path.

Output: a flat list of `{ name, amount, unit }` (plus any un-mergeable extras), ready for AnyList.

---

## 10. Discovery (`api/discover`)

1. Take a search query, call the **Tavily** API (returns clean, extractable result content — good for the JSON-LD read that follows).
2. For each result, fetch the page and read JSON-LD.
3. Apply the popularity gate (`reviewCount ≥ 50 && ratingValue ≥ 4.3`).
4. Auto-ingest the passers via the §8 pipeline (dedupe on `source_url`).
5. Return what was added + what was skipped and why.

Optional later: wrap this in **Vercel Cron** to run saved queries on a schedule. Don't build the cron until the manual version works.

---

## 11. AnyList export (`lib/anylist.ts` + `api/anylist`)

- Use the unofficial `anylist` npm package, authenticated with `ANYLIST_EMAIL` / `ANYLIST_PASSWORD`. **Build against it directly** (decision locked).
- It's reverse-engineered, so handle runtime failures gracefully: if a push errors, return the merged list as plain text in the response so the user isn't blocked. Don't build a separate fallback export path up front — just this graceful degradation.
- Runs in a Vercel serverless function (this is *why* we're on Vercel, not n8n Cloud).
- Push the merged list from §9 to a named AnyList list.

---

## 12. Build milestones (do in order; each must work before the next)

**M1 — Foundation.** Next.js + Tailwind scaffold, Supabase project + schema applied, env wiring, deploy to Vercel. Acceptance: app deploys, DB reachable.

**M2 — Ingest by URL (the core engine).** `api/ingest` with JSON-LD path + LLM fallback + nutrition call + storage. A simple `add` page with a URL box. Acceptance: paste a recipe URL → a fully populated recipe with macros appears in the DB.

**M3 — Browse.** List page with macro filters (e.g. high-protein, under-X-calories), single-recipe step-by-step page. Acceptance: can find and read stored recipes.

**M4 — Shopping list + AnyList.** Select recipes, set portions, `lib/merge.ts` combine, `api/anylist` export. Acceptance: 3 recipes × chosen portions → one correctly-summed list lands in AnyList.

**M5 — Discovery.** `api/discover` with the popularity gate, wired to a search box. Acceptance: a query auto-ingests only recipes that clear the gate.

**M6 (optional/last).** Whisper transcription for video-only posts; Vercel Cron for scheduled discovery.

M1–M4 already give a fully usable "capture → store → macro → shop" app. That's the priority.

---

## 13. Known risks & gotchas

- **Nutrition API free tiers are limited.** Cache results; don't re-call for recipes already stored. Watch daily quota.
- **AnyList lib fragility** (see §11) — always keep the plain-text fallback.
- **LLM extraction must return strict JSON** — no markdown fences, no preamble. Parse defensively and retry once on parse failure.
- **Macro accuracy** is ~±15–20% when estimated. Surface `is_estimated` in the UI so the user knows which numbers are trusted vs guessed.
- **Ingredient synonym normalization** is the quiet linchpin of the shopping-list merge. If two recipes name the same thing differently, they won't combine. Invest a little here.

---

## 14. Resolved decisions

1. **Nutrition + parsing API: Spoonacular.** *Parse Ingredients* returns structured ingredients + macros in one call (solves macros and shopping-list structure together); *Extract Recipe from Website* accelerates §8. Cache aggressively; never re-call for stored recipes to protect the daily quota.
2. **Web search for discovery: Tavily.** Built for LLM/agent use; clean extractable content.
3. **AnyList: committed to the unofficial `anylist` library.** Build against it directly with graceful runtime degradation (§11).

All three are locked. The only remaining human input is supplying the API keys/credentials in §5.
