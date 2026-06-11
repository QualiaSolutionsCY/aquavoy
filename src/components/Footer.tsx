"use client";

import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Chat" },
  { href: "/emails", label: "Emails" },
  { href: "/files", label: "Files" },
  { href: "/prep", label: "Prep" },
] as const;

export default function Footer() {
  const pathname = usePathname();
  // Chat is a full-height immersive surface — it carries its own inline credit.
  if (pathname === "/") return null;

  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <span className="footer-wordmark">
            <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path
                d="M8 2L3 8.5C3 11.26 5.24 13.5 8 13.5C10.76 13.5 13 11.26 13 8.5L8 2Z"
                fill="currentColor"
              />
            </svg>
            Aquavoy
          </span>
          <span className="footer-tag">Aquavoy &middot; Faial BV — Inland Waterway Operations</span>
        </div>
        <nav className="footer-links" aria-label="Footer navigation">
          {LINKS.map(({ href, label }) => (
            <a key={href} href={href}>
              {label}
            </a>
          ))}
        </nav>
        <a
          className="footer-credit"
          href="https://qualiasolutions.net"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by <strong>Qualia Solutions</strong>
        </a>
      </div>
    </footer>
  );
}
