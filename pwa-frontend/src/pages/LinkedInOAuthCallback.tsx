import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * OAuth callback helper: LinkedIn redirects here with ?code=...&state=...
 * Shows values so you can copy `code` into the token-exchange curl (never commit the code).
 */
export default function LinkedInOAuthCallbackPage() {
  const [search] = useSearchParams();
  const code = search.get('code') ?? '';
  const state = search.get('state') ?? '';
  const error = search.get('error') ?? '';
  const errorDesc = search.get('error_description') ?? '';

  const fullQuery = useMemo(() => search.toString(), [search]);

  const copy = async (text: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
  };

  return (
    <div className="min-h-[50vh] flex items-center justify-center p-6 bg-slate-50">
      <Card className="max-w-lg w-full shadow-md">
        <CardHeader>
          <CardTitle className="text-lg">LinkedIn OAuth — response</CardTitle>
          <CardDescription>
            If you see a <code className="text-xs">code</code> below, copy it and exchange it for an
            access token (curl on your machine — use your client secret). Secret name in AWS:{' '}
            <code className="text-xs">linkedin_content_publish</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <strong>{error}</strong>
              {errorDesc ? <p className="mt-1">{errorDesc}</p> : null}
            </div>
          ) : null}

          {fullQuery ? (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">Full query string</p>
              <pre className="text-xs break-all bg-slate-100 p-2 rounded border">{fullQuery}</pre>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No query parameters in this URL.</p>
          )}

          {code ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Authorization code</p>
              <pre className="text-xs break-all bg-slate-100 p-2 rounded border max-h-32 overflow-auto">
                {code}
              </pre>
              <Button type="button" size="sm" onClick={() => void copy(code)}>
                Copy code
              </Button>
            </div>
          ) : null}

          {state ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">state:</span> {state}
            </p>
          ) : null}

          <p className="text-xs text-muted-foreground border-t pt-3">
            Configure this exact URL in LinkedIn → Auth → Authorized redirect URLs:{' '}
            <code className="block mt-1">
              {typeof window !== 'undefined' ? `${window.location.origin}/oauth/linkedin/callback` : '/oauth/linkedin/callback'}
            </code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
