import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock web-push before importing the channel so the module-level require is intercepted.
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

// Mock env to control VAPID key presence per test.
vi.mock("@/lib/env", () => ({
  getVapidEnv: vi.fn(),
}));

import webpush from "web-push";
import { getVapidEnv } from "@/lib/env";
import { webPushChannel } from "./webpush";

const mockSetVapidDetails = vi.mocked(webpush.setVapidDetails);
const mockSendNotification = vi.mocked(webpush.sendNotification);
const mockGetVapidEnv = vi.mocked(getVapidEnv);

const FAKE_VAPID_ENV = {
  VAPID_PUBLIC_KEY: "fake-public-key",
  VAPID_PRIVATE_KEY: "fake-private-key",
  VAPID_SUBJECT: "mailto:test@aquavoy.com",
};

const FAKE_SUBSCRIPTION: PushSubscriptionJSON = {
  endpoint: "https://push.example.com/sub/abc",
  keys: {
    p256dh: "fake-p256dh",
    auth: "fake-auth",
  },
};

const FAKE_MESSAGE = { title: "Action ready", body: "A new action was staged", url: "/" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("webPushChannel.send()", () => {
  it("(a) maps a 410 rejection to { ok: false, expired: true }", async () => {
    mockGetVapidEnv.mockReturnValue(FAKE_VAPID_ENV);
    const err = Object.assign(new Error("Gone"), { statusCode: 410 });
    mockSendNotification.mockRejectedValue(err);

    const result = await webPushChannel.send("Wency", FAKE_MESSAGE, FAKE_SUBSCRIPTION);

    expect(result).toEqual({ ok: false, expired: true });
  });

  it("(a) maps a 404 rejection to { ok: false, expired: true }", async () => {
    mockGetVapidEnv.mockReturnValue(FAKE_VAPID_ENV);
    const err = Object.assign(new Error("Not Found"), { statusCode: 404 });
    mockSendNotification.mockRejectedValue(err);

    const result = await webPushChannel.send("Wency", FAKE_MESSAGE, FAKE_SUBSCRIPTION);

    expect(result).toEqual({ ok: false, expired: true });
  });

  it("(b) maps a generic rejection to { ok: false, error } and does NOT throw", async () => {
    mockGetVapidEnv.mockReturnValue(FAKE_VAPID_ENV);
    mockSendNotification.mockRejectedValue(new Error("Network failure"));

    // Must resolve — NEVER reject.
    await expect(
      webPushChannel.send("Wency", FAKE_MESSAGE, FAKE_SUBSCRIPTION),
    ).resolves.toMatchObject({ ok: false, error: "Network failure" });
  });

  it("(c) returns { ok: false } without calling sendNotification when VAPID keys are absent", async () => {
    mockGetVapidEnv.mockReturnValue(null);

    const result = await webPushChannel.send("Wency", FAKE_MESSAGE, FAKE_SUBSCRIPTION);

    expect(result.ok).toBe(false);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("returns { ok: true } on a successful send", async () => {
    mockGetVapidEnv.mockReturnValue(FAKE_VAPID_ENV);
    mockSendNotification.mockResolvedValue({} as never);

    const result = await webPushChannel.send("Jeanette", FAKE_MESSAGE, FAKE_SUBSCRIPTION);

    expect(result).toEqual({ ok: true });
    expect(mockSetVapidDetails).toHaveBeenCalledWith(
      FAKE_VAPID_ENV.VAPID_SUBJECT,
      FAKE_VAPID_ENV.VAPID_PUBLIC_KEY,
      FAKE_VAPID_ENV.VAPID_PRIVATE_KEY,
    );
  });
});
