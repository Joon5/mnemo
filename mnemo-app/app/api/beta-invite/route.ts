import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const rl = rateLimit(ip, 5, 60000);
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const { email } = await req.json();

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }

    const code = 'MNEMO-' + Math.random().toString(36).slice(2, 8).toUpperCase();

    const { error } = await supabaseAdmin.from('beta_invites').upsert(
      { email: email.toLowerCase().trim(), invite_code: code },
      { onConflict: 'email' }
    );

    if (error) {
      // If it's a duplicate, that's fine — they're already signed up
      if (error.code === '23505') {
        return NextResponse.json({ success: true, message: 'Already on the list!' });
      }
      console.error('Beta invite error:', error);
      return NextResponse.json({ error: 'Could not save' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'You\'re on the list!' });
  } catch (err) {
    console.error('Beta invite error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
