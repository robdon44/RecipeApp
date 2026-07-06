import { NextResponse } from 'next/server';
import { fetchHtml, extractFromJsonLd } from '@/lib/extract';
import { storeRecipe, findBySourceUrl } from '@/lib/store';
import { MIN_RATING_VALUE, MIN_REVIEW_COUNT, DISCOVER_MAX_RESULTS } from '@/lib/config';

export const maxDuration = 300;

interface TavilyResult {
  url: string;
  title: string;
}

async function tavilySearch(query: string): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('Missing TAVILY_API_KEY — see .env.example');

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      query: `${query} recipe`,
      max_results: DISCOVER_MAX_RESULTS,
      search_depth: 'basic',
    }),
  });
  if (!res.ok) throw new Error(`Tavily search failed: ${res.status} ${await res.text()}`);
  const data: { results?: TavilyResult[] } = await res.json();
  return data.results ?? [];
}

/**
 * POST { query } → Tavily search, JSON-LD read, popularity gate,
 * auto-ingest passers (§10). Returns added + skipped with reasons.
 */
export async function POST(request: Request) {
  let query: string;
  try {
    const body = await request.json();
    query = typeof body?.query === 'string' ? body.query.trim() : '';
    if (!query) throw new Error();
  } catch {
    return NextResponse.json({ error: 'Provide a { query }' }, { status: 400 });
  }

  try {
    const results = await tavilySearch(query);
    const added: Array<{ url: string; title: string; recipeId: string }> = [];
    const skipped: Array<{ url: string; reason: string }> = [];

    for (const result of results) {
      try {
        if (await findBySourceUrl(result.url)) {
          skipped.push({ url: result.url, reason: 'already ingested' });
          continue;
        }

        const html = await fetchHtml(result.url);
        const extracted = extractFromJsonLd(html, result.url);
        if (!extracted) {
          skipped.push({ url: result.url, reason: 'no recipe JSON-LD found' });
          continue;
        }

        // Popularity gate (§2): rating-based, both thresholds must pass.
        if (
          extracted.reviewCount === null ||
          extracted.ratingValue === null ||
          extracted.reviewCount < MIN_REVIEW_COUNT ||
          extracted.ratingValue < MIN_RATING_VALUE
        ) {
          skipped.push({
            url: result.url,
            reason: `failed popularity gate (rating ${extracted.ratingValue ?? 'n/a'}, reviews ${extracted.reviewCount ?? 'n/a'}; need ≥${MIN_RATING_VALUE} and ≥${MIN_REVIEW_COUNT})`,
          });
          continue;
        }

        const stored = await storeRecipe(extracted);
        added.push({ url: result.url, title: stored.title, recipeId: stored.recipeId });
      } catch (err) {
        skipped.push({
          url: result.url,
          reason: err instanceof Error ? err.message : 'fetch/extract failed',
        });
      }
    }

    return NextResponse.json({ query, added, skipped });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Discovery failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
