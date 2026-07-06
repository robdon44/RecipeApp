'use client';

import { useState } from 'react';
import Link from 'next/link';

interface DiscoverOutcome {
  added: Array<{ url: string; title: string; recipeId: string }>;
  skipped: Array<{ url: string; reason: string }>;
}

export default function AddPage() {
  const [url, setUrl] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<
    | { kind: 'ok'; recipeId: string; deduped: boolean }
    | { kind: 'error'; message: string }
    | null
  >(null);

  const [query, setQuery] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<
    DiscoverOutcome | { error: string } | null
  >(null);

  async function ingest(e: React.FormEvent) {
    e.preventDefault();
    setIngesting(true);
    setIngestResult(null);
    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIngestResult({ kind: 'error', message: data.error ?? `Failed (${res.status})` });
      } else {
        setIngestResult({ kind: 'ok', recipeId: data.recipeId, deduped: !!data.deduped });
        setUrl('');
      }
    } catch (err) {
      setIngestResult({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Request failed',
      });
    } finally {
      setIngesting(false);
    }
  }

  async function discover(e: React.FormEvent) {
    e.preventDefault();
    setDiscovering(true);
    setDiscoverResult(null);
    try {
      const res = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      setDiscoverResult(res.ok ? data : { error: data.error ?? `Failed (${res.status})` });
    } catch (err) {
      setDiscoverResult({ error: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setDiscovering(false);
    }
  }

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold">Add a recipe</h1>
        <p className="text-sm text-neutral-600">
          Paste any recipe page, Instagram or TikTok post URL.
        </p>
        <form onSubmit={ingest} className="flex gap-2">
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={ingesting}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {ingesting ? 'Capturing…' : 'Capture'}
          </button>
        </form>
        {ingestResult?.kind === 'ok' && (
          <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">
            {ingestResult.deduped ? 'Already saved. ' : 'Recipe captured! '}
            <Link href={`/recipe/${ingestResult.recipeId}`} className="underline">
              View it
            </Link>
          </p>
        )}
        {ingestResult?.kind === 'error' && (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{ingestResult.message}</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Discover popular recipes</h2>
        <p className="text-sm text-neutral-600">
          Searches the web and auto-saves recipes rated ≥4.3 with 50+ reviews.
        </p>
        <form onSubmit={discover} className="flex gap-2">
          <input
            type="text"
            required
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. high protein chicken dinner"
            className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={discovering}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {discovering ? 'Searching…' : 'Search'}
          </button>
        </form>
        {discovering && (
          <p className="text-sm text-neutral-500">
            Searching, checking ratings, and ingesting — this can take a minute…
          </p>
        )}
        {discoverResult && 'error' in discoverResult && (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{discoverResult.error}</p>
        )}
        {discoverResult && 'added' in discoverResult && (
          <div className="space-y-3 text-sm">
            <div className="rounded-md bg-green-50 p-3 text-green-800">
              <p className="font-medium">Added {discoverResult.added.length}</p>
              <ul className="mt-1 space-y-1">
                {discoverResult.added.map((a) => (
                  <li key={a.recipeId}>
                    <Link href={`/recipe/${a.recipeId}`} className="underline">
                      {a.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            {discoverResult.skipped.length > 0 && (
              <details className="rounded-md bg-neutral-100 p-3 text-neutral-600">
                <summary className="cursor-pointer font-medium">
                  Skipped {discoverResult.skipped.length}
                </summary>
                <ul className="mt-2 space-y-1">
                  {discoverResult.skipped.map((s) => (
                    <li key={s.url} className="break-all">
                      {s.url} — {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
