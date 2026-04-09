import { NextResponse } from 'next/server';

export async function GET() {
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'YOUR_ANTHROPIC_API_KEY_HERE';
  const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      anthropic: hasApiKey ? 'configured' : 'missing',
      supabase: hasSupabase ? 'configured' : 'missing',
    }
  });
}
