import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { pressEntry, type Standing } from '@/lib/brain/press';

// The press's door. Staff only, one entry per call, the logic in the module
// so tests walk the same ladder the button does.
export const dynamic = 'force-dynamic';

async function staffOnly() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.app_metadata?.role === 'admin' ? user : null;
}

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST(request: Request) {
  if (!(await staffOnly()))
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const id = String(body?.id ?? '');
  const to = String(body?.to ?? '') as Standing;
  if (!id || !to)
    return NextResponse.json({ error: 'id and to required' }, { status: 400 });

  try {
    const result = await pressEntry(admin(), id, to);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'press failed' }, { status: 400 });
  }
}
