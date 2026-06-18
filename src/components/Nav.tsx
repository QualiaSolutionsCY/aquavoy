"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, User } from "lucide-react";

const LINKS = [
  { href: "/", label: "Chat", short: "Chat" },
  { href: "/emails", label: "Emails", short: "Mail" },
  { href: "/files", label: "Files", short: "Files" },
  { href: "/prep", label: "Prep", short: "Prep" },
] as const;

export default function Nav() {
  const pathname = usePathname();
  const [principal, setPrincipal] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Surface who is signed in (and enable sign-out) — null on the login page.
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j?.ok && j.data?.principal) setPrincipal(j.data.principal as string);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname]);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {
      // Even if the request fails, send the operator to the login gate.
    }
    window.location.href = "/login";
  }

  return (
    <nav className="nav" aria-label="Main navigation">
      <div className="nav-inner">
        <Link href="/" className="nav-brand" aria-label="Aquavoy home">
          <img src="/logo.png" alt="" className="nav-logo-img" aria-hidden="true" />
          <span className="nav-wordmark">Aquavoy</span>
        </Link>
        <div className="nav-links">
          {LINKS.map(({ href, label, short }) => {
            const active =
              href === "/"
                ? pathname === "/"
                : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className="nav-link"
                aria-current={active ? "page" : undefined}
              >
                <span className="nav-link-label">{label}</span>
                <span className="nav-link-short">{short}</span>
              </Link>
            );
          })}

          {principal && (
            <>
              <span className="nav-who" title={`Signed in as ${principal}`}>
                <User size={15} strokeWidth={1.75} aria-hidden="true" />
                <span className="nav-who-name">{principal}</span>
              </span>
              <button
                type="button"
                className="nav-link nav-logout"
                onClick={signOut}
                disabled={signingOut}
                aria-label={`Sign out ${principal}`}
              >
                <LogOut size={15} strokeWidth={1.75} aria-hidden="true" />
                <span className="nav-link-label">{signingOut ? "Signing out…" : "Sign out"}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
