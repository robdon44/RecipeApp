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
    await client.login();
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
      const existing = list.getItemByName(item.name);
      if (existing) {
        existing.checked = false;
        if (quantity) existing.quantity = quantity;
        if (item.note) existing.details = item.note;
        await existing.save();
      } else {
        await list.addItem(
          client.createItem({ name: item.name, quantity, details: item.note })
        );
      }
      pushed++;
    }
    return { ok: true, listName: ANYLIST_LIST_NAME, pushed };
  } catch (err) {
    return {
      ok: false,
      listName: ANYLIST_LIST_NAME,
      pushed: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    try {
      client.teardown();
    } catch {
      // teardown failures are irrelevant once the push outcome is known
    }
  }
}
