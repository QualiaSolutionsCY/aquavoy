/** Single source of truth for company mailboxes, domain groups, and default server settings. */

export interface Mailbox {
  address: string;
  group: "aquavoy.com" | "faialbv.com";
}

/** Default IMAP/SMTP server settings per domain (DNS + port probes verified). */
export interface DomainDefaults {
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
}

export const DOMAIN_DEFAULTS: Record<Mailbox["group"], DomainDefaults> = {
  "aquavoy.com": {
    smtpHost: "mail.aquavoy.com",
    smtpPort: 465,
    imapHost: "mail.aquavoy.com",
    imapPort: 993,
  },
  "faialbv.com": {
    smtpHost: "mail.faialbv.com",
    smtpPort: 465,
    imapHost: "mail.faialbv.com",
    imapPort: 993,
  },
};

export const MAILBOXES: Mailbox[] = [
  // aquavoy.com
  { address: "info@aquavoy.com", group: "aquavoy.com" },
  { address: "admin@aquavoy.com", group: "aquavoy.com" },
  { address: "wdr@aquavoy.com", group: "aquavoy.com" },
  { address: "aquadonna@aquavoy.com", group: "aquavoy.com" },
  { address: "reizen@aquavoy.com", group: "aquavoy.com" },
  { address: "crewing@aquavoy.com", group: "aquavoy.com" },
  { address: "crew@aquavoy.com", group: "aquavoy.com" },

  // faialbv.com
  { address: "info@faialbv.com", group: "faialbv.com" },
  { address: "administratie@faialbv.com", group: "faialbv.com" },
  { address: "prideoffaial@faialbv.com", group: "faialbv.com" },
  { address: "hr@faialbv.com", group: "faialbv.com" },
  { address: "crew@faialbv.com", group: "faialbv.com" },
];

export const GROUPS = ["aquavoy.com", "faialbv.com"] as const;
