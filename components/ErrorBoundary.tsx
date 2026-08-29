'use client';

import React from 'react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        // Last-resort recovery UI for client-only conversation failures.
        <div className="flex flex-col items-center justify-center min-h-[320px] p-8 text-center">
          <div className="max-w-md rounded-[28px] border border-border/60 bg-card/80 px-8 py-9 shadow-[0_20px_60px_-15px_rgba(74,74,74,0.28)] backdrop-blur-xl">
            <h2 className="text-lg font-semibold text-destructive mb-4">
              Something went wrong
            </h2>
            <p className="text-muted-foreground text-sm mb-6">
              An error occurred while loading the conversation. Please try refreshing the page.
            </p>
            <Button
              onClick={() => window.location.reload()}
              className="rounded-xl bg-gradient-to-r from-primary to-secondary text-primary-foreground shadow-[0_8px_20px_-6px_rgba(226,180,189,0.6)] hover:from-primary/90 hover:to-secondary/90"
            >
              Refresh Page
            </Button>
          </div>
        </div>
      );
    }

    // Happy path: render the wrapped conversation subtree unchanged.
    return this.props.children;
  }
}
