'use client';

import { useEffect, useState, useCallback } from 'react';

type Passage = {
  id: string;
  passage_text: string;
  word_count: number;
  doc_context: string | null;
  sonnet_output: {
    thesis: string;
    load_bearing: string[];
    green: number[];
  } | null;
};

type Stats = { remaining: number; reviewed: number };

// Infer subject + length tier from doc_context or word count
function inferTier(wc: number): string {
  if (wc < 150)   return 'PARAGRAPH';
  if (wc < 500)   return 'ARTICLE SECTION';
  if (wc < 2000)  return 'SHORT ARTICLE';
  if (wc < 10000) return 'LONG ARTICLE';
  return 'BOOK';
}

function greenPct(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

export default function ReviewClient() {
  const [passages, setPassages] = useState<Passage[]>([]);
  const [offset, setOffset] = useState(0);
  const [idx, setIdx] = useState(0);
  const [greenSet, setGreenSet] = useState<Set<number>>(new Set());
  const [initialGreen, setInitialGreen] = useState<Set<number>>(new Set());
  const [stats, setStats] = useState<Stats>({ remaining: 0, reviewed: 0 });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const passage = passages[idx] ?? null;
  const words = passage ? passage.passage_text.split(/\s+/).filter(Boolean) : [];

  // Load a batch of passages
  const loadBatch = useCallback(async (off: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/review/passages?limit=10&offset=${off}`);
      const data = await res.json();
      if (!data.passages?.length) {
        setDone(true);
      } else {
        setPassages(data.passages);
        setStats({ remaining: data.remaining, reviewed: data.reviewed });
        setIdx(0);
      }
    } catch {
      // silently fail — user can retry
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => { loadBatch(0); }, [loadBatch]);

  // Initialize green set from Sonnet's output whenever passage changes
  useEffect(() => {
    if (!passage) return;
    const sg = new Set<number>(passage.sonnet_output?.green ?? []);
    setGreenSet(new Set(sg));
    setInitialGreen(new Set(sg));
  }, [passage?.id]);

  function toggleWord(i: number) {
    setGreenSet(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  async function save(skipSave = false) {
    if (!passage || saving) return;
    if (skipSave) {
      advance();
      return;
    }

    setSaving(true);
    const green = Array.from(greenSet).sort((a, b) => a - b);
    const wasCorrected =
      green.length !== initialGreen.size ||
      green.some(i => !initialGreen.has(i));

    try {
      await fetch('/api/review/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: passage.id, green, was_corrected: wasCorrected }),
      });
      setStats(s => ({ remaining: Math.max(0, s.remaining - 1), reviewed: s.reviewed + 1 }));
    } catch { /* silently continue */ }

    setSaving(false);
    advance();
  }

  function advance() {
    if (idx < passages.length - 1) {
      setIdx(i => i + 1);
    } else {
      // Load next batch
      const newOffset = offset + passages.length;
      setOffset(newOffset);
      loadBatch(newOffset);
    }
  }

  // ── Render states ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={styles.center}>
        <div style={styles.loadingDot} />
        <span style={{ color: 'var(--gray3)', fontSize: 13, fontFamily: 'var(--display)' }}>
          Loading passages…
        </span>
      </div>
    );
  }

  if (done || !passage) {
    return (
      <div style={styles.center}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
        <div style={{ color: 'var(--teal)', fontFamily: 'var(--display)', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
          All caught up
        </div>
        <div style={{ color: 'var(--gray2)', fontSize: 13 }}>
          {stats.reviewed} passages reviewed. Run <code style={styles.code}>npm run relabel</code> to process new ones.
        </div>
      </div>
    );
  }

  const tier = inferTier(passage.word_count);
  const greenCount = greenSet.size;
  const pct = greenPct(greenCount, words.length);
  const modified = greenCount !== initialGreen.size || Array.from(greenSet).some(i => !initialGreen.has(i));

  return (
    <div style={styles.page}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={styles.header}>
        <div style={styles.logo}>
          <span style={{ color: 'var(--teal)' }}>mnemo</span>
          <span style={{ color: 'var(--gray3)', fontWeight: 400, fontSize: 14, marginLeft: 10 }}>
            / training review
          </span>
        </div>
        <div style={styles.statsPill}>
          <span style={{ color: 'var(--teal)', fontWeight: 700 }}>{stats.reviewed}</span>
          <span style={{ color: 'var(--gray3)' }}> reviewed</span>
          <span style={{ color: 'var(--border)', margin: '0 8px' }}>|</span>
          <span style={{ color: 'var(--white)', fontWeight: 700 }}>{stats.remaining}</span>
          <span style={{ color: 'var(--gray3)' }}> remaining</span>
        </div>
      </div>

      {/* ── Passage meta ──────────────────────────────────────────────────── */}
      <div style={styles.meta}>
        <span style={styles.tierBadge}>{tier}</span>
        <span style={styles.wcBadge}>{passage.word_count} words</span>
        {modified && <span style={styles.modifiedBadge}>MODIFIED</span>}
      </div>

      {/* ── Sonnet context panel ──────────────────────────────────────────── */}
      {passage.sonnet_output && (
        <div style={styles.contextPanel}>
          <div style={styles.contextLabel}>SONNET&apos;S READING</div>
          <div style={styles.thesis}>{passage.sonnet_output.thesis}</div>
          {passage.sonnet_output.load_bearing?.length > 0 && (
            <div style={styles.loadBearing}>
              {passage.sonnet_output.load_bearing.map((claim, i) => (
                <div key={i} style={styles.claim}>
                  <span style={{ color: 'var(--teal)', marginRight: 6 }}>→</span>
                  {claim}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Instruction strip ─────────────────────────────────────────────── */}
      <div style={styles.instruction}>
        Click words to toggle green. Teal = load-bearing. Click again to remove.
      </div>

      {/* ── Word canvas ───────────────────────────────────────────────────── */}
      <div style={styles.wordCanvas}>
        {words.map((word, i) => {
          const isGreen = greenSet.has(i);
          const wasInitial = initialGreen.has(i);
          // Added by user (not Sonnet) = brighter teal outline
          const isAdded = isGreen && !wasInitial;
          // Removed by user (was Sonnet, now not) = subtle strikethrough hint
          const isRemoved = !isGreen && wasInitial;

          return (
            <span
              key={i}
              onClick={() => toggleWord(i)}
              style={{
                display: 'inline',
                cursor: 'pointer',
                padding: '1px 3px',
                marginRight: '4px',
                borderRadius: '3px',
                lineHeight: 2,
                fontSize: 16,
                color: isGreen
                  ? 'var(--teal)'
                  : isRemoved
                  ? 'var(--gray3)'
                  : 'var(--white)',
                background: isGreen
                  ? 'var(--teal-dim)'
                  : 'transparent',
                outline: isAdded ? '1px solid var(--teal2)' : 'none',
                textDecoration: isRemoved ? 'line-through' : 'none',
                transition: 'color 0.1s, background 0.1s',
                userSelect: 'none',
              }}
            >
              {word}
            </span>
          );
        })}
      </div>

      {/* ── Action bar ────────────────────────────────────────────────────── */}
      <div style={styles.actionBar}>
        <div style={styles.greenCount}>
          <span style={{ color: 'var(--teal)', fontWeight: 700 }}>{greenCount}</span>
          <span style={{ color: 'var(--gray3)' }}> / {words.length} words green </span>
          <span style={{ color: 'var(--gray4)' }}>({pct}%)</span>
        </div>

        <div style={styles.buttons}>
          <button onClick={() => save(true)} style={styles.btnSkip} disabled={saving}>
            Skip →
          </button>
          <button
            onClick={() => save(false)}
            style={modified ? styles.btnSubmit : styles.btnApprove}
            disabled={saving}
          >
            {saving ? 'Saving…' : modified ? 'Submit corrections' : 'Approve as-is'}
          </button>
        </div>
      </div>

    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
    maxWidth: 860,
    margin: '0 auto',
    padding: '0 24px 120px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 0',
    borderBottom: '1px solid var(--border)',
    marginBottom: 24,
  },
  logo: {
    fontFamily: 'var(--display)',
    fontSize: 20,
    fontWeight: 800,
    letterSpacing: '-0.04em',
  },
  statsPill: {
    fontFamily: 'var(--display)',
    fontSize: 12,
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 20,
    padding: '5px 14px',
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  tierBadge: {
    fontFamily: 'var(--display)',
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.1em',
    color: 'var(--teal)',
    border: '1.5px solid var(--teal)',
    borderRadius: 3,
    padding: '2px 7px',
  },
  wcBadge: {
    fontFamily: 'var(--display)',
    fontSize: 9,
    letterSpacing: '0.08em',
    color: 'var(--gray3)',
    border: '1px solid var(--border)',
    borderRadius: 3,
    padding: '2px 7px',
  },
  modifiedBadge: {
    fontFamily: 'var(--display)',
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.1em',
    color: 'var(--orange)',
    border: '1.5px solid var(--orange)',
    borderRadius: 3,
    padding: '2px 7px',
  },
  contextPanel: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '14px 18px',
    marginBottom: 16,
  },
  contextLabel: {
    fontFamily: 'var(--display)',
    fontSize: 9,
    letterSpacing: '0.12em',
    color: 'var(--gray3)',
    marginBottom: 8,
  },
  thesis: {
    fontSize: 14,
    color: 'var(--gray1)',
    lineHeight: 1.6,
    marginBottom: 10,
    fontStyle: 'italic',
  },
  loadBearing: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  claim: {
    fontSize: 12,
    color: 'var(--gray2)',
    lineHeight: 1.5,
  },
  instruction: {
    fontFamily: 'var(--display)',
    fontSize: 10,
    color: 'var(--gray3)',
    letterSpacing: '0.06em',
    marginBottom: 20,
  },
  wordCanvas: {
    lineHeight: 2,
    flex: 1,
    fontSize: 16,
    color: 'var(--white)',
    marginBottom: 100,
  },
  actionBar: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: 'var(--bg)',
    borderTop: '1px solid var(--border)',
    padding: '14px 40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 100,
  },
  greenCount: {
    fontFamily: 'var(--display)',
    fontSize: 12,
  },
  buttons: {
    display: 'flex',
    gap: 10,
  },
  btnSkip: {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--gray3)',
    borderRadius: 8,
    padding: '8px 16px',
    fontSize: 13,
    fontFamily: 'var(--display)',
    cursor: 'pointer',
  },
  btnApprove: {
    background: 'var(--teal)',
    border: 'none',
    color: '#000',
    borderRadius: 8,
    padding: '8px 20px',
    fontSize: 13,
    fontFamily: 'var(--display)',
    fontWeight: 700,
    cursor: 'pointer',
  },
  btnSubmit: {
    background: 'var(--orange)',
    border: 'none',
    color: '#000',
    borderRadius: 8,
    padding: '8px 20px',
    fontSize: 13,
    fontFamily: 'var(--display)',
    fontWeight: 700,
    cursor: 'pointer',
  },
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    gap: 8,
    textAlign: 'center',
  },
  loadingDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: 'var(--teal)',
    marginBottom: 8,
  },
  code: {
    fontFamily: 'var(--mono)',
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '1px 6px',
    fontSize: 12,
    color: 'var(--teal)',
  },
};
