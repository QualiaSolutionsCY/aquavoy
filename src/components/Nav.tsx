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
          <span className="nav-logo" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M8 2L3 8.5C3 11.26 5.24 13.5 8 13.5C10.76 13.5 13 11.26 13 8.5L8 2Z"
                fill="currentColor"
              />
            </svg>
          </span>
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
