import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    return NextResponse.json({ error: 'Server config missing' }, { status: 503, headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { id, green, was_corrected, notes } = body;

    if (!id || !Array.isArray(green)) {
      return NextResponse.json({ error: 'id and green[] required' }, { status: 400, headers: CORS_HEADERS });
    }

    const supabase = createClient(supabaseUrl, serviceRole);

    const { error } = await supabase
      .from('training_passages')
      .update({
        human_reviewed: true,
        approved: true,
        human_corrections: {
          green,
          was_corrected: Boolean(was_corrected),
          notes: notes || '',
        },
      })
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });
    }

    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
