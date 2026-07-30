import { NextResponse } from 'next/server';
import { extractRecipe } from '@/lib/extract';
import { storeRecipe, findBySourceUrl } from '@/lib/store';
import { getSupabase } from '@/lib/supabase';
import type { ExtractedRecipe, SourceType } from '@/lib/types';

export const maxDuration = 60;

/**
 * GET /api/ingest?url=… → dry run: extract only, never stores and never
 * spends nutrition-API quota. Backs the add-page preview; also useful for
 * diagnosing extraction issues (pass force=1 to extract a URL that is
 * already stored instead of getting the existingId short-circuit).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const url = params.get('url')?.trim() ?? '';
  const force = params.get('force') === '1';
  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: 'Provide ?url=' }, { status: 400 });
  }
  try {
    if (!force) {
      const existingId = await findBySourceUrl(url);
      if (existingId) return NextResponse.json({ ok: true, existingId });
    }
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

const SOURCE_TYPES: SourceType[] = ['web', 'instagram', 'tiktok', 'manual'];

const isNullableNumber = (v: unknown) =>
  v === null || (typeof v === 'number' && Number.isFinite(v));

/**
 * Shape-check a client-supplied extraction (from the preview flow) so Save
 * stores exactly what was previewed instead of extracting twice. sourceUrl
 * is deliberately excluded — the caller must override it with the request
 * url so dedupe stays trustworthy.
 */
function parseExtractedPayload(v: unknown): Omit<ExtractedRecipe, 'sourceUrl'> | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const isStringArray = (a: unknown): a is string[] =>
    Array.isArray(a) && a.every((s) => typeof s === 'string');
  if (typeof o.title !== 'string' || o.title.trim() === '') return null;
  if (!SOURCE_TYPES.includes(o.sourceType as SourceType)) return null;
  if (typeof o.baseServings !== 'number' || !Number.isFinite(o.baseServings) || o.baseServings <= 0)
    return null;
  if (!isStringArray(o.ingredientLines) || !isStringArray(o.steps)) return null;
  if (!isNullableNumber(o.ratingValue) || !isNullableNumber(o.reviewCount)) return null;
  if (o.imageUrl !== null && typeof o.imageUrl !== 'string') return null;
  let sourceNutrition: ExtractedRecipe['sourceNutrition'] = null;
  if (o.sourceNutrition !== null) {
    if (typeof o.sourceNutrition !== 'object') return null;
    const n = o.sourceNutrition as Record<string, unknown>;
    if (
      !isNullableNumber(n.calories) ||
      !isNullableNumber(n.protein_g) ||
      !isNullableNumber(n.carbs_g) ||
      !isNullableNumber(n.fat_g)
    )
      return null;
    sourceNutrition = {
      calories: n.calories as number | null,
      protein_g: n.protein_g as number | null,
      carbs_g: n.carbs_g as number | null,
      fat_g: n.fat_g as number | null,
    };
  }
  return {
    title: o.title.trim(),
    sourceType: o.sourceType as SourceType,
    baseServings: o.baseServings,
    ingredientLines: o.ingredientLines,
    steps: o.steps,
    ratingValue: o.ratingValue as number | null,
    reviewCount: o.reviewCount as number | null,
    imageUrl: o.imageUrl as string | null,
    sourceNutrition,
  };
}

/**
 * POST { url, force?, extracted? } → extract (or accept the previewed
 * extraction), store (§8).
 * force=true deletes any existing copy first and re-ingests fresh
 * (re-spends nutrition API quota — deliberate user action only).
 * extracted, when present, is the payload the preview flow already showed
 * the user — it is stored as-is (sourceUrl overridden with url) so Save
 * never re-runs extraction.
 */
export async function POST(request: Request) {
  let url: string;
  let force = false;
  let extractedPayload: unknown;
  try {
    const body = await request.json();
    url = typeof body?.url === 'string' ? body.url.trim() : '';
    force = body?.force === true;
    extractedPayload = body?.extracted;
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

    let extracted: ExtractedRecipe | null;
    if (extractedPayload !== undefined) {
      const parsed = parseExtractedPayload(extractedPayload);
      if (!parsed) {
        return NextResponse.json({ error: 'Invalid extracted payload' }, { status: 400 });
      }
      extracted = { ...parsed, sourceUrl: url };
    } else {
      extracted = await extractRecipe(url);
    }
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
