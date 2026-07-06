import { NextResponse } from 'next/server';
import { extractRecipe } from '@/lib/extract';
import { storeRecipe, findBySourceUrl } from '@/lib/store';

export const maxDuration = 60;

/** POST { url } → extract, store (§8). */
export async function POST(request: Request) {
  let url: string;
  try {
    const body = await request.json();
    url = typeof body?.url === 'string' ? body.url.trim() : '';
    new URL(url); // validate
  } catch {
    return NextResponse.json({ error: 'Provide a valid { url }' }, { status: 400 });
  }

  try {
    // Check dedupe before doing any extraction work or spending API quota.
    const existing = await findBySourceUrl(url);
    if (existing) {
      return NextResponse.json({ recipeId: existing, deduped: true });
    }

    const extracted = await extractRecipe(url);
    if (!extracted) {
      return NextResponse.json(
        { error: 'No recipe could be extracted from that URL' },
        { status: 422 }
      );
    }

    const result = await storeRecipe(extracted);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ingestion failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
