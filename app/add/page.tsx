'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { MIN_RATING_VALUE, MIN_REVIEW_COUNT } from '@/lib/config';
import type { ExtractedRecipe } from '@/lib/types';
import RecipePreviewCard from './RecipePreviewCard';

interface DiscoverOutcome {
  added: Array<{ url: string; title: string; recipeId: string }>;
  skipped: Array<{ url: string; reason: string }>;
}

type ImportState =
  | { phase: 'idle' }
  | { phase: 'extracting' }
  | {
      phase: 'preview';
      extracted: ExtractedRecipe;
      expanded: boolean;
      saving: boolean;
      error: string | null;
    }
  | { phase: 'exists'; recipeId: string }
  | { phase: 'saved'; recipeId: string; deduped: boolean }
  | { phase: 'error'; message: string };

export default function AddPage() {
  const [url, setUrl] = useState('');
  const [importState, setImportState] = useState<ImportState>({ phase: 'idle' });
  // Keyboard stays suppressed (inputMode="none") until clipboard access
  // fails and the user has to type/long-press paste instead.
  const [manualEntry, setManualEntry] = useState(false);
  const [pasteHint, setPasteHint] = useState<string | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<
    DiscoverOutcome | { error: string } | null
  >(null);

  async function pasteUrl() {
    setPasteHint(null);
    try {
      if (!navigator.clipboard?.readText) throw new Error('Clipboard unavailable');
      const text = (await navigator.clipboard.readText()).trim();
      // Share sheets often copy "Check this out https://…" — keep just the URL.
      const match = text.match(/https?:\/\/\S+/);
      setUrl(match ? match[0] : text);
      setImportState({ phase: 'idle' });
    } catch {
      setManualEntry(true);
      setPasteHint('Clipboard unavailable — paste into the field instead.');
      urlInputRef.current?.focus();
    }
  }

  async function preview(e: React.FormEvent) {
    e.preventDefault();
    setImportState({ phase: 'extracting' });
    try {
      const res = await fetch(`/api/ingest?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!res.ok) {
        setImportState({
          phase: 'error',
          message: data.reason ?? data.error ?? `Failed (${res.status})`,
        });
      } else if (data.existingId) {
        setImportState({ phase: 'exists', recipeId: data.existingId });
      } else {
        setImportState({
          phase: 'preview',
          extracted: data.extracted,
          expanded: false,
          saving: false,
          error: null,
        });
      }
    } catch (err) {
      setImportState({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Request failed',
      });
    }
  }

  async function save() {
    if (importState.phase !== 'preview') return;
    const { extracted } = importState;
    setImportState({ ...importState, saving: true, error: null });
    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, extracted }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      setImportState({ phase: 'saved', recipeId: data.recipeId, deduped: !!data.deduped });
      setUrl('');
    } catch (err) {
      setImportState({
        ...importState,
        saving: false,
        error: err instanceof Error ? err.message : 'Save failed',
      });
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
        <form onSubmit={preview} className="flex gap-2">
          <input
            ref={urlInputRef}
            type="url"
            required
            value={url}
            inputMode={manualEntry ? 'url' : 'none'}
            onChange={(e) => {
              setUrl(e.target.value);
              // A different URL invalidates any preview/result on screen.
              setImportState({ phase: 'idle' });
            }}
            placeholder="https://…"
            className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={pasteUrl}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-600 hover:border-neutral-500"
          >
            Paste
          </button>
          <button
            type="submit"
            disabled={importState.phase === 'extracting'}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {importState.phase === 'extracting' ? 'Fetching…' : 'Preview'}
          </button>
        </form>
        {pasteHint && <p className="text-xs text-neutral-500">{pasteHint}</p>}
        {importState.phase === 'extracting' && (
          <p className="text-sm text-neutral-500">
            Fetching and extracting the recipe — social posts can take a little longer…
          </p>
        )}
        {importState.phase === 'preview' && (
          <RecipePreviewCard
            key={url}
            extracted={importState.extracted}
            expanded={importState.expanded}
            saving={importState.saving}
            error={importState.error}
            onToggle={() =>
              setImportState({ ...importState, expanded: !importState.expanded })
            }
            onEdit={(patch) =>
              setImportState({
                ...importState,
                extracted: { ...importState.extracted, ...patch },
              })
            }
            onSave={save}
            onCancel={() => {
              setUrl('');
              setImportState({ phase: 'idle' });
            }}
          />
        )}
        {importState.phase === 'exists' && (
          <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">
            Already saved.{' '}
            <Link href={`/recipe/${importState.recipeId}`} className="underline">
              View it
            </Link>
          </p>
        )}
        {importState.phase === 'saved' && (
          <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">
            {importState.deduped ? 'Already saved. ' : 'Recipe saved! '}
            <Link href={`/recipe/${importState.recipeId}`} className="underline">
              View it
            </Link>
          </p>
        )}
        {importState.phase === 'error' && (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{importState.message}</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Discover popular recipes</h2>
        <p className="text-sm text-neutral-600">
          Searches the web and auto-saves recipes rated ≥{MIN_RATING_VALUE} with{' '}
          {MIN_REVIEW_COUNT}+ reviews.
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
