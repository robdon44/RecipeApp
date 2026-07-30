'use client';

import type { ExtractedRecipe } from '@/lib/types';

interface Props {
  extracted: ExtractedRecipe;
  expanded: boolean;
  saving: boolean;
  error: string | null;
  onToggle: () => void;
  onEdit: (patch: Partial<ExtractedRecipe>) => void;
  onSave: () => void;
  onCancel: () => void;
}

/**
 * Preview of an extracted-but-not-yet-stored recipe. Collapsed shows a
 * summary card; clicking it expands the full ingredient lines and steps
 * plus editable servings/macros. Nothing is stored until Save.
 */
export default function RecipePreviewCard({
  extracted,
  expanded,
  saving,
  error,
  onToggle,
  onEdit,
  onSave,
  onCancel,
}: Props) {
  const n = extracted.sourceNutrition;

  function editNutrition(field: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g', raw: string) {
    const value = raw.trim() === '' ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) return;
    const next = {
      calories: n?.calories ?? null,
      protein_g: n?.protein_g ?? null,
      carbs_g: n?.carbs_g ?? null,
      fat_g: n?.fat_g ?? null,
      [field]: value,
    };
    const allBlank = Object.values(next).every((v) => v === null);
    onEdit({ sourceNutrition: allBlank ? null : next });
  }

  const macroField = (
    label: string,
    field: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g'
  ) => (
    <label className="flex flex-col gap-1 text-xs text-neutral-500">
      {label}
      <input
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        defaultValue={n?.[field] ?? ''}
        onChange={(e) => editNutrition(field, e.target.value)}
        className="w-20 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none"
      />
    </label>
  );

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <div
        onClick={onToggle}
        className="cursor-pointer hover:bg-neutral-50"
        title={expanded ? 'Hide details' : 'Show details'}
      >
        {extracted.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary external hosts; next/image needs per-domain config
          <img src={extracted.imageUrl} alt="" className="h-36 w-full object-cover" loading="lazy" />
        )}
        <div className="p-4">
          <h2 className="font-medium">{extracted.title}</h2>
          <p className="mt-1 text-xs text-neutral-500">
            {extracted.baseServings} serving{extracted.baseServings === 1 ? '' : 's'} ·{' '}
            {extracted.ingredientLines.length} ingredient
            {extracted.ingredientLines.length === 1 ? '' : 's'}
            {extracted.ratingValue !== null &&
              ` · ★ ${extracted.ratingValue} (${extracted.reviewCount ?? 0})`}
          </p>
          <p className="mt-2 text-xs text-neutral-400">
            {expanded ? 'Hide details' : 'Tap to preview ingredients & steps'}
          </p>
        </div>
      </div>

      {expanded && (
        <div className="space-y-4 border-t border-neutral-200 p-4 text-sm">
          <div className="flex flex-wrap items-end gap-3" onClick={(e) => e.stopPropagation()}>
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              Servings
              <input
                type="number"
                min={1}
                step="any"
                inputMode="decimal"
                defaultValue={extracted.baseServings}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v > 0) onEdit({ baseServings: v });
                }}
                className="w-20 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none"
              />
            </label>
            {macroField('Calories / serving', 'calories')}
            {macroField('Protein g', 'protein_g')}
            {macroField('Carbs g', 'carbs_g')}
            {macroField('Fat g', 'fat_g')}
          </div>
          <p className="text-xs text-neutral-400">
            Macros are per serving. Leave blank to estimate from ingredients on save.
          </p>

          <div>
            <h3 className="font-medium">Ingredients</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-neutral-700">
              {extracted.ingredientLines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>

          {extracted.steps.length > 0 && (
            <div>
              <h3 className="font-medium">Steps</h3>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-neutral-700">
                {extracted.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-neutral-200 p-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save recipe'}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-600 hover:border-neutral-500 disabled:opacity-50"
        >
          Cancel
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}
