import { NextResponse } from 'next/server';
import { pushToAnyList } from '@/lib/anylist';
import { listToPlainText } from '@/lib/merge';
import type { ShoppingListItem } from '@/lib/types';

export const maxDuration = 60;

/**
 * POST { items: ShoppingListItem[] } → push to AnyList (§11).
 * On any AnyList failure, responds 200 with pushed=false and the plain-text
 * list so the user is never blocked by the unofficial lib breaking.
 */
export async function POST(request: Request) {
  let items: ShoppingListItem[];
  try {
    const body = await request.json();
    items = body?.items;
    if (!Array.isArray(items) || items.length === 0 || items.some((i) => !i.name)) {
      throw new Error();
    }
  } catch {
    return NextResponse.json(
      { error: 'Provide { items: [{ name, amount?, unit?, note? }] }' },
      { status: 400 }
    );
  }

  const result = await pushToAnyList(items);
  if (result.ok) {
    return NextResponse.json({ pushed: true, listName: result.listName, count: result.pushed });
  }
  return NextResponse.json({
    pushed: false,
    error: result.error,
    plainText: listToPlainText(items),
  });
}
