export default function PrivacyPage() {
  return (
    <div style={{
      maxWidth: 720,
      margin: "0 auto",
      padding: "60px 24px",
      color: "var(--gray1)",
      fontFamily: "var(--ui)",
      lineHeight: 1.8,
      fontSize: 15,
    }}>
      <div style={{ marginBottom: 40 }}>
        <a href="/" style={{ color: "var(--teal)", fontSize: 13, textDecoration: "none", fontFamily: "var(--display)" }}>
          ← back to mnemo
        </a>
      </div>
      <h1 style={{ fontFamily: "var(--display)", fontSize: 32, fontWeight: 800, color: "var(--white)", marginBottom: 8 }}>
        Privacy Policy
      </h1>
      <p style={{ color: "var(--gray3)", fontSize: 13, marginBottom: 40 }}>
        Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontFamily: "var(--display)", fontSize: 18, fontWeight: 700, color: "var(--white)", marginBottom: 12 }}>
          What we collect
        </h2>
        <p>
          mnemo collects only what is necessary to provide the service:
        </p>
        <ul style={{ paddingLeft: 20, marginTop: 8, color: "var(--gray2)" }}>
          <li style={{ marginBottom: 6 }}>Email address (if you create an account)</li>
          <li style={{ marginBottom: 6 }}>Reading session statistics: word count, WPM, time, and comprehension scores</li>
          <li style={{ marginBottom: 6 }}>Bookmarks you save (stored securely in Supabase)</li>
          <li style={{ marginBottom: 6 }}>Feedback you submit voluntarily</li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontFamily: "var(--display)", fontSize: 18, fontWeight: 700, color: "var(--white)", marginBottom: 12 }}>
          What we do NOT collect
        </h2>
        <ul style={{ paddingLeft: 20, color: "var(--gray2)" }}>
          <li style={{ marginBottom: 6 }}>The content of texts you read — your reading material is never stored on our servers</li>
          <li style={{ marginBottom: 6 }}>Device identifiers or advertising IDs</li>
          <li style={{ marginBottom: 6 }}>Location data</li>
          <li style={{ marginBottom: 6 }}>Any data sold to third parties</li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontFamily: "var(--display)", fontSize: 18, fontWeight: 700, color: "var(--white)", marginBottom: 12 }}>
          AI processing
        </h2>
        <p style={{ color: "var(--gray2)" }}>
          When you prime a text, excerpts are sent to Anthropic&apos;s Claude API to generate semantic weights,
          comprehension checkpoints, and summaries. This processing is governed by{" "}
          <a href="https://www.anthropic.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal)" }}>
            Anthropic&apos;s Privacy Policy
          </a>
          . We do not retain your text on our servers.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontFamily: "var(--display)", fontSize: 18, fontWeight: 700, color: "var(--white)", marginBottom: 12 }}>
          Data storage
        </h2>
        <p style={{ color: "var(--gray2)" }}>
          Account data is stored in Supabase with row-level security — only you can access your data.
          All data in transit is encrypted via TLS. You may delete your account and all associated data at any time
          by contacting us.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontFamily: "var(--display)", fontSize: 18, fontWeight: 700, color: "var(--white)", marginBottom: 12 }}>
          Beta program
        </h2>
        <p style={{ color: "var(--gray2)" }}>
          mnemo is currently in beta. By using the app you agree that the service may change, and that you
          may receive occasional emails about product updates. You can unsubscribe at any time.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontFamily: "var(--display)", fontSize: 18, fontWeight: 700, color: "var(--white)", marginBottom: 12 }}>
          Contact
        </h2>
        <p style={{ color: "var(--gray2)" }}>
          Questions? Email us at{" "}
          <a href="mailto:privacy@mnemo.app" style={{ color: "var(--teal)" }}>privacy@mnemo.app</a>
        </p>
      </section>
    </div>
  );
}
