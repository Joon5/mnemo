"use client";
import dynamic from "next/dynamic";
import { Suspense } from "react";

const MnemoApp = dynamic(() => import("@/components/MnemoApp"), { ssr: false });

function LoadingSpinner() {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      background: "var(--bg)",
      fontFamily: "inherit",
    }}>
      <div style={{
        width: 48,
        height: 48,
        border: "3px solid var(--border)",
        borderTopColor: "var(--teal)",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }} />
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <MnemoApp />
    </Suspense>
  );
}
