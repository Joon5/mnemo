'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

type FeedbackType = 'bug' | 'feature' | 'general';

function StarRating({ value, onChange, label }: { value: number | null; onChange: (v: number) => void; label: string }) {
  return (
    <div className="feedback-field">
      <label className="feedback-label">{label}</label>
      <div style={{ display: 'flex', gap: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 22,
              color: value !== null && n <= value ? 'var(--teal)' : 'var(--gray3)',
              padding: '2px 4px',
              transition: 'color .15s',
            }}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}

function ScaleRating({ value, onChange, label }: { value: number | null; onChange: (v: number) => void; label: string }) {
  return (
    <div className="feedback-field">
      <label className="feedback-label">{label}</label>
      <div style={{ display: 'flex', gap: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            style={{
              flex: 1,
              background: value === n ? 'var(--teal-dim)' : 'var(--card2)',
              border: `1.5px solid ${value === n ? 'var(--teal)' : 'var(--border)'}`,
              color: value === n ? 'var(--teal)' : 'var(--gray2)',
              borderRadius: 6,
              padding: '6px 4px',
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: 'var(--ui)',
              transition: 'all .15s',
            }}
          >
            {n}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
        <span style={{ fontSize: 9, color: 'var(--gray3)' }}>Poor</span>
        <span style={{ fontSize: 9, color: 'var(--gray3)' }}>Excellent</span>
      </div>
    </div>
  );
}

export default function FeedbackWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<FeedbackType>('general');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Ratings
  const [mnemoRating, setMnemoRating] = useState<number | null>(null);
  const [withRating, setWithRating] = useState<number | null>(null);
  const [beforeRating, setBeforeRating] = useState<number | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) { alert('Please enter feedback'); return; }
    setIsSubmitting(true);
    try {
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id || null;
      const page = typeof window !== 'undefined' ? window.location.pathname : '';
      const { error } = await supabase.from('feedback').insert({
        user_id: userId,
        feedback_type: feedbackType,
        message: message.trim(),
        email: email.trim() || null,
        page,
        mnemo_rating: mnemoRating,
        comprehension_with_mnemo: withRating,
        comprehension_before_mnemo: beforeRating,
        created_at: new Date().toISOString(),
      });
      if (error) { console.error('Feedback error:', error); alert('Failed to submit. Please try again.'); return; }
      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        setIsOpen(false);
        setMessage('');
        setEmail('');
        setFeedbackType('general');
        setMnemoRating(null);
        setWithRating(null);
        setBeforeRating(null);
      }, 2000);
    } catch (err) {
      console.error('Feedback error:', err);
      alert('Failed to submit feedback. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <button onClick={() => setIsOpen(true)} className="feedback-btn" title="Send us feedback">
        Feedback
      </button>

      {isOpen && (
        <div className="feedback-overlay" onClick={() => !isSubmitting && setIsOpen(false)}>
          <div className="feedback-card" onClick={(e) => e.stopPropagation()}>
            <div className="feedback-header">
              <h2 className="feedback-title">Feedback</h2>
              <button className="feedback-close" onClick={() => !isSubmitting && setIsOpen(false)} disabled={isSubmitting}>✕</button>
            </div>

            {submitted ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--teal)', fontFamily: 'var(--display)', fontSize: 13 }}>
                ✓ Thanks for your feedback!
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="feedback-form">
                {/* Ratings */}
                <StarRating value={mnemoRating} onChange={setMnemoRating} label="Rate mnemo overall (1–5)" />
                <ScaleRating value={withRating} onChange={setWithRating} label="Comprehension speed &amp; retention — with mnemo" />
                <ScaleRating value={beforeRating} onChange={setBeforeRating} label="Comprehension speed &amp; retention — before mnemo" />

                <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

                {/* Type */}
                <div className="feedback-field">
                  <label className="feedback-label">Type</label>
                  <div className="feedback-types">
                    {(['bug', 'feature', 'general'] as const).map((type) => (
                      <button key={type} type="button"
                        className={`feedback-type-btn ${feedbackType === type ? 'active' : ''}`}
                        onClick={() => setFeedbackType(type)} disabled={isSubmitting}>
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Message */}
                <div className="feedback-field">
                  <label className="feedback-label">Message</label>
                  <textarea value={message} onChange={(e) => setMessage(e.target.value)}
                    placeholder="Tell us what you think..." className="feedback-textarea"
                    disabled={isSubmitting} maxLength={1000} />
                </div>

                {/* Email */}
                <div className="feedback-field">
                  <label className="feedback-label">Email (optional)</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com" className="feedback-input" disabled={isSubmitting} />
                </div>

                <button type="submit" className="feedback-submit" disabled={isSubmitting || !message.trim()}>
                  {isSubmitting ? 'Submitting...' : 'Submit'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .feedback-btn {
          position: fixed;
          bottom: 24px;
          right: 24px;
          background: var(--teal);
          color: var(--bg);
          border: none;
          border-radius: 20px;
          font-family: var(--display);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.04em;
          padding: 10px 20px;
          cursor: pointer;
          transition: opacity 0.2s, transform 0.1s;
          z-index: 150;
          box-shadow: 0 4px 12px rgba(0, 200, 150, 0.2);
        }
        .feedback-btn:hover { opacity: .9; transform: translateY(-2px); }
        .feedback-btn:active { transform: translateY(0); }
        .feedback-overlay {
          position: fixed; inset: 0;
          background: rgba(0, 0, 0, 0.88);
          z-index: 160;
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
          animation: fadeIn 0.2s ease;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .feedback-card {
          background: var(--card);
          border: 1.5px solid var(--teal);
          border-radius: 12px;
          padding: 24px 28px;
          max-width: 480px;
          width: 100%;
          max-height: 90vh;
          overflow-y: auto;
          animation: slideUp 0.3s ease;
        }
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .feedback-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
        .feedback-title { font-size: 16px; font-weight: 700; color: var(--white); margin: 0; }
        .feedback-close { background: none; border: none; color: var(--gray2); font-size: 20px; cursor: pointer; padding: 4px 8px; transition: color .2s; }
        .feedback-close:hover { color: var(--white); }
        .feedback-form { display: flex; flex-direction: column; gap: 16px; }
        .feedback-field { display: flex; flex-direction: column; gap: 6px; }
        .feedback-label { font-size: 9px; color: var(--teal); letter-spacing: .12em; text-transform: uppercase; }
        .feedback-types { display: flex; gap: 8px; }
        .feedback-type-btn { flex: 1; background: var(--card2); border: 1.5px solid var(--border); color: var(--gray2); border-radius: 6px; padding: 8px 12px; font-family: var(--ui); font-size: 12px; cursor: pointer; transition: all .2s; }
        .feedback-type-btn:hover:not(:disabled) { border-color: var(--gray2); }
        .feedback-type-btn.active { background: var(--teal-dim); border-color: var(--teal); color: var(--teal); }
        .feedback-textarea { background: var(--card2); border: 1.5px solid var(--border); border-radius: 8px; color: var(--white); font-family: var(--ui); font-size: 13px; padding: 12px 14px; min-height: 80px; resize: vertical; outline: none; transition: border-color .2s; }
        .feedback-textarea:focus { border-color: var(--teal); }
        .feedback-textarea::placeholder { color: var(--gray3); }
        .feedback-input { background: var(--card2); border: 1.5px solid var(--border); border-radius: 8px; color: var(--white); font-family: var(--ui); font-size: 13px; padding: 10px 14px; outline: none; transition: border-color .2s; }
        .feedback-input:focus { border-color: var(--teal); }
        .feedback-input::placeholder { color: var(--gray3); }
        .feedback-submit { background: var(--teal); color: var(--bg); border: none; border-radius: 8px; font-size: 11px; font-weight: 700; letter-spacing: .06em; padding: 11px 24px; cursor: pointer; transition: opacity .2s; margin-top: 4px; }
        .feedback-submit:hover:not(:disabled) { opacity: .88; }
        .feedback-submit:disabled { opacity: .5; cursor: not-allowed; }
      `}</style>
    </>
  );
}
