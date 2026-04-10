import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.NODE_ENV === 'production' ? process.env.NEXT_PUBLIC_APP_URL || '*' : '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// System prompt injected server-side for every request.
// Ensures Llama 3.1 stays in strict JSON mode regardless of user input.
const SYSTEM_PROMPT =
  'You are a precision text annotation engine built into a speed-reading application. ' +
  'You output ONLY valid JSON. No markdown fences, no explanation, no commentary, no apology. ' +
  'Raw JSON only. Every response must be parseable by JSON.parse() with no preprocessing.';

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  // Rate limiting: 20 requests per minute per IP
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const rateLimitResult = rateLimit(ip, 20, 60000);

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED', retryAfter: 60 },
      { status: 429, headers: { 'Retry-After': '60', ...CORS_HEADERS } }
    );
  }

  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: 'GROQ_API_KEY not configured. Add it to .env.local and Vercel env vars.', code: 'API_KEY_MISSING' },
      { status: 503, headers: CORS_HEADERS }
    );
  }

  try {
    const body = await req.json();

    if (!body.messages || !Array.isArray(body.messages)) {
      return NextResponse.json(
        { error: 'Invalid request: messages array is required', code: 'INVALID_REQUEST' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Prepend system message — Llama 3.1 uses this to stay in strict JSON mode
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...body.messages,
    ];

    const groqBody: Record<string, unknown> = {
      model: body.model || 'llama-3.1-8b-instant', // respect caller's model choice (e.g. 70B for weighting)
      messages,
      max_tokens: body.max_tokens || 1000,
      temperature: 0.1,   // Low = consistent, predictable JSON structure
      response_format: { type: 'json_object' }, // Groq enforces valid JSON at the token level
    };

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(groqBody),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Groq API error:', data);
      return NextResponse.json(
        { error: data.error?.message || 'Groq API error', code: data.error?.type || 'API_ERROR' },
        { status: response.status, headers: CORS_HEADERS }
      );
    }

    // Return Groq's OpenAI-format response directly
    return NextResponse.json(data, { headers: CORS_HEADERS });
  } catch (err) {
    console.error('API proxy error:', err);
    return NextResponse.json(
      { error: 'Proxy error', code: 'PROXY_ERROR', details: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
