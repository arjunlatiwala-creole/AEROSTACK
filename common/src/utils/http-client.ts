// Aerostack V1 HTTP Client Utility
// Standardized HTTP client for API calls with logging and error handling

import { ApiError } from '../types/aerostack';
import { createLogger } from './logger';

const logger = createLogger('http-client');

export interface HttpClientConfig {
  baseUrl: string;
  timeout?: number;
  defaultHeaders?: Record<string, string>;
  retries?: number;
  retryDelay?: number;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
  retries?: number;
  skipLogging?: boolean;
}

export class HttpClient {
  private config: HttpClientConfig;

  constructor(config: HttpClientConfig) {
    this.config = {
      timeout: 10000,
      retries: 3,
      retryDelay: 1000,
      ...config,
    };
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private isRetryableError(error: any): boolean {
    // Retry on network errors or 5xx status codes
    return !error.status || (error.status >= 500 && error.status < 600);
  }

  private async makeRequest<T>(
    method: string,
    path: string,
    data?: any,
    options: RequestOptions = {}
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const startTime = Date.now();
    
    const headers = {
      'Content-Type': 'application/json',
      ...this.config.defaultHeaders,
      ...options.headers,
    };

    const requestConfig: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(options.timeout || this.config.timeout!),
    };

    if (data && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestConfig.body = JSON.stringify(data);
    }

    let lastError: any;
    const maxRetries = options.retries ?? this.config.retries!;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, requestConfig);
        const latency = Date.now() - startTime;

        if (!options.skipLogging) {
          logger.logApiCall(path, method, latency, response.ok ? 'success' : 'error', {
            payload_shape: data ? Object.keys(data).join(',') : undefined,
            error_code: response.ok ? undefined : response.status.toString(),
          });
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({})) as any;
          const apiError: ApiError = {
            error: {
              code: `HTTP_${response.status}`,
              message: errorData.error?.message || response.statusText,
              details: errorData.error?.details || { status: response.status },
            },
          };
          throw apiError;
        }

        return await response.json() as T;
      } catch (error: any) {
        lastError = error;
        const latency = Date.now() - startTime;

        if (!options.skipLogging) {
          logger.logApiCall(path, method, latency, 'error', {
            error_code: error.error?.code || error.name,
            payload_shape: data ? Object.keys(data).join(',') : undefined,
          });
        }

        // Don't retry on the last attempt or if error is not retryable
        if (attempt === maxRetries || !this.isRetryableError(error)) {
          throw error;
        }

        // Wait before retrying
        await this.delay(this.config.retryDelay! * Math.pow(2, attempt));
        
        if (!options.skipLogging) {
          logger.warn(`Retrying request (attempt ${attempt + 2}/${maxRetries + 1})`, {
            action: 'http_retry',
            error_code: error.error?.code || error.name,
          });
        }
      }
    }

    throw lastError;
  }

  async get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.makeRequest<T>('GET', path, undefined, options);
  }

  async post<T>(path: string, data?: any, options?: RequestOptions): Promise<T> {
    return this.makeRequest<T>('POST', path, data, options);
  }

  async put<T>(path: string, data?: any, options?: RequestOptions): Promise<T> {
    return this.makeRequest<T>('PUT', path, data, options);
  }

  async patch<T>(path: string, data?: any, options?: RequestOptions): Promise<T> {
    return this.makeRequest<T>('PATCH', path, data, options);
  }

  async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.makeRequest<T>('DELETE', path, undefined, options);
  }
}

// Factory function for creating configured HTTP clients
export const createHttpClient = (config: HttpClientConfig): HttpClient => {
  return new HttpClient(config);
};

// Default client for frontend use
export const createAerostackApiClient = (baseUrl: string, authToken?: string): HttpClient => {
  return createHttpClient({
    baseUrl,
    defaultHeaders: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    timeout: 10000,
    retries: 3,
    retryDelay: 1000,
  });
};
