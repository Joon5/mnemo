'use client';

import { useState, useEffect } from 'react';

export default function OnboardingOverlay() {
  const [isVisible, setIsVisible] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);

  useEffect(() => {
    // Check if user has already seen onboarding
    if (typeof window !== 'undefined') {
      const hasSeenOnboarding = localStorage.getItem('mnemo-onboarding-done');
      if (!hasSeenOnboarding) {
        setIsVisible(true);
      }
    }
  }, []);

  const handleGetStarted = () => {
    localStorage.setItem('mnemo-onboarding-done', 'true');
    setIsVisible(false);
  };

  const handleNext = () => {
    if (currentSlide < 2) {
      setCurrentSlide(currentSlide + 1);
    } else {
      handleGetStarted();
    }
  };

  const handlePrev = () => {
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
    }
  };

  if (!isVisible) {
    return null;
  }

  const slides = [
    {
      title: 'Welcome to mnemo',
      content: 'Read it. Keep it. Paste any text and mnemo will help you read faster and retain more information.',
      icon: '📚',
    },
    {
      title: 'How it works',
      content: 'Paste text → AI primes the content → Speed read with visual cues → Test your retention with checkpoints and flashcards.',
      icon: '⚡',
    },
    {
      title: 'Pro tips',
      content: 'Adjust WPM with the slider, save your progress with bookmarks, use keyboard shortcuts (space to pause, arrow keys to navigate).',
      icon: '✨',
    },
  ];

  const slide = slides[currentSlide];

  return (
    <>
      <div className="onboarding-overlay">
        <div className="onboarding-card">
          {/* Close Button */}
          <button className="onboarding-close" onClick={handleGetStarted} title="Skip">
            ✕
          </button>

          {/* Icon */}
          <div className="onboarding-icon">{slide.icon}</div>

          {/* Content */}
          <h2 className="onboarding-title">{slide.title}</h2>
          <p className="onboarding-content">{slide.content}</p>

          {/* Slide Indicators */}
          <div className="onboarding-dots">
            {slides.map((_, idx) => (
              <div
                key={idx}
                className={`onboarding-dot ${idx === currentSlide ? 'active' : ''}`}
              />
            ))}
          </div>

          {/* Navigation */}
          <div className="onboarding-nav">
            <button
              className="onboarding-btn sec"
              onClick={handlePrev}
              disabled={currentSlide === 0}
            >
              Back
            </button>

            {currentSlide < 2 ? (
              <button className="onboarding-btn pri" onClick={handleNext}>
                Next
              </button>
            ) : (
              <button className="onboarding-btn pri" onClick={handleGetStarted}>
                Get Started
              </button>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        .onboarding-overlay {
          position: fixed;
          inset: 0;
          background: rgba(11, 22, 35, 0.92);
          z-index: 140;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          animation: fadeIn 0.3s ease;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        .onboarding-card {
          background: var(--card);
          border: 1.5px solid var(--teal);
          border-radius: 16px;
          padding: 40px 36px;
          max-width: 520px;
          width: 100%;
          text-align: center;
          animation: slideUp 0.3s ease;
          position: relative;
        }

        @keyframes slideUp {
          from {
            transform: translateY(30px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }

        .onboarding-close {
          position: absolute;
          top: 16px;
          right: 16px;
          background: none;
          border: none;
          color: var(--gray2);
          font-size: 24px;
          cursor: pointer;
          padding: 4px;
          transition: color 0.2s;
        }

        .onboarding-close:hover {
          color: var(--white);
        }

        .onboarding-icon {
          font-size: 48px;
          margin-bottom: 20px;
          animation: bounce 0.6s ease;
        }

        @keyframes bounce {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-8px);
          }
        }

        .onboarding-title {
          font-family: var(--display);
          font-size: 24px;
          font-weight: 700;
          color: var(--white);
          margin: 0 0 12px 0;
        }

        .onboarding-content {
          font-size: 13px;
          color: var(--gray1);
          line-height: 1.7;
          margin: 0 0 28px 0;
        }

        .onboarding-dots {
          display: flex;
          justify-content: center;
          gap: 8px;
          margin-bottom: 24px;
        }

        .onboarding-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--border);
          transition: all 0.3s ease;
        }

        .onboarding-dot.active {
          background: var(--teal);
          width: 24px;
          border-radius: 4px;
        }

        .onboarding-nav {
          display: flex;
          gap: 12px;
          justify-content: center;
        }

        .onboarding-btn {
          font-family: var(--display);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          padding: 11px 24px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
          min-width: 100px;
        }

        .onboarding-btn.pri {
          background: var(--teal);
          border: none;
          color: var(--bg);
        }

        .onboarding-btn.pri:hover {
          opacity: 0.88;
        }

        .onboarding-btn.sec {
          background: transparent;
          border: 1.5px solid var(--border);
          color: var(--gray1);
        }

        .onboarding-btn.sec:hover {
          border-color: var(--gray2);
          color: var(--white);
        }

        .onboarding-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
      `}</style>
    </>
  );
}
