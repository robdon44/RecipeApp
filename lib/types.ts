export type SourceType = 'web' | 'instagram' | 'tiktok' | 'manual';

export type UnitClass = 'mass' | 'volume' | 'count' | 'other';

export interface Recipe {
  id: string;
  title: string;
  source_url: string | null;
  source_type: SourceType | null;
  base_servings: number;
  steps: string[];
  rating_value: number | null;
  review_count: number | null;
  image_url: string | null;
  created_at: string;
}

export interface Ingredient {
  id: string;
  recipe_id: string;
  canonical_name: string;
  amount: number | null;
  unit: string | null;
  unit_class: UnitClass | null;
  raw_text: string | null;
}

export interface Nutrition {
  recipe_id: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  per_serving: boolean;
  is_estimated: boolean;
}

export interface RecipeWithNutrition extends Recipe {
  nutrition: Nutrition | null;
}

/** A recipe as extracted from a source, before storage. */
export interface ExtractedRecipe {
  title: string;
  sourceUrl: string | null;
  sourceType: SourceType;
  baseServings: number;
  ingredientLines: string[];
  steps: string[];
  ratingValue: number | null;
  reviewCount: number | null;
  imageUrl: string | null;
  /** Nutrition provided by the source itself (per serving), if any. */
  sourceNutrition: {
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
  } | null;
}

/** A structured ingredient returned by the nutrition module. */
export interface ParsedIngredient {
  name: string;
  amount: number | null;
  unit: string | null;
  rawText: string;
  /** SOLID | LIQUID when the provider reports it. */
  consistency: string | null;
  /** Total weight in grams of this line's amount, when reported. */
  weightGrams: number | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

export interface ShoppingListItem {
  name: string;
  amount: number | null;
  unit: string | null;
  note?: string;
}
