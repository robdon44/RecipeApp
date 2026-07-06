/** Popularity gate for discovery (§2, §10). Rating-based, not engagement-based. */
export const MIN_REVIEW_COUNT = 50;
export const MIN_RATING_VALUE = 4.3;

/** Name of the AnyList list the merged shopping list is pushed to. */
export const ANYLIST_LIST_NAME = process.env.ANYLIST_LIST_NAME ?? 'Recipe App';

/** Max search results to consider per discovery query. */
export const DISCOVER_MAX_RESULTS = 10;
