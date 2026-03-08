import { logger } from '@/shared/lib/logger'
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

const CONTAINER_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  padding: '20px',
  textAlign: 'center',
  backgroundColor: '#1f1f1f',
  color: '#ffffff',
}

const ERROR_STYLE: React.CSSProperties = {
  marginTop: '20px',
  padding: '10px',
  backgroundColor: '#2a2a2a',
  color: '#ff6b6b',
  borderRadius: '4px',
  overflow: 'auto',
  maxWidth: '100%',
}

/**
 * Error Boundary component that catches unexpected React errors.
 *
 * Logs errors using the unified logger and displays a fallback UI
 * when an error occurs. This ensures unexpected errors are captured
 * in the log file for debugging purposes.
 *
 * @example
 * ```tsx
 * <ErrorBoundary fallback={<ErrorPage />}>
 *   <App />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logger.error(
      'React Error Boundary caught an error',
      `${error.message}\nComponent stack: ${errorInfo.componentStack}`,
    )
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    if (this.props.fallback) {
      return this.props.fallback
    }

    return (
      <div style={CONTAINER_STYLE}>
        <h1>Something went wrong</h1>
        <p>An unexpected error occurred. Please restart the application.</p>
        {import.meta.env.DEV && this.state.error && (
          <pre style={ERROR_STYLE}>{this.state.error.message}</pre>
        )}
      </div>
    )
  }
}
