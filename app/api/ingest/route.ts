import { NextResponse } from 'next/server';
import { extractRecipe } from '@/lib/extract';
import { storeRecipe, findBySourceUrl } from '@/lib/store';
import { getSupabase } from '@/lib/supabase';

export const maxDuration = 60;

/**
 * GET /api/ingest?url=… → dry run: extract only, never stores and never
 * spends nutrition-API quota. For diagnosing extraction issues.
 */
export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get('url')?.trim() ?? '';
  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: 'Provide ?url=' }, { status: 400 });
  }
  try {
    const extracted = await extractRecipe(url);
    if (!extracted) {
      return NextResponse.json(
        { ok: false, reason: 'No recipe could be extracted from that URL' },
        { status: 422 }
      );
    }
    return NextResponse.json({ ok: true, extracted });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Extraction failed';
    return NextResponse.json({ ok: false, reason: message }, { status: 500 });
  }
}

/**
 * POST { url, force? } → extract, store (§8).
 * force=true deletes any existing copy first and re-ingests fresh
 * (re-spends nutrition API quota — deliberate user action only).
 */
export async function POST(request: Request) {
  let url: string;
  let force = false;
  try {
    const body = await request.json();
    url = typeof body?.url === 'string' ? body.url.trim() : '';
    force = body?.force === true;
    new URL(url); // validate
  } catch {
    return NextResponse.json({ error: 'Provide a valid { url }' }, { status: 400 });
  }

  try {
    // Check dedupe before doing any extraction work or spending API quota.
    const existing = await findBySourceUrl(url);
    if (existing && !force) {
      return NextResponse.json({ recipeId: existing, deduped: true });
    }
    if (existing && force) {
      const { error } = await getSupabase().from('recipes').delete().eq('id', existing);
      if (error) throw new Error(`Failed to delete existing recipe: ${error.message}`);
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
