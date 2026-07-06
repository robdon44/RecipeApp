import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Reports which env vars the running deployment can see — presence and
 * length only, never values. For diagnosing Vercel env configuration.
 */
export async function GET() {
  const present = (v: string | undefined) =>
    v && v.trim() ? { set: true, length: v.length } : { set: false };

  return NextResponse.json({
    NEXT_PUBLIC_SUPABASE_URL: present(process.env.NEXT_PUBLIC_SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: present(process.env.SUPABASE_SERVICE_ROLE_KEY),
    SUPABASE_ANON_KEY: present(process.env.SUPABASE_ANON_KEY),
    SPOONACULAR_API_KEY: present(process.env.SPOONACULAR_API_KEY),
    ANTHROPIC_API_KEY: present(process.env.ANTHROPIC_API_KEY),
    TAVILY_API_KEY: present(process.env.TAVILY_API_KEY),
    ANYLIST_EMAIL: present(process.env.ANYLIST_EMAIL),
    ANYLIST_PASSWORD: present(process.env.ANYLIST_PASSWORD),
    ANYLIST_LIST_NAME: present(process.env.ANYLIST_LIST_NAME),
  });
}
