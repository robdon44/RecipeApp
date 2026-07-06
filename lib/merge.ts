/**
 * Shopping-list combining (§9): scale each recipe's ingredients by
 * portions/base_servings, group by canonical name, sum within a unit class
 * using a small conversion table, and emit cross-class conflicts as separate
 * lines — no density conversion, deliberately.
 */
import type { Ingredient, ShoppingListItem, UnitClass } from './types';
import { normalizeUnit, unitClass } from './normalize';

/** Conversion factors to the base unit of each class (mass→g, volume→ml). */
const TO_BASE: Record<string, number> = {
  // mass → g
  g: 1,
  kg: 1000,
  oz: 28.3495,
  lb: 453.592,
  // volume → ml
  ml: 1,
  l: 1000,
  tsp: 4.92892,
  tbsp: 14.7868,
  'fl oz': 29.5735,
  cup: 236.588,
  pint: 473.176,
  quart: 946.353,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Present summed base amounts in a friendly unit (g/kg, ml/l), shopping-rounded. */
function present(total: number, cls: UnitClass): { amount: number; unit: string } {
  if (cls === 'mass') {
    return total >= 1000
      ? { amount: round2(total / 1000), unit: 'kg' }
      : { amount: Math.round(total), unit: 'g' };
  }
  return total >= 1000
    ? { amount: round2(total / 1000), unit: 'l' }
    : { amount: Math.round(total), unit: 'ml' };
}

export interface RecipePortion {
  ingredients: Ingredient[];
  baseServings: number;
  portions: number;
}

interface Bucket {
  /** mass/volume totals in base units (g/ml). */
  convertible: Partial<Record<'mass' | 'volume', number>>;
  /** count/other and unconvertible units, keyed by unit token. */
  byUnit: Map<string, number>;
  /** lines with no usable amount — passed through as-is. */
  unscalable: string[];
}

/**
 * Merge scaled ingredients across recipes into one flat shopping list.
 */
export function mergeIngredients(recipes: RecipePortion[]): ShoppingListItem[] {
  const buckets = new Map<string, Bucket>();

  for (const { ingredients, baseServings, portions } of recipes) {
    const factor = portions / Math.max(baseServings, 1);
    for (const ing of ingredients) {
      const name = ing.canonical_name;
      let bucket = buckets.get(name);
      if (!bucket) {
        bucket = { convertible: {}, byUnit: new Map(), unscalable: [] };
        buckets.set(name, bucket);
      }

      if (ing.amount === null || ing.amount === undefined) {
        bucket.unscalable.push(ing.raw_text ?? name);
        continue;
      }

      const scaled = ing.amount * factor;
      const unit = normalizeUnit(ing.unit);
      const cls = ing.unit_class ?? unitClass(ing.unit);

      if ((cls === 'mass' || cls === 'volume') && unit && TO_BASE[unit] !== undefined) {
        bucket.convertible[cls] = (bucket.convertible[cls] ?? 0) + scaled * TO_BASE[unit];
      } else {
        // count/other units sum only when the unit token matches exactly
        const key = unit ?? '';
        bucket.byUnit.set(key, (bucket.byUnit.get(key) ?? 0) + scaled);
      }
    }
  }

  const items: ShoppingListItem[] = [];
  for (const [name, bucket] of buckets) {
    const lines: ShoppingListItem[] = [];

    for (const cls of ['mass', 'volume'] as const) {
      const total = bucket.convertible[cls];
      if (total !== undefined) {
        const { amount, unit } = present(total, cls);
        lines.push({ name, amount, unit });
      }
    }
    for (const [unit, amount] of bucket.byUnit) {
      lines.push({ name, amount: round2(amount), unit: unit || null });
    }
    for (const raw of bucket.unscalable) {
      lines.push({ name, amount: null, unit: null, note: raw });
    }

    // Cross-class conflict (§9.5): same ingredient in incompatible units —
    // keep separate lines but flag them so the shopper knows they're one thing.
    if (lines.length > 1) {
      for (const line of lines) {
        line.note = line.note
          ? `${line.note} (listed in multiple units — combine when shopping)`
          : 'listed in multiple units — combine when shopping';
      }
    }
    items.push(...lines);
  }

  return items.sort((a, b) => a.name.localeCompare(b.name));
}

/** Render the merged list as plain text — the AnyList-failure fallback (§11). */
export function listToPlainText(items: ShoppingListItem[]): string {
  return items
    .map((i) => {
      const qty = i.amount !== null ? `${i.amount}${i.unit ? ' ' + i.unit : ''} ` : '';
      const note = i.note ? ` — ${i.note}` : '';
      return `- ${qty}${i.name}${note}`;
    })
    .join('\n');
}
