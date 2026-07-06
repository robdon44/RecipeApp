/**
 * Recipe extraction pipeline (§8): schema.org JSON-LD first (free, no quota),
 * then Spoonacular website extraction, then LLM structuring for social posts.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ExtractedRecipe, SourceType } from './types';
import { extractRecipeFromWebsite } from './nutrition';

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
};

export function detectSourceType(url: string): SourceType {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('instagram.com')) return 'instagram';
    if (host.includes('tiktok.com')) return 'tiktok';
  } catch {
    /* fall through */
  }
  return 'web';
}

export async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow' });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

/* ---------------- JSON-LD path ---------------- */

type JsonLdNode = Record<string, unknown>;

function collectJsonLdNodes(html: string): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== 'object') continue;
        const node = item as JsonLdNode;
        nodes.push(node);
        if (Array.isArray(node['@graph'])) queue.push(...(node['@graph'] as unknown[]));
      }
    } catch {
      // malformed JSON-LD block — ignore and keep scanning
    }
  }
  return nodes;
}

function isRecipeNode(node: JsonLdNode): boolean {
  const t = node['@type'];
  if (typeof t === 'string') return t.toLowerCase() === 'recipe';
  if (Array.isArray(t)) return t.some((x) => typeof x === 'string' && x.toLowerCase() === 'recipe');
  return false;
}

function asStringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === 'string');
  return [];
}

/** recipeInstructions may be strings, HowToSteps, or HowToSections of steps. */
function parseInstructions(value: unknown): string[] {
  const out: string[] = [];
  const walk = (item: unknown) => {
    if (!item) return;
    if (typeof item === 'string') {
      const text = item.trim();
      if (text) out.push(text);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(walk);
      return;
    }
    if (typeof item === 'object') {
      const node = item as JsonLdNode;
      if (typeof node.text === 'string' && node.text.trim()) out.push(node.text.trim());
      else if (Array.isArray(node.itemListElement)) walk(node.itemListElement);
    }
  };
  walk(value);
  return out;
}

/** "4 servings" | ["6"] | 4 → number */
function parseServings(value: unknown): number {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first === 'number' && first > 0) return Math.round(first);
  if (typeof first === 'string') {
    const m = first.match(/\d+/);
    if (m) {
      const n = parseInt(m[0], 10);
      if (n > 0) return n;
    }
  }
  return 1;
}

/** JSON-LD image: string | [string] | ImageObject | [ImageObject] → URL */
function parseJsonLdImage(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first === 'string' && first.startsWith('http')) return first;
  if (first && typeof first === 'object') {
    const url = (first as JsonLdNode).url;
    if (typeof url === 'string' && url.startsWith('http')) return url;
  }
  return null;
}

/** og:image / twitter:image meta tag → URL */
export function extractOgImage(html: string): string | null {
  const m = html.match(
    /<meta[^>]+(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["'][^>]+content\s*=\s*["']([^"']+)["']/i
  ) ?? html.match(
    // content= sometimes comes before property=
    /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["']/i
  );
  const url = m?.[1]?.replace(/&amp;/g, '&').trim();
  return url && url.startsWith('http') ? url : null;
}

/** "240 calories" | "4 g" | 240 → number */
function parseNutrientValue(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const m = value.replace(',', '.').match(/[\d.]+/);
    if (m) {
      const n = parseFloat(m[0]);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

export function extractFromJsonLd(html: string, url: string): ExtractedRecipe | null {
  const recipe = collectJsonLdNodes(html).find(isRecipeNode);
  if (!recipe) return null;

  const ingredientLines = asStringArray(
    recipe.recipeIngredient ?? recipe.ingredients
  ).map((l) => l.trim()).filter(Boolean);
  if (ingredientLines.length === 0) return null;

  const rating = (recipe.aggregateRating ?? null) as JsonLdNode | null;
  const nutrition = (recipe.nutrition ?? null) as JsonLdNode | null;
  const sourceNutrition = nutrition
    ? {
        calories: parseNutrientValue(nutrition.calories),
        protein_g: parseNutrientValue(nutrition.proteinContent),
        carbs_g: parseNutrientValue(nutrition.carbohydrateContent),
        fat_g: parseNutrientValue(nutrition.fatContent),
      }
    : null;

  return {
    title: typeof recipe.name === 'string' && recipe.name.trim() ? recipe.name.trim() : 'Untitled recipe',
    sourceUrl: url,
    sourceType: 'web',
    baseServings: parseServings(recipe.recipeYield),
    ingredientLines,
    steps: parseInstructions(recipe.recipeInstructions),
    ratingValue: rating ? parseNutrientValue(rating.ratingValue) : null,
    reviewCount: rating
      ? parseNutrientValue(rating.reviewCount ?? rating.ratingCount) !== null
        ? Math.round(parseNutrientValue(rating.reviewCount ?? rating.ratingCount)!)
        : null
      : null,
    imageUrl: parseJsonLdImage(recipe.image) ?? extractOgImage(html),
    sourceNutrition:
      sourceNutrition && Object.values(sourceNutrition).some((v) => v !== null)
        ? sourceNutrition
        : null,
  };
}

/* ---------------- Social (LLM) path ---------------- */

/** Pull caption-ish text out of a social post page: og meta tags + title. */
function extractSocialText(html: string): string {
  const pieces: string[] = [];
  const metaRe =
    /<meta[^>]+(?:property|name)\s*=\s*["'](og:title|og:description|description|twitter:description)["'][^>]+content\s*=\s*["']([\s\S]*?)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html)) !== null) pieces.push(m[2]);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) pieces.push(title[1]);
  return [...new Set(pieces)]
    .map((s) =>
      s
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#x2F;/g, '/')
        .trim()
    )
    .filter(Boolean)
    .join('\n\n');
}

const LLM_PROMPT = `Extract the recipe from the social-media post text below.
Respond with JSON ONLY — no markdown fences, no preamble, no trailing text.
Schema: { "title": string, "servings": number, "ingredients": string[], "steps": string[] }
"ingredients" must be the raw ingredient lines as written (quantities included).
If a field is unknown use: servings 1, steps []. If there is NO recipe in the text, respond exactly with: null`;

interface LlmRecipe {
  title: string;
  servings: number;
  ingredients: string[];
  steps: string[];
}

function parseLlmJson(text: string): LlmRecipe | null {
  // Parse defensively (§13): strip fences if the model added them anyway.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (cleaned === 'null') return null;
  const parsed = JSON.parse(cleaned) as LlmRecipe;
  if (!parsed || typeof parsed.title !== 'string' || !Array.isArray(parsed.ingredients)) {
    throw new Error('LLM JSON missing required fields');
  }
  return parsed;
}

export async function structureWithLlm(text: string): Promise<LlmRecipe | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY — see .env.example');
  const anthropic = new Anthropic({ apiKey });

  const ask = async (): Promise<string> => {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 2000,
      system: LLM_PROMPT,
      messages: [{ role: 'user', content: text.slice(0, 20000) }],
    });
    const block = msg.content.find((b) => b.type === 'text');
    return block && block.type === 'text' ? block.text : '';
  };

  try {
    return parseLlmJson(await ask());
  } catch {
    // Retry once on parse failure (§13).
    return parseLlmJson(await ask());
  }
}

/* ---------------- Orchestrator ---------------- */

/**
 * Extract a recipe from any URL. Returns null when no recipe can be found.
 * Order: JSON-LD → Spoonacular website extract → LLM over social text.
 */
export async function extractRecipe(url: string): Promise<ExtractedRecipe | null> {
  const sourceType = detectSourceType(url);

  if (sourceType === 'web') {
    let html = '';
    try {
      html = await fetchHtml(url);
    } catch {
      // Page blocked us — Spoonacular fetches server-side, so still try it.
    }
    if (html) {
      const fromJsonLd = extractFromJsonLd(html, url);
      if (fromJsonLd) return fromJsonLd;
    }
    return extractRecipeFromWebsite(url);
  }

  // Instagram / TikTok: caption text → LLM structuring. (Video-audio
  // transcription is milestone M6 — deliberately not built yet.)
  const html = await fetchHtml(url);
  const text = extractSocialText(html);
  if (!text) return null;
  const llm = await structureWithLlm(text);
  if (!llm || llm.ingredients.length === 0) return null;

  return {
    title: llm.title,
    sourceUrl: url,
    sourceType,
    baseServings: llm.servings > 0 ? Math.round(llm.servings) : 1,
    ingredientLines: llm.ingredients,
    steps: llm.steps ?? [],
    ratingValue: null,
    reviewCount: null,
    imageUrl: extractOgImage(html),
    sourceNutrition: null,
  };
}
