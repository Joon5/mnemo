'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

type FeedbackType = 'bug' | 'feature' | 'general';

export default function FeedbackWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<FeedbackType>('general');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!message.trim()) {
      alert('Please enter feedback');
      return;
    }

    setIsSubmitting(true);

    try {
      // Try to get current user
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id || null;

      // Get page URL
      const page = typeof window !== 'undefined' ? window.location.pathname : '';

      // Insert feedback into Supabase
      const { error } = await supabase.from('feedback').insert({
        user_id: userId,
        feedback_type: feedbackType,
        message: message.trim(),
        email: email.trim() || null,
        page,
        created_at: new Date().toISOString(),
      });

      if (error) {
        console.error('Feedback submission error:', error);
        alert('Failed to submit feedback. Please try again.');
        return;
      }

      // Show success toast
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);

      // Reset form
      setMessage('');
      setEmail('');
      setFeedbackType('general');
      setIsOpen(false);
    } catch (err) {
      console.error('Feedback error:', err);
      alert('Failed to submit feedback. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Feedback Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="feedback-btn"
        title="Send us feedback"
      >
        Feedback
      </button>

      {/* Modal Overlay */}
      {isOpen && (
        <div className="feedback-overlay" onClick={() => !isSubmitting && setIsOpen(false)}>
          {/* Modal Card */}
          <div className="feedback-card" onClick={(e) => e.stopPropagation()}>
            <div className="feedback-header">
              <h2 className="feedback-title">Send Feedback</h2>
              <button
                className="feedback-close"
                onClick={() => !isSubmitting && setIsOpen(false)}
                disabled={isSubmitting}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="feedback-form">
              {/* Feedback Type */}
              <div className="feedback-field">
                <label className="feedback-label">Type</label>
                <div className="feedback-types">
                  {(['bug', 'feature', 'general'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      className={`feedback-type-btn ${feedbackType === type ? 'active' : ''}`}
                      onClick={() => setFeedbackType(type)}
                      disabled={isSubmitting}
                    >
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Message */}
              <div className="feedback-field">
                <label className="feedback-label">Feedback</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what you think..."
                  className="feedback-textarea"
                  disabled={isSubmitting}
                  minLength={1}
                  maxLength={1000}
                />
              </div>

              {/* Email (Optional) */}
              <div className="feedback-field">
                <label className="feedback-label">Email (optional)</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="feedback-input"
                  disabled={isSubmitting}
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                className="feedback-submit"
                disabled={isSubmitting || !message.trim()}
              >
                {isSubmitting ? 'Submitting...' : 'Submit'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      <div className={`feedback-toast ${showToast ? 'show' : ''}`}>
        Thanks for your feedback!
      </div>

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

        .feedback-btn:hover {
          opacity: 0.9;
          transform: translateY(-2px);
        }

        .feedback-btn:active {
          transform: translateY(0);
        }

        .feedback-overlay {
          position: fixed;
          inset: 0;
          background: rgba(11, 22, 35, 0.88);
          z-index: 160;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          animation: fadeIn 0.2s ease;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        .feedback-card {
          background: var(--card);
          border: 1.5px solid var(--teal);
          border-radius: 12px;
          padding: 24px 28px;
          max-width: 480px;
          width: 100%;
          animation: slideUp 0.3s ease;
        }

        @keyframes slideUp {
          from {
            transform: translateY(20px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }

        .feedback-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
        }

        .feedback-title {
          font-family: var(--display);
          font-size: 16px;
          font-weight: 700;
          color: var(--white);
          margin: 0;
        }

        .feedback-close {
          background: none;
          border: none;
          color: var(--gray2);
          font-size: 20px;
          cursor: pointer;
          padding: 4px 8px;
          transition: color 0.2s;
        }

        .feedback-close:hover {
          color: var(--white);
        }

        .feedback-close:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        .feedback-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .feedback-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .feedback-label {
          font-family: var(--display);
          font-size: 9px;
          color: var(--teal);
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .feedback-types {
          display: flex;
          gap: 8px;
        }

        .feedback-type-btn {
          flex: 1;
          background: var(--card2);
          border: 1.5px solid var(--border);
          color: var(--gray1);
          border-radius: 6px;
          padding: 8px 12px;
          font-family: var(--ui);
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .feedback-type-btn:hover:not(:disabled) {
          border-color: var(--gray2);
        }

        .feedback-type-btn.active {
          background: var(--teal-dim);
          border-color: var(--teal);
          color: var(--teal);
        }

        .feedback-type-btn:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }

        .feedback-textarea {
          background: var(--card2);
          border: 1.5px solid var(--border);
          border-radius: 8px;
          color: var(--white);
          font-family: var(--ui);
          font-size: 13px;
          padding: 12px 14px;
          min-height: 100px;
          resize: vertical;
          outline: none;
          transition: border-color 0.2s;
        }

        .feedback-textarea:focus {
          border-color: var(--teal);
        }

        .feedback-textarea:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }

        .feedback-textarea::placeholder {
          color: var(--gray3);
        }

        .feedback-input {
          background: var(--card2);
          border: 1.5px solid var(--border);
          border-radius: 8px;
          color: var(--white);
          font-family: var(--ui);
          font-size: 13px;
          padding: 10px 14px;
          outline: none;
          transition: border-color 0.2s;
        }

        .feedback-input:focus {
          border-color: var(--teal);
        }

        .feedback-input:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }

        .feedback-input::placeholder {
          color: var(--gray3);
        }

        .feedback-submit {
          background: var(--teal);
          color: var(--bg);
          border: none;
          border-radius: 8px;
          font-family: var(--display);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          padding: 11px 24px;
          cursor: pointer;
          transition: opacity 0.2s;
          margin-top: 8px;
        }

        .feedback-submit:hover:not(:disabled) {
          opacity: 0.88;
        }

        .feedback-submit:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .feedback-toast {
          position: fixed;
          bottom: 100px;
          left: 50%;
          transform: translateX(-50%) translateY(80px);
          background: var(--card2);
          border: 1.5px solid var(--teal);
          color: var(--teal);
          font-family: var(--display);
          font-size: 10px;
          letter-spacing: 0.06em;
          padding: 10px 20px;
          border-radius: 6px;
          z-index: 170;
          pointer-events: none;
          transition: transform 0.3s ease;
        }

        .feedback-toast.show {
          transform: translateX(-50%) translateY(0);
        }
      `}</style>
    </>
  );
}
