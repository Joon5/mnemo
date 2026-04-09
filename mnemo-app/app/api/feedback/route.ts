import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
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
  // Rate limiting: 5 requests per minute per IP
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const rateLimitResult = rateLimit(ip, 5, 60000);

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

  try {
    const body = await req.json();

    // Validate request
    if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
      return NextResponse.json(
        {
          error: 'Invalid request: message is required',
          code: 'INVALID_REQUEST',
        },
        {
          status: 400,
          headers: CORS_HEADERS,
        }
      );
    }

    const feedbackType = body.feedback_type || 'general';
    if (!['bug', 'feature', 'general'].includes(feedbackType)) {
      return NextResponse.json(
        {
          error: 'Invalid feedback type',
          code: 'INVALID_REQUEST',
        },
        {
          status: 400,
          headers: CORS_HEADERS,
        }
      );
    }

    // Create Supabase client with service role key for anonymous submissions
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRole) {
      console.error('Supabase configuration missing');
      return NextResponse.json(
        {
          error: 'Server configuration error',
          code: 'CONFIG_ERROR',
        },
        {
          status: 503,
          headers: CORS_HEADERS,
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRole);

    // Get page URL from request body
    const page = body.page || 'unknown';

    // Insert feedback
    const { error: insertError, data } = await supabase.from('feedback').insert({
      feedback_type: feedbackType,
      message: body.message.trim(),
      email: body.email || null,
      user_id: body.user_id || null,
      page,
      created_at: new Date().toISOString(),
    });

    if (insertError) {
      console.error('Feedback insertion error:', insertError);
      return NextResponse.json(
        {
          error: 'Failed to save feedback',
          code: 'INSERT_ERROR',
        },
        {
          status: 500,
          headers: CORS_HEADERS,
        }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Feedback received',
      },
      {
        status: 201,
        headers: CORS_HEADERS,
      }
    );
  } catch (err) {
    console.error('Feedback API error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      {
        error: 'Server error',
        code: 'SERVER_ERROR',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      },
      {
        status: 500,
        headers: CORS_HEADERS,
      }
    );
  }
}
