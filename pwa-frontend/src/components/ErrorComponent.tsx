import { useRouteError, useNavigate } from "react-router";
import {
  AlertCircle,
  Home,
  ArrowLeft,
  RefreshCw,
  Code,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function ErrorComponent() {
  const error = useRouteError() as Error;
  const navigate = useNavigate();

  const handleGoBack = () => navigate(-1);
  const handleGoHome = () => (window.location.href = "/");
  const handleReload = () => window.location.reload();

  return (
    <main
      className="min-h-screen flex items-center justify-center bg-background p-8"
      role="main"
      tabIndex={-1}
    >
      <Card
        className="w-full max-w-[60%] shadow-xs"
        role="region"
        aria-labelledby="error-heading"
        aria-describedby="error-message"
      >
        <CardContent className="flex flex-col items-center text-center p-8 space-y-6">
          <div
            className="relative w-20 h-20 rounded-full bg-linear-to-br from-destructive/10 to-destructive/5 flex items-center justify-center"
            aria-hidden="true"
          >
            <div className="absolute inset-0 rounded-full border-2 border-destructive/20" />
            <AlertCircle
              className="h-10 w-10 text-destructive drop-shadow-sm"
              strokeWidth={2}
              aria-hidden="true"
            />
          </div>

          <div className="space-y-2" role="alert" aria-live="assertive" aria-atomic="true">
            <h1
              id="error-heading"
              className="text-3xl font-bold tracking-tight text-foreground"
              tabIndex={-1}
            >
              Oops! Something went wrong
            </h1>
            <p id="error-message" className="text-muted-foreground text-lg leading-relaxed max-w-md mx-auto">
              {error?.message ||
                "We encountered an unexpected error while navigating. Your data is safe, and you can try one of the options below."}
            </p>
          </div>

          {import.meta.env.DEV && error && (
            <details className="w-full" aria-expanded="false" aria-controls="error-details">
              <summary
                className="cursor-pointer font-semibold text-foreground mb-2 flex items-center gap-2 hover:text-foreground/80"
                tabIndex={0}
              >
                <Code className="h-4 w-4" aria-hidden="true" />
                Error Details (Development)
              </summary>
              <Alert id="error-details" className="font-mono text-sm p-4">
                <pre className="text-destructive overflow-x-auto whitespace-pre-wrap text-xs">
                  <strong>{error.toString()}</strong>
                </pre>
                {error.stack && (
                  <AlertDescription className="mt-2 text-xs text-muted-foreground">
                    {error.stack}
                  </AlertDescription>
                )}
              </Alert>
            </details>
          )}
        </CardContent>

        <CardFooter className="flex flex-wrap gap-3 p-6 border-t bg-muted/50 justify-center">
          <Button
            onClick={handleGoHome}
            className="min-w-[120px] flex items-center gap-2"
            aria-label="Go to home page"
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            Go Home
          </Button>
          <Button
            variant="outline"
            onClick={handleGoBack}
            className="min-w-[120px] flex items-center gap-2"
            aria-label="Go back to previous page"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Go Back
          </Button>
          <Button
            variant="outline"
            onClick={handleReload}
            className="min-w-[120px] flex items-center gap-2"
            aria-label="Reload the page"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Reload Page
          </Button>
        </CardFooter>

        <div
          className="px-6 pb-6 text-center text-sm text-muted-foreground border-t"
          role="contentinfo"
        >
          <AlertCircle className="h-4 w-4 inline mr-1" aria-hidden="true" />
          Need help? Contact support at{" "}
          <a href="mailto:support@example.com" className="underline">
            support@example.com
          </a>
        </div>
      </Card>
    </main>

  );
}
