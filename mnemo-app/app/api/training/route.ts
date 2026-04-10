import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// This endpoint is called fire-and-forget from the client after each chunk is weighted.
// It silently saves the passage + model output to training_passages for future fine-tuning.
// Failures are swallowed — this must never affect the reading experience.

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
  const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRole) {
    // Config missing — fail silently, never surface to user
    return NextResponse.json({ ok: false }, { status: 503, headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { passage_text, word_count, doc_context, model_output, green_words } = body;

    // Basic validation
    if (!passage_text || typeof passage_text !== 'string' || word_count < 20) {
      return NextResponse.json({ ok: false, reason: 'too_short' }, { status: 400, headers: CORS_HEADERS });
    }

    // Only save if the model actually returned green indices — empty outputs have no training signal
    const greenCount = Array.isArray(model_output?.green) ? model_output.green.length : 0;
    if (greenCount === 0) {
      return NextResponse.json({ ok: true, skipped: true }, { headers: CORS_HEADERS });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRole);

    const { error } = await supabase.from('training_passages').insert({
      passage_text: String(passage_text).slice(0, 3000),
      word_count: Number(word_count),
      doc_context: doc_context ? String(doc_context).slice(0, 500) : null,
      model_output: model_output ?? null,
      green_words: Array.isArray(green_words) ? green_words : [],
    });

    if (error) {
      console.error('[training] Supabase insert error:', error.message);
      return NextResponse.json({ ok: false }, { status: 500, headers: CORS_HEADERS });
    }

    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
  } catch (err) {
    // Silent fail — this is a background collection endpoint
    console.error('[training] Error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false }, { status: 500, headers: CORS_HEADERS });
  }
}
