import React, { ReactNode, ReactElement } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render(): ReactElement {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-container">
          <div className="error-card">
            <div className="error-icon">⚠</div>
            <h1 className="error-title">Something went wrong</h1>
            <p className="error-message">
              We encountered an unexpected error. Try reloading the page.
            </p>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="error-details">
                <summary>Error details (dev only)</summary>
                <pre className="error-trace">{this.state.error.toString()}</pre>
              </details>
            )}
            <button className="error-reload-btn" onClick={this.handleReload}>
              Reload Page
            </button>
          </div>

          <style jsx>{`
            .error-boundary-container {
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              background: var(--bg);
              padding: 20px;
            }

            .error-card {
              background: var(--card);
              border: 1.5px solid var(--red);
              border-radius: 12px;
              padding: 40px 36px;
              max-width: 480px;
              width: 100%;
              text-align: center;
            }

            .error-icon {
              font-size: 48px;
              margin-bottom: 16px;
              animation: shake 0.5s ease;
            }

            @keyframes shake {
              0%, 100% {
                transform: translateX(0);
              }
              25% {
                transform: translateX(-4px);
              }
              75% {
                transform: translateX(4px);
              }
            }

            .error-title {
              font-family: var(--display);
              font-size: 20px;
              font-weight: 700;
              color: var(--red);
              margin: 0 0 12px 0;
            }

            .error-message {
              font-size: 13px;
              color: var(--gray1);
              line-height: 1.7;
              margin: 0 0 24px 0;
            }

            .error-details {
              background: var(--card2);
              border: 1px solid var(--border);
              border-radius: 6px;
              padding: 12px;
              margin-bottom: 20px;
              text-align: left;
            }

            .error-details summary {
              cursor: pointer;
              color: var(--gray2);
              font-size: 11px;
              font-family: var(--display);
            }

            .error-details summary:hover {
              color: var(--white);
            }

            .error-trace {
              color: var(--gray1);
              font-size: 10px;
              margin: 8px 0 0 0;
              overflow-x: auto;
              font-family: var(--mono);
            }

            .error-reload-btn {
              background: var(--red);
              color: var(--white);
              border: none;
              border-radius: 8px;
              font-family: var(--display);
              font-size: 11px;
              font-weight: 700;
              letter-spacing: 0.06em;
              padding: 11px 28px;
              cursor: pointer;
              transition: opacity 0.2s;
            }

            .error-reload-btn:hover {
              opacity: 0.88;
            }

            .error-reload-btn:active {
              transform: translateY(1px);
            }
          `}</style>
        </div>
      );
    }

    return <>{this.props.children}</>;
  }
}
