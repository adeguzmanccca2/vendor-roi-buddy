import { Component, ReactNode, ErrorInfo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Class component because React has no hook equivalent of componentDidCatch --
// an error boundary still has to be a class in React 18.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Only destination available today. When error monitoring is wired up,
    // this is the one place that needs to forward the report.
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Something went wrong</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This page hit an unexpected error. Reloading usually clears it. If it
              keeps happening, let your administrator know what you were doing.
            </p>
            <Button className="w-full" onClick={() => window.location.reload()}>
              Reload the page
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
}
