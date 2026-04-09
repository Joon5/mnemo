'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function LandingPage() {
  const [email, setEmail] = useState('');
  const [emailStatus, setEmailStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [emailMessage, setEmailMessage] = useState('');

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setEmailStatus('loading');
    try {
      const response = await fetch('/api/beta-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (response.ok) {
        setEmailStatus('success');
        setEmailMessage('Thanks! We\'ll be in touch soon.');
        setEmail('');
        setTimeout(() => setEmailStatus('idle'), 4000);
      } else {
        const data = await response.json();
        setEmailStatus('error');
        setEmailMessage(data.message || 'Something went wrong. Please try again.');
      }
    } catch {
      setEmailStatus('error');
      setEmailMessage('Network error. Please try again.');
    }
  };

  return (
    <div style={styles.container}>
      <style>{`
        :root {
          --bg: #0b1623;
          --card: #111f2e;
          --card2: #0d1e2e;
          --border: #1e3347;
          --border2: #1e2f42;
          --teal: #00c896;
          --teal2: #00a87a;
          --teal-dim: rgba(0, 200, 150, 0.15);
          --orange: #f5a623;
          --orange-dim: rgba(245, 166, 35, 0.18);
          --red: #e05555;
          --white: #fff;
          --gray1: #e8edf2;
          --gray2: #a8b5c2;
          --gray3: #3a5068;
          --gray4: #1e3347;
          --mono: 'Courier New', monospace;
          --ui: 'DM Sans', Calibri, sans-serif;
          --display: 'Space Mono', monospace;
        }
      `}</style>

      {/* Hero Section */}
      <section style={styles.hero}>
        <div style={styles.heroContent}>
          <h1 style={styles.heroTitle}>
            <span style={{ color: 'var(--teal)' }}>mnemo</span>
          </h1>
          <p style={styles.tagline}>read faster. retain more. forget nothing.</p>
          <Link href="/" style={styles.ctaButton}>
            Try the Beta →
          </Link>
        </div>
      </section>

      {/* How It Works Section */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>How It Works</h2>
        <div style={styles.stepsContainer}>
          <div style={styles.step}>
            <div style={styles.stepNumber}>1</div>
            <h3 style={styles.stepTitle}>Paste Text</h3>
            <p style={styles.stepDescription}>Drop in any article, document, or passage</p>
          </div>
          <div style={styles.stepArrow}>→</div>
          <div style={styles.step}>
            <div style={styles.stepNumber}>2</div>
            <h3 style={styles.stepTitle}>AI Primes Your Brain</h3>
            <p style={styles.stepDescription}>Get a knowledge snapshot before reading</p>
          </div>
          <div style={styles.stepArrow}>→</div>
          <div style={styles.step}>
            <div style={styles.stepNumber}>3</div>
            <h3 style={styles.stepTitle}>Speed Read with Comprehension</h3>
            <p style={styles.stepDescription}>RSVP reader with real-time checkpoints</p>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Features</h2>
        <div style={styles.featuresGrid}>
          <div style={styles.featureCard}>
            <h3 style={styles.featureTitle}>RSVP Reader</h3>
            <p style={styles.featureDescription}>
              Rapid Serial Visual Presentation for distraction-free reading. Control your pace with custom WPM settings.
            </p>
          </div>
          <div style={styles.featureCard}>
            <h3 style={styles.featureTitle}>AI Priming</h3>
            <p style={styles.featureDescription}>
              Get contextual knowledge before diving in. Our AI extracts key concepts to prepare your mind.
            </p>
          </div>
          <div style={styles.featureCard}>
            <h3 style={styles.featureTitle}>Comprehension Checkpoints</h3>
            <p style={styles.featureDescription}>
              Real-time quiz questions ensure you're retaining what matters. Immediate feedback and explanations.
            </p>
          </div>
          <div style={styles.featureCard}>
            <h3 style={styles.featureTitle}>Spaced Retrieval Flashcards</h3>
            <p style={styles.featureDescription}>
              Optimize long-term memory with scientifically-backed spaced repetition learning intervals.
            </p>
          </div>
        </div>
      </section>

      {/* Social Proof / Stats Section */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Built on Cognitive Science</h2>
        <div style={styles.statsGrid}>
          <div style={styles.statCard}>
            <div style={styles.statNumber}>350+</div>
            <div style={styles.statLabel}>WPM Average</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statNumber}>87%</div>
            <div style={styles.statLabel}>Retention Rate</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statNumber}>3x</div>
            <div style={styles.statLabel}>Faster Learning</div>
          </div>
        </div>
        <p style={styles.scienceNote}>
          Backed by research in spaced repetition, semantic priming, and optimal reading psychology.
        </p>
      </section>

      {/* CTA / Beta Signup Section */}
      <section style={styles.ctaSection}>
        <h2 style={styles.sectionTitle}>Join the Beta</h2>
        <p style={styles.ctaDescription}>
          Be among the first to experience the future of speed reading. Limited beta spots available.
        </p>
        <form onSubmit={handleEmailSubmit} style={styles.emailForm}>
          <input
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.emailInput}
            required
          />
          <button
            type="submit"
            disabled={emailStatus === 'loading'}
            style={styles.submitButton}
          >
            {emailStatus === 'loading' ? 'Joining...' : 'Join the Beta'}
          </button>
        </form>
        {emailStatus === 'success' && (
          <p style={{ ...styles.statusMessage, color: 'var(--teal)' }}>{emailMessage}</p>
        )}
        {emailStatus === 'error' && (
          <p style={{ ...styles.statusMessage, color: 'var(--red)' }}>{emailMessage}</p>
        )}
      </section>

      {/* Footer */}
      <footer style={styles.footer}>
        <p>Built by Joon · mnemo © 2026</p>
      </footer>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    minHeight: '100vh',
    background: 'var(--bg)',
    color: 'var(--white)',
    fontFamily: 'var(--ui)',
    scrollBehavior: 'smooth',
    overflow: 'hidden auto',
  },

  // Hero Section
  hero: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 20px',
    background: `linear-gradient(135deg, var(--bg) 0%, rgba(0, 200, 150, 0.05) 100%)`,
  },
  heroContent: {
    textAlign: 'center',
    maxWidth: '600px',
  },
  heroTitle: {
    fontFamily: 'var(--display)',
    fontSize: 'clamp(48px, 10vw, 96px)',
    fontWeight: 700,
    letterSpacing: '-0.04em',
    marginBottom: '12px',
    lineHeight: 1,
  },
  tagline: {
    fontFamily: 'var(--display)',
    fontSize: 'clamp(16px, 4vw, 24px)',
    color: 'var(--gray2)',
    marginBottom: '40px',
    letterSpacing: '0.02em',
  },
  ctaButton: {
    display: 'inline-block',
    fontFamily: 'var(--display)',
    fontSize: '14px',
    fontWeight: 700,
    letterSpacing: '0.06em',
    padding: '16px 40px',
    background: 'var(--teal)',
    color: 'var(--bg)',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
    textDecoration: 'none',
    transition: 'opacity 0.2s, transform 0.15s',
  },

  // Section Styles
  section: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '80px 20px',
    borderTop: '1px solid var(--border)',
  },
  sectionTitle: {
    fontFamily: 'var(--display)',
    fontSize: 'clamp(28px, 6vw, 48px)',
    fontWeight: 700,
    letterSpacing: '-0.03em',
    marginBottom: '60px',
    textAlign: 'center',
  },

  // How It Works Section
  stepsContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '20px',
    flexWrap: 'wrap',
    marginBottom: '40px',
  },
  step: {
    flex: '1 1 200px',
    minWidth: '180px',
    textAlign: 'center',
    padding: '20px',
  },
  stepNumber: {
    fontFamily: 'var(--display)',
    fontSize: '32px',
    fontWeight: 700,
    color: 'var(--teal)',
    marginBottom: '12px',
  },
  stepTitle: {
    fontFamily: 'var(--display)',
    fontSize: '16px',
    fontWeight: 700,
    marginBottom: '8px',
  },
  stepDescription: {
    fontSize: '13px',
    color: 'var(--gray2)',
    lineHeight: 1.6,
  },
  stepArrow: {
    fontFamily: 'var(--display)',
    fontSize: '24px',
    color: 'var(--gray3)',
    display: 'none',
  },

  // Features Section
  featuresGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '24px',
  },
  featureCard: {
    background: 'var(--card)',
    border: '1.5px solid var(--border)',
    borderRadius: '12px',
    padding: '28px 24px',
    transition: 'border-color 0.2s, background 0.2s',
  },
  featureTitle: {
    fontFamily: 'var(--display)',
    fontSize: '15px',
    fontWeight: 700,
    letterSpacing: '0.05em',
    marginBottom: '12px',
    color: 'var(--teal)',
  },
  featureDescription: {
    fontSize: '13px',
    color: 'var(--gray2)',
    lineHeight: 1.7,
  },

  // Stats Section
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '20px',
    marginBottom: '40px',
  },
  statCard: {
    background: 'var(--card)',
    border: '1.5px solid var(--border)',
    borderRadius: '12px',
    padding: '32px 20px',
    textAlign: 'center',
  },
  statNumber: {
    fontFamily: 'var(--display)',
    fontSize: 'clamp(28px, 6vw, 40px)',
    fontWeight: 700,
    color: 'var(--teal)',
    marginBottom: '8px',
  },
  statLabel: {
    fontFamily: 'var(--display)',
    fontSize: '11px',
    color: 'var(--gray2)',
    letterSpacing: '0.08em',
  },
  scienceNote: {
    textAlign: 'center',
    fontSize: '13px',
    color: 'var(--gray2)',
    maxWidth: '600px',
    margin: '0 auto',
    lineHeight: 1.7,
  },

  // CTA Section
  ctaSection: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '80px 20px',
    borderTop: '1px solid var(--border)',
    textAlign: 'center',
  },
  ctaDescription: {
    fontSize: '15px',
    color: 'var(--gray2)',
    marginBottom: '32px',
    maxWidth: '500px',
    margin: '0 auto 32px',
    lineHeight: 1.7,
  },
  emailForm: {
    display: 'flex',
    gap: '12px',
    maxWidth: '480px',
    margin: '0 auto 24px',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  emailInput: {
    flex: '1 1 200px',
    minWidth: '200px',
    background: 'var(--card)',
    border: '1.5px solid var(--border)',
    borderRadius: '10px',
    color: 'var(--white)',
    fontFamily: 'var(--ui)',
    fontSize: '14px',
    padding: '14px 18px',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  submitButton: {
    flex: '0 1 auto',
    fontFamily: 'var(--display)',
    fontSize: '13px',
    fontWeight: 700,
    letterSpacing: '0.06em',
    padding: '14px 32px',
    background: 'var(--teal)',
    color: 'var(--bg)',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'opacity 0.2s, transform 0.1s',
    whiteSpace: 'nowrap',
  },
  statusMessage: {
    fontFamily: 'var(--display)',
    fontSize: '12px',
    letterSpacing: '0.05em',
    marginTop: '12px',
  },

  // Footer
  footer: {
    borderTop: '1px solid var(--border)',
    padding: '40px 20px',
    textAlign: 'center',
    fontSize: '12px',
    color: 'var(--gray3)',
    fontFamily: 'var(--display)',
    letterSpacing: '0.05em',
  },
};
