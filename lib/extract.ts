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

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/g, '/')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

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
    .map((s) => decodeEntities(s).trim())
    .filter(Boolean)
    .join('\n\n');
}

/** Strip an HTML document down to its visible text. */
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|h\d|section)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/**
 * Instagram serves an embed variant of every public post (built for website
 * iframes) that includes the caption and is far less login-walled than the
 * post page itself.
 */
async function fetchInstagramEmbed(
  url: string
): Promise<{ text: string; imageUrl: string | null } | null> {
  const shortcode = url.match(/\/(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/)?.[1];
  if (!shortcode) return null;
  try {
    const html = await fetchHtml(`https://www.instagram.com/p/${shortcode}/embed/captioned/`);
    const caption = html.match(/<div[^>]+class\s*=\s*["'][^"']*Caption[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const image = html.match(/<img[^>]+class\s*=\s*["'][^"']*EmbeddedMediaImage[^"']*["'][^>]+src\s*=\s*["']([^"']+)["']/i);
    const text = htmlToText(caption ? caption[1] : html);
    if (!text) return null;
    return { text, imageUrl: image ? decodeEntities(image[1]) : null };
  } catch {
    return null;
  }
}

/** TikTok's official public oEmbed API returns the caption as `title`. */
async function fetchTikTokOembed(
  url: string
): Promise<{ text: string; imageUrl: string | null } | null> {
  try {
    const res = await fetch(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
      { headers: FETCH_HEADERS }
    );
    if (!res.ok) return null;
    const data: { title?: string; author_name?: string; thumbnail_url?: string } =
      await res.json();
    if (!data.title) return null;
    return {
      text: [data.author_name, data.title].filter(Boolean).join(': '),
      imageUrl: data.thumbnail_url ?? null,
    };
  } catch {
    return null;
  }
}

/** Last-resort content fetch through Tavily's extractor. */
async function tavilyExtract(url: string): Promise<string | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ urls: [url] }),
    });
    if (!res.ok) return null;
    const data: { results?: Array<{ raw_content?: string }> } = await res.json();
    return data.results?.[0]?.raw_content?.trim() || null;
  } catch {
    return null;
  }
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

  // Instagram / TikTok: caption text → LLM structuring. Both platforms
  // login-wall direct fetches from datacenter IPs, so gather text from every
  // available door: the post page, the platform's embed/oEmbed surface, and
  // finally Tavily's extractor. (Video-audio transcription is milestone M6 —
  // deliberately not built yet.)
  const pieces: string[] = [];
  let imageUrl: string | null = null;

  try {
    const html = await fetchHtml(url);
    pieces.push(extractSocialText(html));
    imageUrl = extractOgImage(html);
  } catch {
    // login wall / block — the embed strategies below don't need the page
  }

  const embed =
    sourceType === 'tiktok' ? await fetchTikTokOembed(url) : await fetchInstagramEmbed(url);
  if (embed) {
    pieces.push(embed.text);
    imageUrl = imageUrl ?? embed.imageUrl;
  }

  let text = [...new Set(pieces.filter(Boolean))].join('\n\n');
  let llm = text ? await structureWithLlm(text) : null;

  if (!llm || llm.ingredients.length === 0) {
    text = (await tavilyExtract(url)) ?? '';
    llm = text ? await structureWithLlm(text) : null;
  }
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
    imageUrl,
    sourceNutrition: null,
  };
}
