import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ThresholdAlertEvent } from "../streams/operators.js";
import { WebhookDispatcher, type WebhookEndpointConfig } from "../streams/webhook.js";

describe("Webhook & Alert Notification Dispatcher (Member 3 - Week 4)", () => {
  const dummyAlert: ThresholdAlertEvent = {
    ruleId: "temp-overheat-rule",
    deviceId: "boiler-03",
    metric: "temperature",
    value: 195.5,
    threshold: 180,
    comparator: "gt",
    severity: "critical",
    timestamp: new Date(),
    location: "boiler-room-1"
  };

  it("registers and retrieves webhook endpoints correctly", () => {
    const dispatcher = new WebhookDispatcher();
    const endpoint: WebhookEndpointConfig = {
      id: "ep-opsgenie",
      name: "OpsGenie High Priority",
      url: "https://api.opsgenie.com/v1/alerts",
      enabled: true,
      events: ["alert.critical"],
      authType: "bearer",
      authToken: "secret-key-123"
    };

    dispatcher.registerEndpoint(endpoint);
    const registered = dispatcher.getEndpoints();

    assert.equal(registered.length, 1);
    assert.equal(registered[0]?.id, "ep-opsgenie");
    assert.equal(registered[0]?.maxRetries, 3);
    assert.equal(registered[0]?.timeoutMs, 5000);

    const deleted = dispatcher.unregisterEndpoint("ep-opsgenie");
    assert.equal(deleted, true);
    assert.equal(dispatcher.getEndpoints().length, 0);
  });

  it("dispatches alerts to subscribed endpoints with headers and authentication", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";

    const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      capturedBody = String(init?.body);
      return new Response(JSON.stringify({ status: "received" }), { status: 200 });
    }) as typeof fetch;

    const dispatcher = new WebhookDispatcher({ fetchImpl: mockFetch });
    dispatcher.registerEndpoint({
      id: "ep-slack-webhook",
      name: "Slack Channel Alerts",
      url: "https://hooks.slack.com/services/T00/B00/X00",
      enabled: true,
      events: ["alert.critical", "alert.warning"],
      authType: "bearer",
      authToken: "xoxb-mock-token",
      customHeaders: {
        "X-Environment": "production"
      }
    });

    const result = await dispatcher.dispatchAlert(dummyAlert);

    assert.equal(result.totalConfigured, 1);
    assert.equal(result.dispatched, 1);
    assert.equal(result.successful, 1);
    assert.equal(result.failed, 0);
    assert.equal(capturedUrl, "https://hooks.slack.com/services/T00/B00/X00");
    assert.equal(capturedHeaders["Authorization"], "Bearer xoxb-mock-token");
    assert.equal(capturedHeaders["X-Environment"], "production");
    assert.equal(capturedHeaders["X-NexusFlow-Event"], "alert.critical");

    const parsedBody = JSON.parse(capturedBody);
    assert.equal(parsedBody.event, "alert.critical");
    assert.equal(parsedBody.data.deviceId, "boiler-03");
  });

  it("ignores endpoints not matching the event severity level or disabled endpoints", async () => {
    let callCount = 0;
    const mockFetch = (async () => {
      callCount++;
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const dispatcher = new WebhookDispatcher({ fetchImpl: mockFetch });
    dispatcher.registerEndpoint({
      id: "ep-info-only",
      name: "Info Notifications",
      url: "https://example.com/info",
      enabled: true,
      events: ["alert.info"] // does not match critical
    });
    dispatcher.registerEndpoint({
      id: "ep-disabled",
      name: "Disabled Webhook",
      url: "https://example.com/disabled",
      enabled: false,
      events: ["alert.critical"]
    });

    const result = await dispatcher.dispatchAlert(dummyAlert);
    assert.equal(result.dispatched, 0);
    assert.equal(result.successful, 0);
    assert.equal(callCount, 0);
  });

  it("retries failed requests up to maxRetries on HTTP errors", async () => {
    let attempts = 0;
    const mockFetch = (async () => {
      attempts++;
      if (attempts < 3) {
        return new Response("Service Unavailable", { status: 503, statusText: "Service Unavailable" });
      }
      return new Response("Accepted", { status: 202 });
    }) as typeof fetch;

    const dispatcher = new WebhookDispatcher({ fetchImpl: mockFetch });
    dispatcher.registerEndpoint({
      id: "ep-retry-test",
      name: "Retry Webhook",
      url: "https://api.flaky-service.com/webhook",
      enabled: true,
      events: ["alert.critical"],
      maxRetries: 3
    });

    const result = await dispatcher.dispatchAlert(dummyAlert);
    assert.equal(attempts, 3);
    assert.equal(result.successful, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.attempts[0]?.attemptNumber, 3);
    assert.equal(result.attempts[0]?.status, "success");
    assert.equal(result.attempts[0]?.statusCode, 202);
  });

  it("records delivery history and marks permanently failed attempts after exhausting retries", async () => {
    const mockFetch = (async () => {
      return new Response("Internal Server Error", { status: 500, statusText: "Server Error" });
    }) as typeof fetch;

    const dispatcher = new WebhookDispatcher({ maxHistory: 5, fetchImpl: mockFetch });
    dispatcher.registerEndpoint({
      id: "ep-fail-test",
      name: "Failing Webhook",
      url: "https://api.broken.com/webhook",
      enabled: true,
      events: ["alert.critical"],
      maxRetries: 2
    });

    const result = await dispatcher.dispatchAlert(dummyAlert);
    assert.equal(result.successful, 0);
    assert.equal(result.failed, 1);
    assert.equal(result.attempts[0]?.status, "failure");
    assert.equal(result.attempts[0]?.statusCode, 500);

    const history = dispatcher.getDeliveryHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0]?.webhookId, "ep-fail-test");
    assert.equal(history[0]?.status, "failure");
  });
});
