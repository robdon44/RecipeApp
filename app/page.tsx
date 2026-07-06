import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import type { Nutrition, Recipe } from '@/lib/types';

export const dynamic = 'force-dynamic';

type RecipeRow = Recipe & { nutrition: Nutrition[] | Nutrition | null };

function firstNutrition(n: RecipeRow['nutrition']): Nutrition | null {
  if (!n) return null;
  return Array.isArray(n) ? (n[0] ?? null) : n;
}

const QUICK_FILTERS = [
  { label: 'All', params: '' },
  { label: 'High protein (≥30g)', params: '?minProtein=30' },
  { label: 'Under 500 cal', params: '?maxCalories=500' },
  { label: 'Under 700 cal', params: '?maxCalories=700' },
];

export default async function RecipeListPage({
  searchParams,
}: {
  searchParams: Promise<{ minProtein?: string; maxCalories?: string }>;
}) {
  const params = await searchParams;
  const minProtein = params.minProtein ? parseFloat(params.minProtein) : null;
  const maxCalories = params.maxCalories ? parseFloat(params.maxCalories) : null;

  let recipes: RecipeRow[] = [];
  let loadError: string | null = null;
  try {
    const { data, error } = await getSupabase()
      .from('recipes')
      .select('*, nutrition(*)')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    recipes = (data ?? []) as RecipeRow[];
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Failed to load recipes';
  }

  const filtered = recipes.filter((r) => {
    const n = firstNutrition(r.nutrition);
    if (minProtein !== null && ((n?.protein_g ?? null) === null || n!.protein_g! < minProtein))
      return false;
    if (maxCalories !== null && ((n?.calories ?? null) === null || n!.calories! > maxCalories))
      return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Recipes</h1>
        <Link
          href="/add"
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700"
        >
          + Add recipe
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {QUICK_FILTERS.map((f) => (
          <Link
            key={f.label}
            href={`/${f.params}`}
            className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-700 hover:border-neutral-500"
          >
            {f.label}
          </Link>
        ))}
      </div>

      {loadError && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          Could not load recipes: {loadError}
        </p>
      )}

      {!loadError && filtered.length === 0 && (
        <p className="text-neutral-500">
          No recipes {recipes.length > 0 ? 'match these filters' : 'yet'}.{' '}
          <Link href="/add" className="underline">
            Add one
          </Link>
          .
        </p>
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {filtered.map((r) => {
          const n = firstNutrition(r.nutrition);
          return (
            <li key={r.id}>
              <Link
                href={`/recipe/${r.id}`}
                className="block overflow-hidden rounded-lg border border-neutral-200 bg-white hover:border-neutral-400"
              >
                {r.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary external hosts; next/image needs per-domain config
                  <img
                    src={r.image_url}
                    alt=""
                    className="h-36 w-full object-cover"
                    loading="lazy"
                  />
                )}
                <div className="p-4">
                <h2 className="font-medium">{r.title}</h2>
                <p className="mt-1 text-xs text-neutral-500">
                  {r.base_servings} serving{r.base_servings === 1 ? '' : 's'}
                  {r.rating_value !== null && ` · ★ ${r.rating_value} (${r.review_count ?? 0})`}
                </p>
                {n && (
                  <p className="mt-2 text-sm text-neutral-700">
                    {n.calories !== null && <span>{Math.round(n.calories)} cal</span>}
                    {n.protein_g !== null && <span> · {Math.round(n.protein_g)}g protein</span>}
                    {n.carbs_g !== null && <span> · {Math.round(n.carbs_g)}g carbs</span>}
                    {n.fat_g !== null && <span> · {Math.round(n.fat_g)}g fat</span>}
                    <span className="ml-1 text-xs text-neutral-400">
                      {n.is_estimated ? '(estimated)' : '(from source)'}
                    </span>
                  </p>
                )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
