import { getSupabase } from '@/lib/supabase';
import ListBuilder from './ListBuilder';

export const dynamic = 'force-dynamic';

export default async function ShoppingListPage() {
  let recipes: Array<{ id: string; title: string; base_servings: number }> = [];
  let loadError: string | null = null;
  try {
    const { data, error } = await getSupabase()
      .from('recipes')
      .select('id, title, base_servings')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    recipes = data ?? [];
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Failed to load recipes';
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Shopping list</h1>
      {loadError ? (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{loadError}</p>
      ) : (
        <ListBuilder recipes={recipes} />
      )}
    </div>
  );
}
