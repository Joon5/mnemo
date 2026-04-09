import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "mnemo — read it. keep it.",
  description: "AI-powered speed reading that makes you actually retain what you read. Read faster, comprehend deeper, forget nothing.",
  keywords: ["speed reading", "AI reading", "comprehension", "learning", "study"],
  authors: [{ name: "mnemo" }],
  openGraph: {
    title: "mnemo — read it. keep it.",
    description: "AI-powered speed reading that makes you actually retain what you read.",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "mnemo — read it. keep it.",
    description: "AI-powered speed reading that makes you actually retain what you read.",
  },
  appleWebApp: {
    capable: true,
    title: "mnemo",
    statusBarStyle: "black-translucent",
  },
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b1623",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
