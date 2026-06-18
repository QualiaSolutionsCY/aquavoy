import nodemailer from "nodemailer";
import type { MailAccountWithSecret } from "./accounts";

/**
 * Adapter over nodemailer — the ONLY file in the project that imports it.
 * Two public functions: verifySmtp (connection test) and sendMail (send).
 */
// ADR-004: authoritative stack for this operation — IMAP/SMTP owns company mailboxes

interface SmtpCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
}

function createTransport(creds: SmtpCredentials) {
  const secure = creds.port === 465;
  return nodemailer.createTransport({
    host: creds.host,
    port: creds.port,
    secure,
    ...(!secure && { requireTLS: true }),
    auth: { user: creds.username, pass: creds.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  });
}

/**
 * Verify SMTP credentials by opening a connection and running the SMTP
 * handshake + auth. Throws a readable error on failure.
 */
export async function verifySmtp(creds: SmtpCredentials): Promise<void> {
  const transport = createTransport(creds);
  try {
    await transport.verify();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/auth|login|credentials|password/i.test(message)) {
      throw new Error(`SMTP authentication failed: ${message}`);
    }
    if (/connect|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH/i.test(message)) {
      throw new Error(`SMTP connection failed (${creds.host}:${creds.port}): ${message}`);
    }
    throw new Error(`SMTP verification failed: ${message}`);
  } finally {
    transport.close();
  }
}

interface SendMailOptions {
  account: MailAccountWithSecret;
  to: string;
  subject: string;
  body: string;
}

/** Send an email. `body` is treated as plain text; a simple HTML version is also attached. */
export async function sendMail({ account, to, subject, body }: SendMailOptions): Promise<void> {
  const transport = createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    username: account.username,
    password: account.password,
  });
  const from = `"${account.displayName ?? account.email}" <${account.email}>`;
  const html = body
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  try {
    await transport.sendMail({ from, to, subject, text: body, html });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to send email: ${message}`);
  } finally {
    transport.close();
  }
}
