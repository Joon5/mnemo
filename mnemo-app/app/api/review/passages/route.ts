import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    return NextResponse.json({ error: 'Server config missing' }, { status: 503, headers: CORS_HEADERS });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get('limit') || 10), 50);
  const offset = Number(searchParams.get('offset') || 0);

  const supabase = createClient(supabaseUrl, serviceRole);

  // Fetch next batch of unreviewed passages that have Sonnet output
  const { data: passages, error } = await supabase
    .from('training_passages')
    .select('id, passage_text, word_count, doc_context, model_output, sonnet_output, sonnet_green_words')
    .not('sonnet_output', 'is', null)
    .eq('human_reviewed', false)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });
  }

  // Count remaining unreviewed
  const { count: remaining } = await supabase
    .from('training_passages')
    .select('id', { count: 'exact', head: true })
    .not('sonnet_output', 'is', null)
    .eq('human_reviewed', false);

  // Count total reviewed
  const { count: reviewed } = await supabase
    .from('training_passages')
    .select('id', { count: 'exact', head: true })
    .eq('human_reviewed', true);

  return NextResponse.json(
    { passages: passages || [], remaining: remaining || 0, reviewed: reviewed || 0 },
    { headers: CORS_HEADERS }
  );
}
