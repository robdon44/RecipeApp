import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

/** DELETE /api/recipe/[id] → remove recipe (ingredients + nutrition cascade). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { data, error } = await getSupabase()
      .from('recipes')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
    }
    return NextResponse.json({ deleted: id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Delete failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
