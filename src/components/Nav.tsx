"use client";

import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Chat", short: "Chat" },
  { href: "/emails", label: "Emails", short: "Mail" },
  { href: "/files", label: "Files", short: "Files" },
  { href: "/prep", label: "Prep", short: "Prep" },
] as const;

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="nav" aria-label="Main navigation">
      <div className="nav-inner">
        <a href="/" className="nav-brand" aria-label="Aquavoy home">
          <img src="/logo.png" alt="" className="nav-logo-img" aria-hidden="true" />
          <span className="nav-wordmark">Aquavoy</span>
        </a>
        <div className="nav-links">
          {LINKS.map(({ href, label, short }) => {
            const active =
              href === "/"
                ? pathname === "/"
                : pathname.startsWith(href);
            return (
              <a
                key={href}
                href={href}
                className="nav-link"
                aria-current={active ? "page" : undefined}
              >
                <span className="nav-link-label">{label}</span>
                <span className="nav-link-short">{short}</span>
              </a>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
