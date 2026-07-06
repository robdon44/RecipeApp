'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DeleteButton({ recipeId }: { recipeId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm('Delete this recipe? This cannot be undone.')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recipe/${recipeId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={remove}
        disabled={busy}
        className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs text-red-600 hover:border-red-400 disabled:opacity-50"
      >
        {busy ? 'Deleting…' : 'Delete'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
