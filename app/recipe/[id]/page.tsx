import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import type { Ingredient, Nutrition, Recipe } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function RecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getSupabase();

  const [{ data: recipe }, { data: ingredients }, { data: nutrition }] = await Promise.all([
    supabase.from('recipes').select('*').eq('id', id).maybeSingle<Recipe>(),
    supabase.from('ingredients').select('*').eq('recipe_id', id).returns<Ingredient[]>(),
    supabase.from('nutrition').select('*').eq('recipe_id', id).maybeSingle<Nutrition>(),
  ]);

  if (!recipe) notFound();
  const steps: string[] = Array.isArray(recipe.steps) ? recipe.steps : [];

  return (
    <article className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← All recipes
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{recipe.title}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {recipe.base_servings} serving{recipe.base_servings === 1 ? '' : 's'}
          {recipe.rating_value !== null &&
            ` · ★ ${recipe.rating_value} (${recipe.review_count ?? 0} reviews)`}
          {recipe.source_url && (
            <>
              {' · '}
              <a
                href={recipe.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                source
              </a>
            </>
          )}
        </p>
      </div>

      {nutrition && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-medium text-neutral-500">
            Per serving{' '}
            <span className="font-normal text-neutral-400">
              ({nutrition.is_estimated ? 'estimated ±15–20%' : 'from source'})
            </span>
          </h2>
          <div className="mt-2 grid grid-cols-4 gap-2 text-center">
            {(
              [
                ['Calories', nutrition.calories, ''],
                ['Protein', nutrition.protein_g, 'g'],
                ['Carbs', nutrition.carbs_g, 'g'],
                ['Fat', nutrition.fat_g, 'g'],
              ] as const
            ).map(([label, value, suffix]) => (
              <div key={label}>
                <div className="text-lg font-semibold">
                  {value !== null ? `${Math.round(value)}${suffix}` : '—'}
                </div>
                <div className="text-xs text-neutral-500">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <section>
        <h2 className="text-lg font-medium">Ingredients</h2>
        <ul className="mt-2 space-y-1 rounded-lg border border-neutral-200 bg-white p-4">
          {(ingredients ?? []).map((ing) => (
            <li key={ing.id} className="text-sm">
              {ing.raw_text ?? (
                <>
                  {ing.amount !== null && `${ing.amount} `}
                  {ing.unit && `${ing.unit} `}
                  {ing.canonical_name}
                </>
              )}
            </li>
          ))}
          {(ingredients ?? []).length === 0 && (
            <li className="text-sm text-neutral-500">No ingredients recorded.</li>
          )}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-medium">Steps</h2>
        {steps.length > 0 ? (
          <ol className="mt-2 space-y-3">
            {steps.map((step, i) => (
              <li
                key={i}
                className="flex gap-3 rounded-lg border border-neutral-200 bg-white p-4"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-medium text-white">
                  {i + 1}
                </span>
                <p className="text-sm leading-6">{step}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-neutral-500">
            No steps captured — check the source link above.
          </p>
        )}
      </section>
    </article>
  );
}
