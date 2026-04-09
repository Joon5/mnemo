import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'mnemo - Read Faster. Retain More.',
  description: 'The beta platform for speed reading with AI-powered comprehension and spaced retrieval learning.',
};

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
