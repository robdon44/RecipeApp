/**
 * Single internal interface over the nutrition provider (§5).
 * Spoonacular is the locked provider; callers must never touch it directly
 * so a future swap only changes this file.
 */
import type { ExtractedRecipe, ParsedIngredient } from './types';

const BASE = 'https://api.spoonacular.com';

function apiKey(): string {
  const key = process.env.SPOONACULAR_API_KEY;
  if (!key) throw new Error('Missing SPOONACULAR_API_KEY — see .env.example');
  return key;
}

function nutrient(
  nutrients: Array<{ name: string; amount: number }> | undefined,
  name: string
): number | null {
  const n = nutrients?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return n ? n.amount : null;
}

/**
 * Parse free-text ingredient lines into structured {name, amount, unit} with
 * per-line macros — one call satisfies both macro estimation and the
 * structured ingredients the shopping-list merge needs.
 *
 * Lines that Spoonacular can't parse come back with nulls but keep rawText,
 * so nothing is ever lost (§8 resilience).
 */
export async function parseIngredients(lines: string[]): Promise<ParsedIngredient[]> {
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return [];

  const body = new URLSearchParams({
    ingredientList: nonEmpty.join('\n'),
    servings: '1',
    includeNutrition: 'true',
  });

  const res = await fetch(`${BASE}/recipes/parseIngredients?apiKey=${apiKey()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Spoonacular parseIngredients failed: ${res.status} ${await res.text()}`);
  }

  const parsed: Array<{
    name?: string;
    amount?: number;
    unit?: string;
    original?: string;
    consistency?: string;
    nutrition?: {
      nutrients?: Array<{ name: string; amount: number }>;
      weightPerServing?: { amount?: number; unit?: string };
    };
  }> = await res.json();

  return parsed.map((p, i) => {
    const weight = p.nutrition?.weightPerServing;
    return {
      name: p.name?.trim() || nonEmpty[i] || 'unknown',
      amount: typeof p.amount === 'number' ? p.amount : null,
      unit: p.unit?.trim() || null,
      rawText: p.original?.trim() || nonEmpty[i] || '',
      consistency: p.consistency?.toUpperCase() ?? null,
      weightGrams:
        weight?.unit === 'g' && typeof weight.amount === 'number' && weight.amount > 0
          ? weight.amount
          : null,
      calories: nutrient(p.nutrition?.nutrients, 'Calories'),
      protein_g: nutrient(p.nutrition?.nutrients, 'Protein'),
      carbs_g: nutrient(p.nutrition?.nutrients, 'Carbohydrates'),
      fat_g: nutrient(p.nutrition?.nutrients, 'Fat'),
    };
  });
}

/**
 * Extract a recipe from a webpage that has no usable JSON-LD (§8 step 3).
 * Returns null if Spoonacular can't extract anything useful.
 */
export async function extractRecipeFromWebsite(url: string): Promise<ExtractedRecipe | null> {
  const params = new URLSearchParams({
    url,
    apiKey: apiKey(),
    forceExtraction: 'false',
    analyze: 'false',
  });
  const res = await fetch(`${BASE}/recipes/extract?${params}`);
  if (!res.ok) return null;

  const data: {
    title?: string;
    servings?: number;
    extendedIngredients?: Array<{ original?: string }>;
    analyzedInstructions?: Array<{ steps?: Array<{ step?: string }> }>;
    instructions?: string;
  } = await res.json();

  const ingredientLines = (data.extendedIngredients ?? [])
    .map((i) => i.original?.trim())
    .filter((x): x is string => Boolean(x));

  let steps: string[] = (data.analyzedInstructions ?? [])
    .flatMap((block) => block.steps ?? [])
    .map((s) => s.step?.trim())
    .filter((x): x is string => Boolean(x));
  if (steps.length === 0 && data.instructions) {
    steps = data.instructions
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (!data.title || ingredientLines.length === 0) return null;

  return {
    title: data.title,
    sourceUrl: url,
    sourceType: 'web',
    baseServings: data.servings && data.servings > 0 ? data.servings : 1,
    ingredientLines,
    steps,
    ratingValue: null,
    reviewCount: null,
    sourceNutrition: null,
  };
}
