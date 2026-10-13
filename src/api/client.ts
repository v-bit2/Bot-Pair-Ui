/**
 * Voltra Mini - Official API Client Module
 * Communicates with the real WhatsApp Bot API at https://pro-bot-aykk.onrender.com/api/v1
 */

import {
  CreateBotRequest,
  CreateBotResponse,
  PairBotRequest,
  PairBotResponse,
  BotStatusResponse,
  HealthResponse,
  ApiErrorDetails,
  ApiLogEntry,
} from './types';

export const RENDER_BACKEND_URL = 'https://pro-bot-aykk.onrender.com';
export const DEFAULT_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) || ''; // Allows env override or defaults to relative path (for dev proxy / Render rewrite)
export const DEFAULT_API_PREFIX = '/api/v1';

// Custom error class with rich HTTP & CORS diagnostic metadata
export class VoltraApiError extends Error {
  public details: ApiErrorDetails;

  constructor(details: ApiErrorDetails) {
    super(details.message);
    this.name = 'VoltraApiError';
    this.details = details;
  }
}

// In-memory request log store for Developer Diagnostics (redacts all credentials)
type LogSubscriber = (logs: ApiLogEntry[]) => void;
class DiagnosticsStore {
  private logs: ApiLogEntry[] = [];
  private subscribers: Set<LogSubscriber> = new Set();
  private maxLogs = 50;

  public addLog(entry: ApiLogEntry) {
    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }
    this.notify();
  }

  public getLogs(): ApiLogEntry[] {
    return [...this.logs];
  }

  public clearLogs() {
    this.logs = [];
    this.notify();
  }

  public subscribe(fn: LogSubscriber): () => void {
    this.subscribers.add(fn);
    fn(this.getLogs());
    return () => {
      this.subscribers.delete(fn);
    };
  }

  private notify() {
    const copy = this.getLogs();
    this.subscribers.forEach((fn) => fn(copy));
  }
}

export const diagnosticsStore = new DiagnosticsStore();

// Sanitizer to guarantee management tokens, passwords, and auth headers NEVER enter logs or error displays
export function sanitizeDataForDiagnostics(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeDataForDiagnostics(item));
  }

  const sensitiveKeys = [
    'managementtoken',
    'token',
    'authorization',
    'x-management-token',
    'secret',
    'password',
    'apikey',
    'api_key',
    'bearer',
  ];

  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some((k) => lowerKey.includes(k))) {
      sanitized[key] = '[REDACTED_MANAGEMENT_TOKEN]';
    } else if (typeof val === 'object' && val !== null) {
      sanitized[key] = sanitizeDataForDiagnostics(val);
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  managementToken?: string;
  baseUrlOverride?: string;
}

export class VoltraApiClient {
  private baseUrl: string;
  private prefix: string;

  constructor(baseUrl = DEFAULT_BASE_URL, prefix = DEFAULT_API_PREFIX) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.prefix = prefix.startsWith('/') ? prefix : `/${prefix}`;
  }

  public setBaseUrl(newBaseUrl: string) {
    this.baseUrl = newBaseUrl.replace(/\/+$/, '');
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getFullPrefixUrl(): string {
    return `${this.baseUrl}${this.prefix}`;
  }

  /**
   * Internal core fetch wrapper with AbortController timeout,
   * safe JSON parsing, detailed error classification, and sanitized diagnostics logging.
   */
  private async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const {
      timeoutMs = 25000,
      managementToken,
      headers: extraHeaders = {},
      baseUrlOverride,
      ...fetchInit
    } = options;

    const base = baseUrlOverride
      ? baseUrlOverride.replace(/\/+$/, '')
      : this.getFullPrefixUrl();
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const fullUrl = `${base}${cleanEndpoint}`;
    const method = (fetchInit.method || 'GET').toUpperCase();
    const startTime = performance.now();
    const logId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Build headers (Never log authorization token values)
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(extraHeaders as Record<string, string>),
    };

    if (fetchInit.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    if (managementToken) {
      // Send both standard Bearer and customary x-management-token for maximum backend compatibility
      headers['Authorization'] = `Bearer ${managementToken}`;
      headers['x-management-token'] = managementToken;
    }

    // AbortController for strict timeout control
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let parsedRequestBody: unknown = undefined;
    if (typeof fetchInit.body === 'string') {
      try {
        parsedRequestBody = JSON.parse(fetchInit.body);
      } catch {
        parsedRequestBody = fetchInit.body;
      }
    }

    try {
      const response = await fetch(fullUrl, {
        ...fetchInit,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const durationMs = Math.round(performance.now() - startTime);

      // Read response content safely
      const contentType = response.headers.get('content-type') || '';
      let parsedBody: unknown;
      let textBody = '';

      try {
        if (contentType.includes('application/json')) {
          parsedBody = await response.json();
        } else {
          textBody = await response.text();
          try {
            parsedBody = JSON.parse(textBody);
          } catch {
            parsedBody = textBody;
          }
        }
      } catch (parseErr) {
        parsedBody = { _parseError: 'Unable to parse response body', raw: textBody };
      }

      // Check HTTP status
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status} (${response.statusText || 'Error'})`;

        if (
          parsedBody &&
          typeof parsedBody === 'object' &&
          'message' in (parsedBody as Record<string, unknown>)
        ) {
          errorMessage = String((parsedBody as Record<string, unknown>).message);
        } else if (
          parsedBody &&
          typeof parsedBody === 'object' &&
          'error' in (parsedBody as Record<string, unknown>)
        ) {
          const errVal = (parsedBody as Record<string, unknown>).error;
          errorMessage = typeof errVal === 'string' ? errVal : JSON.stringify(errVal);
        } else if (typeof parsedBody === 'string' && parsedBody.trim().length > 0) {
          errorMessage = parsedBody.slice(0, 200);
        }

        const errorDetails: ApiErrorDetails = {
          status: response.status,
          statusText: response.statusText,
          message: errorMessage,
          rawBody: parsedBody,
          isCorsOrNetwork: false,
          endpoint: cleanEndpoint,
          method,
          timestamp: new Date().toISOString(),
        };

        // Record diagnostic entry (redacted)
        diagnosticsStore.addLog({
          id: logId,
          timestamp: errorDetails.timestamp,
          method,
          endpoint: cleanEndpoint,
          fullUrl,
          status: response.status,
          durationMs,
          success: false,
          isCorsOrNetwork: false,
          errorMessage,
          sanitizedRequestBody: sanitizeDataForDiagnostics(parsedRequestBody),
          sanitizedResponseBody: sanitizeDataForDiagnostics(parsedBody),
        });

        throw new VoltraApiError(errorDetails);
      }

      // Record successful diagnostic entry (redacted)
      diagnosticsStore.addLog({
        id: logId,
        timestamp: new Date().toISOString(),
        method,
        endpoint: cleanEndpoint,
        fullUrl,
        status: response.status,
        durationMs,
        success: true,
        isCorsOrNetwork: false,
        sanitizedRequestBody: sanitizeDataForDiagnostics(parsedRequestBody),
        sanitizedResponseBody: sanitizeDataForDiagnostics(parsedBody),
      });

      return parsedBody as T;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const durationMs = Math.round(performance.now() - startTime);

      if (err instanceof VoltraApiError) {
        throw err;
      }

      const isAbort =
        err instanceof DOMException && err.name === 'AbortError';
      const isTypeError = err instanceof TypeError;

      let message = 'An unexpected network error occurred';
      let isCorsOrNetwork = false;

      if (isAbort) {
        message = `Request timed out after ${timeoutMs / 1000}s. The backend may be spinning up from sleep on Render, or the server is unresponsive.`;
        isCorsOrNetwork = true;
      } else if (isTypeError) {
        // In browsers, fetch throws TypeError on CORS failure or network disconnection
        message =
          'Network request failed. This commonly occurs if the backend server is offline/sleeping on Render, or if the API does not allow requests from this browser origin (CORS restriction).';
        isCorsOrNetwork = true;
      } else if (err instanceof Error) {
        message = err.message;
      }

      const errorDetails: ApiErrorDetails = {
        status: 0,
        statusText: isAbort ? 'TIMEOUT' : isCorsOrNetwork ? 'CORS_OR_NETWORK' : 'ERROR',
        message,
        isCorsOrNetwork,
        endpoint: cleanEndpoint,
        method,
        timestamp: new Date().toISOString(),
      };

      diagnosticsStore.addLog({
        id: logId,
        timestamp: errorDetails.timestamp,
        method,
        endpoint: cleanEndpoint,
        fullUrl,
        status: 0,
        durationMs,
        success: false,
        isCorsOrNetwork,
        errorMessage: message,
        sanitizedRequestBody: sanitizeDataForDiagnostics(parsedRequestBody),
      });

      throw new VoltraApiError(errorDetails);
    }
  }

  /**
   * GET /api/v1/health
   * Check API availability and response.
   */
  public async checkHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health', {
      method: 'GET',
      timeoutMs: 15000,
    });
  }

  /**
   * POST /api/v1/bots
   * Create a new bot. Does not retry automatically on timeout to prevent duplicate bots.
   */
  public async createBot(payload: CreateBotRequest): Promise<CreateBotResponse> {
    return this.request<CreateBotResponse>('/bots', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 30000,
    });
  }

  /**
   * POST /api/v1/bots/:botId/pair
   * Start WhatsApp pairing flow for pairing-code or QR.
   */
  public async pairBot(
    botId: string,
    payload: PairBotRequest,
    managementToken: string
  ): Promise<PairBotResponse> {
    const encodedId = encodeURIComponent(botId);
    return this.request<PairBotResponse>(`/bots/${encodedId}/pair`, {
      method: 'POST',
      body: JSON.stringify(payload),
      managementToken,
      timeoutMs: 30000,
    });
  }

  /**
   * GET /api/v1/bots/:botId/status
   * Retrieve current bot status.
   */
  public async getBotStatus(
    botId: string,
    managementToken: string
  ): Promise<BotStatusResponse> {
    const encodedId = encodeURIComponent(botId);
    return this.request<BotStatusResponse>(`/bots/${encodedId}/status`, {
      method: 'GET',
      managementToken,
      timeoutMs: 15000,
    });
  }
}

// Global default singleton instance
export const api = new VoltraApiClient();
