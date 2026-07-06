import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { mergeIngredients, listToPlainText, type RecipePortion } from '@/lib/merge';
import type { Ingredient } from '@/lib/types';

/** POST { items: [{ recipeId, portions }] } → merged shopping list (§9). */
export async function POST(request: Request) {
  let items: Array<{ recipeId: string; portions: number }>;
  try {
    const body = await request.json();
    items = body?.items;
    if (
      !Array.isArray(items) ||
      items.length === 0 ||
      items.some((i) => typeof i.recipeId !== 'string' || !(i.portions > 0))
    ) {
      throw new Error();
    }
  } catch {
    return NextResponse.json(
      { error: 'Provide { items: [{ recipeId, portions > 0 }] }' },
      { status: 400 }
    );
  }

  try {
    const supabase = getSupabase();
    const ids = items.map((i) => i.recipeId);

    const [{ data: recipes, error: rErr }, { data: ingredients, error: iErr }] =
      await Promise.all([
        supabase.from('recipes').select('id, title, base_servings').in('id', ids),
        supabase.from('ingredients').select('*').in('recipe_id', ids),
      ]);
    if (rErr || iErr) throw new Error((rErr ?? iErr)!.message);

    const missing = ids.filter((id) => !recipes?.some((r) => r.id === id));
    if (missing.length) {
      return NextResponse.json(
        { error: `Unknown recipe ids: ${missing.join(', ')}` },
        { status: 404 }
      );
    }

    const portions: RecipePortion[] = items.map((item) => {
      const recipe = recipes!.find((r) => r.id === item.recipeId)!;
      return {
        ingredients: (ingredients ?? []).filter(
          (ing: Ingredient) => ing.recipe_id === item.recipeId
        ),
        baseServings: recipe.base_servings,
        portions: item.portions,
      };
    });

    const merged = mergeIngredients(portions);
    return NextResponse.json({ items: merged, plainText: listToPlainText(merged) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Merge failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
