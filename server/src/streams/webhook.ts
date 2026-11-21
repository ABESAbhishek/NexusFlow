import type { ThresholdAlertEvent } from "../streams/operators.js";

export type WebhookAuthType = "none" | "bearer" | "basic" | "custom_header";

export interface WebhookEndpointConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  events: Array<"alert.info" | "alert.warning" | "alert.critical" | "telemetry.anomaly">;
  authType?: WebhookAuthType;
  authToken?: string;
  customHeaders?: Record<string, string>;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface WebhookDeliveryAttempt {
  id: string;
  webhookId: string;
  url: string;
  event: string;
  attemptNumber: number;
  status: "success" | "failure" | "pending";
  statusCode?: number;
  error?: string;
  timestamp: Date;
  durationMs: number;
}

export interface WebhookDispatchResult {
  totalConfigured: number;
  dispatched: number;
  successful: number;
  failed: number;
  attempts: WebhookDeliveryAttempt[];
}

/**
 * Webhook and external Alert notification dispatcher (Member 3 - Week 4 Foundation).
 * Supports HTTP webhook callbacks with retries, custom headers, timeout management, and delivery tracking.
 */
export class WebhookDispatcher {
  private readonly endpoints = new Map<string, WebhookEndpointConfig>();
  private readonly deliveryHistory: WebhookDeliveryAttempt[] = [];
  private readonly maxHistory: number;
  private fetchFn: typeof fetch;

  constructor(options: { maxHistory?: number; fetchImpl?: typeof fetch } = {}) {
    this.maxHistory = options.maxHistory ?? 200;
    this.fetchFn = options.fetchImpl ?? globalThis.fetch;
  }

  public registerEndpoint(endpoint: WebhookEndpointConfig): void {
    this.endpoints.set(endpoint.id, {
      ...endpoint,
      maxRetries: endpoint.maxRetries ?? 3,
      timeoutMs: endpoint.timeoutMs ?? 5000
    });
  }

  public unregisterEndpoint(id: string): boolean {
    return this.endpoints.delete(id);
  }

  public getEndpoints(): WebhookEndpointConfig[] {
    return Array.from(this.endpoints.values());
  }

  public getDeliveryHistory(limit?: number): WebhookDeliveryAttempt[] {
    const count = limit ? Math.min(limit, this.deliveryHistory.length) : this.deliveryHistory.length;
    return this.deliveryHistory.slice(-count);
  }

  /**
   * Dispatches an alert event to all matching subscribed webhook endpoints with retry mechanism.
   */
  public async dispatchAlert(alert: ThresholdAlertEvent): Promise<WebhookDispatchResult> {
    const eventType = `alert.${alert.severity}` as const;
    const matchingEndpoints = Array.from(this.endpoints.values()).filter(
      (ep) => ep.enabled && ep.events.includes(eventType)
    );

    const attempts: WebhookDeliveryAttempt[] = [];
    let successful = 0;
    let failed = 0;

    for (const endpoint of matchingEndpoints) {
      const attempt = await this.deliverWithRetry(endpoint, eventType, alert);
      attempts.push(attempt);
      this.recordAttempt(attempt);

      if (attempt.status === "success") {
        successful++;
      } else {
        failed++;
      }
    }

    return {
      totalConfigured: this.endpoints.size,
      dispatched: matchingEndpoints.length,
      successful,
      failed,
      attempts
    };
  }

  private async deliverWithRetry(
    endpoint: WebhookEndpointConfig,
    event: string,
    payload: unknown
  ): Promise<WebhookDeliveryAttempt> {
    const maxRetries = endpoint.maxRetries ?? 3;
    let lastError: string | undefined;
    let lastStatus: number | undefined;

    const attemptId = `attempt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const startTime = Date.now();

    for (let retry = 1; retry <= maxRetries; retry++) {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-NexusFlow-Event": event,
          "X-NexusFlow-Delivery": attemptId,
          ...(endpoint.customHeaders ?? {})
        };

        if (endpoint.authType === "bearer" && endpoint.authToken) {
          headers["Authorization"] = `Bearer ${endpoint.authToken}`;
        } else if (endpoint.authType === "basic" && endpoint.authToken) {
          headers["Authorization"] = `Basic ${endpoint.authToken}`;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), endpoint.timeoutMs ?? 5000);

        const response = await this.fetchFn(endpoint.url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            event,
            timestamp: new Date().toISOString(),
            data: payload
          }),
          signal: controller.signal
        });

        clearTimeout(timer);
        lastStatus = response.status;

        if (response.ok) {
          return {
            id: attemptId,
            webhookId: endpoint.id,
            url: endpoint.url,
            event,
            attemptNumber: retry,
            status: "success",
            statusCode: response.status,
            timestamp: new Date(),
            durationMs: Date.now() - startTime
          };
        }

        lastError = `HTTP ${response.status}: ${response.statusText}`;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    return {
      id: attemptId,
      webhookId: endpoint.id,
      url: endpoint.url,
      event,
      attemptNumber: maxRetries,
      status: "failure",
      ...(lastStatus !== undefined ? { statusCode: lastStatus } : {}),
      error: lastError,
      timestamp: new Date(),
      durationMs: Date.now() - startTime
    };
  }

  private recordAttempt(attempt: WebhookDeliveryAttempt): void {
    this.deliveryHistory.push(attempt);
    if (this.deliveryHistory.length > this.maxHistory) {
      this.deliveryHistory.shift();
    }
  }
}

export const globalWebhookDispatcher = new WebhookDispatcher();
