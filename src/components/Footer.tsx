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
            <img src="/logo.png" alt="" className="footer-logo-img" aria-hidden="true" />
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
