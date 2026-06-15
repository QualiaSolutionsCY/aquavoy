import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MailAccountWithSecret } from "./accounts";

/**
 * Seam test for the SMTP send adapter. nodemailer is the only external
 * dependency and is fully mocked — no socket opens. Asserts the From header is
 * built from displayName + email and that sendMail forwards to/subject/body.
 */
const { sendMailMock, verifyMock, closeMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn(
    async (_opts: unknown): Promise<unknown> => ({ messageId: "<id@aquavoy>" }),
  );
  const verifyMock = vi.fn(async () => true);
  const closeMock = vi.fn();
  const createTransportMock = vi.fn(() => ({
    sendMail: sendMailMock,
    verify: verifyMock,
    close: closeMock,
  }));
  return { sendMailMock, verifyMock, closeMock, createTransportMock };
});

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

import { sendMail, verifySmtp } from "./smtp";

const account: MailAccountWithSecret = {
  id: "acct-1",
  email: "info@aquavoy.com",
  displayName: "Aquavoy Shipping",
  smtpHost: "smtp.aquavoy.com",
  smtpPort: 465,
  imapHost: null,
  imapPort: null,
  username: "info@aquavoy.com",
  password: "decrypted-secret",
  verifiedAt: null,
};

describe("mail/smtp send adapter", () => {
  beforeEach(() => {
    sendMailMock.mockClear();
    verifyMock.mockClear();
    closeMock.mockClear();
    createTransportMock.mockClear();
  });

  it("sendMail builds the From header and forwards to/subject/text", async () => {
    await sendMail({ account, to: "client@example.com", subject: "Invoice", body: "Hi there" });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = sendMailMock.mock.calls[0][0] as {
      from: string;
      to: string;
      subject: string;
      text: string;
      html: string;
    };
    expect(call.from).toBe('"Aquavoy Shipping" <info@aquavoy.com>');
    expect(call.to).toBe("client@example.com");
    expect(call.subject).toBe("Invoice");
    expect(call.text).toBe("Hi there");
    expect(call.html).toContain("<p>");
    expect(closeMock).toHaveBeenCalled();
  });

  it("sendMail wraps transport failure in a readable error and still closes", async () => {
    sendMailMock.mockRejectedValueOnce(new Error("550 mailbox unavailable"));
    await expect(
      sendMail({ account, to: "x@example.com", subject: "s", body: "b" }),
    ).rejects.toThrow(/Failed to send email: 550 mailbox unavailable/);
    expect(closeMock).toHaveBeenCalled();
  });

  it("verifySmtp runs the handshake and closes the transport", async () => {
    await verifySmtp({
      host: "smtp.aquavoy.com",
      port: 587,
      username: "info@aquavoy.com",
      password: "secret",
    });
    expect(verifyMock).toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalled();
  });
});
