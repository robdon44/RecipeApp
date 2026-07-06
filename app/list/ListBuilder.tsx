'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ShoppingListItem } from '@/lib/types';

interface RecipeOption {
  id: string;
  title: string;
  base_servings: number;
}

export default function ListBuilder({ recipes }: { recipes: RecipeOption[] }) {
  const [portions, setPortions] = useState<Record<string, number>>({});
  const [merging, setMerging] = useState(false);
  const [merged, setMerged] = useState<{ items: ShoppingListItem[]; plainText: string } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<
    | { pushed: true; listName: string; count: number }
    | { pushed: false; error: string; plainText: string }
    | null
  >(null);

  const selected = Object.entries(portions).filter(([, p]) => p > 0);

  function setPortion(id: string, value: number) {
    setPortions((prev) => ({ ...prev, [id]: value }));
    setMerged(null);
    setPushResult(null);
  }

  async function buildList() {
    setMerging(true);
    setError(null);
    setMerged(null);
    setPushResult(null);
    try {
      const res = await fetch('/api/shopping-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: selected.map(([recipeId, p]) => ({ recipeId, portions: p })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      setMerged(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      setMerging(false);
    }
  }

  async function pushToAnyList() {
    if (!merged) return;
    setPushing(true);
    setPushResult(null);
    try {
      const res = await fetch('/api/anylist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: merged.items }),
      });
      setPushResult(await res.json());
    } catch (err) {
      setPushResult({
        pushed: false,
        error: err instanceof Error ? err.message : 'Push failed',
        plainText: merged.plainText,
      });
    } finally {
      setPushing(false);
    }
  }

  if (recipes.length === 0) {
    return (
      <p className="text-neutral-500">
        No recipes saved yet.{' '}
        <Link href="/add" className="underline">
          Add some first
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-neutral-200 bg-white">
        <ul className="divide-y divide-neutral-100">
          {recipes.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-4 p-3">
              <div>
                <p className="text-sm font-medium">{r.title}</p>
                <p className="text-xs text-neutral-500">base: {r.base_servings} servings</p>
              </div>
              <label className="flex items-center gap-2 text-sm text-neutral-600">
                portions
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={portions[r.id] ?? 0}
                  onChange={(e) => setPortion(r.id, Math.max(0, Number(e.target.value)))}
                  className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-sm"
                />
              </label>
            </li>
          ))}
        </ul>
      </section>

      <button
        onClick={buildList}
        disabled={selected.length === 0 || merging}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
      >
        {merging
          ? 'Combining…'
          : `Build combined list (${selected.length} recipe${selected.length === 1 ? '' : 's'})`}
      </button>

      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {merged && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Combined list</h2>
          <ul className="space-y-1 rounded-lg border border-neutral-200 bg-white p-4 text-sm">
            {merged.items.map((item, i) => (
              <li key={i}>
                {item.amount !== null && `${item.amount}${item.unit ? ' ' + item.unit : ''} `}
                <span className="font-medium">{item.name}</span>
                {item.note && <span className="text-xs text-neutral-500"> — {item.note}</span>}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              onClick={pushToAnyList}
              disabled={pushing}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {pushing ? 'Pushing…' : 'Push to AnyList'}
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(merged.plainText)}
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm hover:border-neutral-500"
            >
              Copy as text
            </button>
          </div>
        </section>
      )}

      {pushResult?.pushed === true && (
        <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">
          Pushed {pushResult.count} items to AnyList list “{pushResult.listName}”.
        </p>
      )}
      {pushResult?.pushed === false && (
        <div className="space-y-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          <p>
            AnyList push failed ({pushResult.error}) — here’s your list as text so you’re not
            blocked:
          </p>
          <pre className="whitespace-pre-wrap rounded bg-white/60 p-2 text-xs">
            {pushResult.plainText}
          </pre>
        </div>
      )}
    </div>
  );
}
