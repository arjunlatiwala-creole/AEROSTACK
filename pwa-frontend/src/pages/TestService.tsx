import React, { useState } from 'react';
import { executable } from '../lib/squidClient';

export default function TestServicePage() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const testPing = async () => {
    setLoading(true);
    setError(null);
    try {
      const ping = executable('TestService', 'testPing');
      const res = await ping();
      console.log('testPing result:', res);
      setResult(res);
    } catch (err: any) {
      console.error('Error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const testEcho = async () => {
    setLoading(true);
    setError(null);
    try {
      const echo = executable('TestService', 'testEcho');
      const testData = {
        message: 'Hello from frontend!',
        timestamp: new Date().toISOString(),
        random: Math.random()
      };
      const res = await echo(testData);
      console.log('testEcho result:', res);
      setResult(res);
    } catch (err: any) {
      console.error('Error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Test Service</h1>
      <p>Test Squid backend connectivity and HMR</p>

      <div style={{ marginTop: '30px', display: 'flex', gap: '10px' }}>
        <button
          onClick={testPing}
          disabled={loading}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            background: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? 'Loading...' : 'Test Ping'}
        </button>

        <button
          onClick={testEcho}
          disabled={loading}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            background: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? 'Loading...' : 'Test Echo'}
        </button>
      </div>

      {error && (
        <div style={{
          marginTop: '20px',
          padding: '15px',
          background: '#ffebee',
          color: '#c62828',
          borderRadius: '6px',
          border: '1px solid #ef5350'
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && (
        <div style={{
          marginTop: '20px',
          padding: '15px',
          background: '#e8f5e9',
          borderRadius: '6px',
          border: '1px solid #4caf50'
        }}>
          <h3>Result:</h3>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}

      <div style={{ marginTop: '40px', padding: '20px', background: '#f5f5f5', borderRadius: '8px' }}>
        <h3>Webhook Info</h3>
        <p>Webhook endpoint: <code>test-webhook</code></p>
        <p>Check the backend console for webhook logs when triggered</p>
      </div>
    </div>
  );
}

