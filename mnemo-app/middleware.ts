import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // For now, all routes are public. Auth is optional.
  // When user is signed in, their data persists to Supabase.
  // When not signed in, data lives in browser memory only.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
