-- Recipe Finder schema (CLAUDE.md §6). Apply via Supabase SQL editor or MCP migration.

create table if not exists recipes (
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

create unique index if not exists recipes_source_url_key
  on recipes (source_url) where source_url is not null;

create table if not exists ingredients (
  id             uuid primary key default gen_random_uuid(),
  recipe_id      uuid references recipes(id) on delete cascade,
  canonical_name text not null,   -- normalized (e.g. "coriander" not "cilantro")
  amount         numeric,         -- for base_servings
  unit           text,            -- e.g. g, ml, cup, tbsp, clove, whole
  unit_class     text check (unit_class in ('mass','volume','count','other')),
  raw_text       text             -- original line, kept for display/debugging
);

create index if not exists ingredients_recipe_id_idx on ingredients (recipe_id);

create table if not exists nutrition (
  recipe_id    uuid primary key references recipes(id) on delete cascade,
  calories     numeric,
  protein_g    numeric,
  carbs_g      numeric,
  fat_g        numeric,
  per_serving  boolean not null default true,
  is_estimated boolean not null default true  -- true = from API, false = from source
);
