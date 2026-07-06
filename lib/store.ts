/**
 * Persistence for extracted recipes (§8 steps 6–8): parse ingredient lines via
 * the nutrition module, normalize names/units, and write recipes/ingredients/
 * nutrition rows. Resilient by design — if nutrition parsing fails we still
 * store the recipe with raw ingredient text and null macros.
 */
import { getSupabase } from './supabase';
import { parseIngredients } from './nutrition';
import { canonicalName, normalizeUnit, unitClass } from './normalize';
import type { ExtractedRecipe, ParsedIngredient } from './types';

export interface StoreResult {
  recipeId: string;
  title: string;
  deduped: boolean;
  macrosEstimated: boolean | null; // null = no macros stored at all
}

/** Returns the existing recipe id for a source URL, if already ingested. */
export async function findBySourceUrl(url: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from('recipes')
    .select('id')
    .eq('source_url', url)
    .maybeSingle();
  if (error) throw new Error(`Supabase lookup failed: ${error.message}`);
  return data?.id ?? null;
}

export async function storeRecipe(extracted: ExtractedRecipe): Promise<StoreResult> {
  const supabase = getSupabase();

  // Dedupe on source_url (§10.4) — never re-call the nutrition API for a
  // recipe we already have (§13 quota protection).
  if (extracted.sourceUrl) {
    const existing = await findBySourceUrl(extracted.sourceUrl);
    if (existing) {
      return { recipeId: existing, title: extracted.title, deduped: true, macrosEstimated: null };
    }
  }

  // Parse ingredients + macros in one call; tolerate total failure.
  let parsed: ParsedIngredient[] = [];
  let parseFailed = false;
  try {
    parsed = await parseIngredients(extracted.ingredientLines);
  } catch {
    parseFailed = true;
  }

  const { data: recipe, error: recipeError } = await supabase
    .from('recipes')
    .insert({
      title: extracted.title,
      source_url: extracted.sourceUrl,
      source_type: extracted.sourceType,
      base_servings: extracted.baseServings,
      steps: extracted.steps,
      rating_value: extracted.ratingValue,
      review_count: extracted.reviewCount,
    })
    .select('id')
    .single();
  if (recipeError || !recipe) {
    throw new Error(`Failed to insert recipe: ${recipeError?.message}`);
  }

  const ingredientRows = parseFailed
    ? extracted.ingredientLines.map((line) => ({
        recipe_id: recipe.id,
        canonical_name: canonicalName(line),
        amount: null,
        unit: null,
        unit_class: 'other' as const,
        raw_text: line,
      }))
    : parsed.map((p) => {
        // Solids measured by volume ("1 cup onion") are stored by weight when
        // the provider reports grams — shopping lists want solids in g/kg,
        // liquids in ml. raw_text still preserves the original line.
        let amount = p.amount;
        let unit = normalizeUnit(p.unit);
        let cls = unitClass(p.unit);
        if (cls === 'volume' && p.consistency === 'SOLID' && p.weightGrams) {
          amount = Math.round(p.weightGrams * 100) / 100;
          unit = 'g';
          cls = 'mass';
        }
        return {
          recipe_id: recipe.id,
          canonical_name: canonicalName(p.name),
          amount,
          unit,
          unit_class: cls,
          raw_text: p.rawText,
        };
      });

  if (ingredientRows.length > 0) {
    const { error } = await supabase.from('ingredients').insert(ingredientRows);
    if (error) throw new Error(`Failed to insert ingredients: ${error.message}`);
  }

  // Nutrition: prefer source-provided (§2), else sum estimated per-line macros.
  let nutritionRow: {
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    is_estimated: boolean;
  } | null = null;

  if (extracted.sourceNutrition) {
    nutritionRow = { ...extracted.sourceNutrition, is_estimated: false };
  } else if (!parseFailed && parsed.length > 0) {
    const sum = (pick: (p: ParsedIngredient) => number | null) => {
      const vals = parsed.map(pick).filter((v): v is number => v !== null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    };
    const servings = Math.max(extracted.baseServings, 1);
    const perServing = (total: number | null) =>
      total === null ? null : Math.round((total / servings) * 10) / 10;
    nutritionRow = {
      calories: perServing(sum((p) => p.calories)),
      protein_g: perServing(sum((p) => p.protein_g)),
      carbs_g: perServing(sum((p) => p.carbs_g)),
      fat_g: perServing(sum((p) => p.fat_g)),
      is_estimated: true,
    };
  }

  if (nutritionRow) {
    const { error } = await supabase.from('nutrition').insert({
      recipe_id: recipe.id,
      ...nutritionRow,
      per_serving: true,
    });
    if (error) throw new Error(`Failed to insert nutrition: ${error.message}`);
  }

  return {
    recipeId: recipe.id,
    title: extracted.title,
    deduped: false,
    macrosEstimated: nutritionRow ? nutritionRow.is_estimated : null,
  };
}
