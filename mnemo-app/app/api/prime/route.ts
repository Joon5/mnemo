import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.NODE_ENV === 'production' ? process.env.NEXT_PUBLIC_APP_URL || '*' : '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS(req: NextRequest) {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  // Rate limiting: 10 requests per minute per IP
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const rateLimitResult = rateLimit(ip, 20, 60000);

  if (!rateLimitResult.success) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: 60,
      },
      {
        status: 429,
        headers: {
          'Retry-After': '60',
          ...CORS_HEADERS,
        },
      }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey || apiKey === 'YOUR_ANTHROPIC_API_KEY_HERE') {
    return NextResponse.json(
      {
        error: 'ANTHROPIC_API_KEY not configured. Add it to .env.local',
        code: 'API_KEY_MISSING',
      },
      {
        status: 503,
        headers: CORS_HEADERS,
      }
    );
  }

  try {
    const body = await req.json();

    // Request validation
    if (!body.messages || !Array.isArray(body.messages)) {
      return NextResponse.json(
        {
          error: 'Invalid request: messages array is required',
          code: 'INVALID_REQUEST',
        },
        {
          status: 400,
          headers: CORS_HEADERS,
        }
      );
    }

    if (!body.max_tokens || typeof body.max_tokens !== 'number') {
      return NextResponse.json(
        {
          error: 'Invalid request: max_tokens is required and must be a number',
          code: 'INVALID_REQUEST',
        },
        {
          status: 400,
          headers: CORS_HEADERS,
        }
      );
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          ...data,
          code: data.error?.type || 'API_ERROR',
        },
        {
          status: response.status,
          headers: CORS_HEADERS,
        }
      );
    }

    return NextResponse.json(data, { headers: CORS_HEADERS });
  } catch (err) {
    console.error('API proxy error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      {
        error: 'Proxy error',
        code: 'PROXY_ERROR',
        details: errorMessage,
      },
      {
        status: 500,
        headers: CORS_HEADERS,
      }
    );
  }
}
