'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Re-runs the full ingestion pipeline for this recipe's source URL,
 * replacing the stored copy (new id). Useful after extraction improvements.
 */
export default function ReimportButton({ url }: { url: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reimport() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, force: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      router.push(`/recipe/${data.recipeId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Re-import failed');
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={reimport}
        disabled={busy}
        className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-600 hover:border-neutral-500 disabled:opacity-50"
        title="Re-fetch this recipe from its source and re-parse ingredients"
      >
        {busy ? 'Re-importing…' : '↻ Re-import'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
