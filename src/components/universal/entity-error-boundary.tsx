"use client";

/**
 * Entity Error Boundary
 *
 * A specialized error boundary for entity components (EntityList, EntityDetail, EntityForm).
 * Provides entity-aware error messaging and retry functionality.
 */

import { Component, ReactNode } from "react";
import { log } from "@/lib/client-logger";
import type { EntityConfig } from "@/types/entity";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, RefreshCw } from "lucide-react";

type EntityErrorBoundaryProps = {
  children: ReactNode;
  entity: EntityConfig<Record<string, unknown>>;
  /** Called when user clicks retry */
  onRetry?: () => void;
}

type State = {
  hasError: boolean;
  error?: Error;
}

export class EntityErrorBoundary extends Component<EntityErrorBoundaryProps, State> {
  constructor(props: EntityErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    log.error(
      `[EntityErrorBoundary] Error in ${this.props.entity.displayName}:`,
      error,
      errorInfo
    );
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      const { entity } = this.props;
      const isDev = process.env.NODE_ENV === "development";

      return (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Failed to load {entity.displayName.toLowerCase()}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              There was a problem loading this {entity.displayName.toLowerCase()}.
              This could be a temporary issue or a problem with the data.
            </p>

            {isDev && this.state.error && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                  Error details (dev only)
                </summary>
                <pre className="mt-2 overflow-auto rounded bg-muted p-3 text-xs">
                  {this.state.error.message}
                  {this.state.error.stack && (
                    <>
                      {"\n\nStack trace:\n"}
                      {this.state.error.stack}
                    </>
                  )}
                </pre>
              </details>
            )}

            <div className="flex gap-2">
              <Button onClick={this.handleRetry} variant="outline">
                <RefreshCw className="h-4 w-4 mr-2" />
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}

/**
 * Hook-friendly wrapper for EntityErrorBoundary.
 * Use this when you need to wrap a component that uses hooks.
 */
export function withEntityErrorBoundary<T extends Record<string, unknown>>(
  WrappedComponent: React.ComponentType<{ entity: EntityConfig<T> } & Record<string, unknown>>,
  entity: EntityConfig<T>
) {
  return function EntityErrorBoundaryWrapper(props: Record<string, unknown>) {
    return (
      <EntityErrorBoundary entity={entity as EntityConfig<Record<string, unknown>>}>
        <WrappedComponent entity={entity} {...props} />
      </EntityErrorBoundary>
    );
  };
}
