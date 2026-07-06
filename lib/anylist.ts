/**
 * AnyList export (§11) via the unofficial `anylist` npm library.
 * Reverse-engineered lib — treat every call as fallible. On failure the API
 * route returns the plain-text list instead, so the user is never blocked.
 */
import AnyList from 'anylist';
import type { ShoppingListItem } from './types';
import { ANYLIST_LIST_NAME } from './config';

export interface AnyListPushResult {
  ok: boolean;
  listName: string;
  pushed: number;
  error?: string;
}

export async function pushToAnyList(items: ShoppingListItem[]): Promise<AnyListPushResult> {
  const email = process.env.ANYLIST_EMAIL;
  const password = process.env.ANYLIST_PASSWORD;
  if (!email || !password) {
    return {
      ok: false,
      listName: ANYLIST_LIST_NAME,
      pushed: 0,
      error: 'Missing ANYLIST_EMAIL or ANYLIST_PASSWORD — see .env.example',
    };
  }

  const client = new AnyList({ email, password, credentialsFile: null });
  try {
    // false = skip the live-updates websocket; pointless for a one-shot
    // serverless push and its browser-oriented dependency breaks there.
    await client.login(false);
    await client.getLists();
    const list = client.getListByName(ANYLIST_LIST_NAME);
    if (!list) {
      return {
        ok: false,
        listName: ANYLIST_LIST_NAME,
        pushed: 0,
        error: `AnyList list "${ANYLIST_LIST_NAME}" not found — create it in the AnyList app first`,
      };
    }

    let pushed = 0;
    for (const item of items) {
      const quantity =
        item.amount !== null ? `${item.amount}${item.unit ? ' ' + item.unit : ''}` : undefined;
      // Measurement goes in details too — AnyList doesn't always surface the
      // quantity field in the list view, and details always shows.
      const details = [quantity, item.note].filter(Boolean).join(' · ') || undefined;
      const existing = list.getItemByName(item.name);
      if (existing) {
        existing.checked = false;
        if (quantity) existing.quantity = quantity;
        if (details) existing.details = details;
        await existing.save();
      } else {
        await list.addItem(client.createItem({ name: item.name, quantity, details }));
      }
      pushed++;
    }
    return { ok: true, listName: ANYLIST_LIST_NAME, pushed };
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err);
    if (message.includes('401')) {
      message +=
        ' — AnyList rejected the email/password. Check ANYLIST_EMAIL/ANYLIST_PASSWORD, and make sure the account has a password set (Apple/Google sign-in accounts need one created via password reset).';
    }
    return {
      ok: false,
      listName: ANYLIST_LIST_NAME,
      pushed: 0,
      error: message,
    };
  } finally {
    try {
      client.teardown();
    } catch {
      // teardown failures are irrelevant once the push outcome is known
    }
  }
}
