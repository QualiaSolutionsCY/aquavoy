/** Single source of truth for company mailboxes and their domain groups. */

export interface Mailbox {
  address: string;
  group: "aquavoy.com" | "faialbv.com";
}

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
