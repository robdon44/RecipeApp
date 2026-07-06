import type { UnitClass } from './types';

/**
 * AU/US synonym normalization (§8.7). Maps variants to a single canonical name
 * so the shopping-list merge can combine ingredients across recipes (§13).
 * Canonical names are the AU terms per the brief's examples.
 */
const SYNONYMS: Record<string, string> = {
  cilantro: 'coriander',
  'cilantro leaves': 'coriander',
  'fresh cilantro': 'coriander',
  'coriander leaves': 'coriander',
  'fresh coriander': 'coriander',
  'bell pepper': 'capsicum',
  'bell peppers': 'capsicum',
  'red bell pepper': 'capsicum',
  'green bell pepper': 'capsicum',
  'yellow bell pepper': 'capsicum',
  shrimp: 'prawns',
  shrimps: 'prawns',
  prawn: 'prawns',
  scallion: 'spring onion',
  scallions: 'spring onion',
  'green onion': 'spring onion',
  'green onions': 'spring onion',
  'spring onions': 'spring onion',
  eggplant: 'aubergine',
  zucchini: 'courgette',
  'garbanzo beans': 'chickpeas',
  'garbanzo bean': 'chickpeas',
  chickpea: 'chickpeas',
  'confectioners sugar': 'icing sugar',
  "confectioner's sugar": 'icing sugar',
  'powdered sugar': 'icing sugar',
  'superfine sugar': 'caster sugar',
  'heavy cream': 'thickened cream',
  'heavy whipping cream': 'thickened cream',
  'all-purpose flour': 'plain flour',
  'all purpose flour': 'plain flour',
  'ap flour': 'plain flour',
  'ground beef': 'beef mince',
  'minced beef': 'beef mince',
  'ground pork': 'pork mince',
  'minced pork': 'pork mince',
  'ground chicken': 'chicken mince',
  'ground lamb': 'lamb mince',
  'ground turkey': 'turkey mince',
  'tomato paste': 'tomato paste', // identity entries keep lookups simple
  'romaine lettuce': 'cos lettuce',
  romaine: 'cos lettuce',
  'snow pea': 'snow peas',
  arugula: 'rocket',
};

/** Lowercase, trim, strip trailing punctuation and collapse whitespace. */
function clean(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,;:!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Naive last-word singularization so "chicken thighs" merges with
 * "chicken thigh". Deliberately conservative: leaves -ss/-us/-is words alone.
 */
function singularize(name: string): string {
  const words = name.split(' ');
  const last = words[words.length - 1];
  let singular = last;
  if (/ies$/.test(last) && last.length > 4) singular = last.slice(0, -3) + 'y';
  else if (/(oes|ches|shes|sses|xes|zes)$/.test(last)) singular = last.replace(/es$/, '');
  else if (/s$/.test(last) && !/(ss|us|is)$/.test(last)) singular = last.slice(0, -1);
  words[words.length - 1] = singular;
  return words.join(' ');
}

export function canonicalName(name: string): string {
  const cleaned = clean(name);
  // Synonym table first (it may intentionally map to a plural like "prawns"),
  // then retry the lookup on the singularized form.
  if (SYNONYMS[cleaned]) return SYNONYMS[cleaned];
  const singular = singularize(cleaned);
  return SYNONYMS[singular] ?? singular;
}

/**
 * Unit normalization: map the many spellings of a unit to one token,
 * and classify it for the merge step (§9).
 */
const UNIT_ALIASES: Record<string, string> = {
  g: 'g',
  gram: 'g',
  grams: 'g',
  kg: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  ml: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  millilitre: 'ml',
  millilitres: 'ml',
  l: 'l',
  liter: 'l',
  liters: 'l',
  litre: 'l',
  litres: 'l',
  cup: 'cup',
  cups: 'cup',
  c: 'cup',
  tbsp: 'tbsp',
  tbsps: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  tbs: 'tbsp',
  tsp: 'tsp',
  tsps: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  'fl oz': 'fl oz',
  'fluid ounce': 'fl oz',
  'fluid ounces': 'fl oz',
  pint: 'pint',
  pints: 'pint',
  quart: 'quart',
  quarts: 'quart',
  clove: 'clove',
  cloves: 'clove',
  slice: 'slice',
  slices: 'slice',
  piece: 'piece',
  pieces: 'piece',
  whole: 'whole',
  can: 'can',
  cans: 'can',
  bunch: 'bunch',
  bunches: 'bunch',
  head: 'head',
  heads: 'head',
  stalk: 'stalk',
  stalks: 'stalk',
  sprig: 'sprig',
  sprigs: 'sprig',
  pinch: 'pinch',
  pinches: 'pinch',
  dash: 'dash',
  serving: 'serving',
  servings: 'serving',
  large: 'whole',
  medium: 'whole',
  small: 'whole',
};

const MASS_UNITS = new Set(['g', 'kg', 'oz', 'lb']);
const VOLUME_UNITS = new Set(['ml', 'l', 'cup', 'tbsp', 'tsp', 'fl oz', 'pint', 'quart']);
const COUNT_UNITS = new Set([
  'clove', 'slice', 'piece', 'whole', 'can', 'bunch', 'head', 'stalk', 'sprig', 'serving',
]);

export function normalizeUnit(unit: string | null | undefined): string | null {
  if (!unit) return null;
  const cleaned = clean(unit);
  if (!cleaned) return null;
  return UNIT_ALIASES[cleaned] ?? cleaned;
}

export function unitClass(unit: string | null | undefined): UnitClass {
  const normalized = normalizeUnit(unit);
  // A bare amount with no unit ("2 eggs") is a count of the item itself.
  if (!normalized) return 'count';
  if (MASS_UNITS.has(normalized)) return 'mass';
  if (VOLUME_UNITS.has(normalized)) return 'volume';
  if (COUNT_UNITS.has(normalized)) return 'count';
  return 'other';
}
