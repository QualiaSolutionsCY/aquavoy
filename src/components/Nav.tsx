"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, User, Menu, X } from "lucide-react";

const LINKS = [
  { href: "/", label: "Chat" },
  { href: "/emails", label: "Emails" },
  { href: "/files", label: "Files" },
  { href: "/finance", label: "Finance" },
  { href: "/tasks", label: "Tasks" },
] as const;

export default function Nav() {
  const pathname = usePathname();
  const [principal, setPrincipal] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [open, setOpen] = useState(false);

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

  // Esc dismisses the open drawer; lock body scroll while it's open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {
      // Even if the request fails, send the operator to the login gate.
    }
    window.location.href = "/login";
  }

  const links = LINKS.map(({ href, label }) => {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        className="nav-link"
        aria-current={active ? "page" : undefined}
        // Close the mobile drawer on navigation (no-op on the desktop rail).
        onClick={() => setOpen(false)}
      >
        <span className="nav-link-label">{label}</span>
      </Link>
    );
  });

  const identity = principal && (
    <div className="nav-footer">
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
    </div>
  );

  return (
    <>
      {/* Mobile top bar — burger opens the drawer. Hidden on desktop. */}
      <header className="nav-topbar">
        <button
          type="button"
          className="nav-burger"
          aria-label="Open navigation menu"
          aria-expanded={open}
          aria-controls="nav-drawer"
          onClick={() => setOpen(true)}
        >
          <Menu size={20} strokeWidth={2} aria-hidden="true" />
        </button>
        <Link href="/" className="nav-brand" aria-label="Aquavoy home">
          <img src="/logo.png" alt="" className="nav-logo-img" aria-hidden="true" />
          <span className="nav-wordmark">Aquavoy</span>
        </Link>
      </header>

      {/* Desktop left rail — persistent vertical sidebar. */}
      <nav className="nav-rail" aria-label="Main navigation">
        <Link href="/" className="nav-brand" aria-label="Aquavoy home">
          <img src="/logo.png" alt="" className="nav-logo-img" aria-hidden="true" />
          <span className="nav-wordmark">Aquavoy</span>
        </Link>
        <div className="nav-links">{links}</div>
        {identity}
      </nav>

      {/* Mobile slide-in drawer + scrim. */}
      <div
        className={`nav-scrim${open ? " open" : ""}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <nav
        id="nav-drawer"
        className={`nav-drawer${open ? " open" : ""}`}
        aria-label="Main navigation"
        aria-hidden={!open}
      >
        <div className="nav-drawer-head">
          <Link
            href="/"
            className="nav-brand"
            aria-label="Aquavoy home"
            onClick={() => setOpen(false)}
          >
            <img src="/logo.png" alt="" className="nav-logo-img" aria-hidden="true" />
            <span className="nav-wordmark">Aquavoy</span>
          </Link>
          <button
            type="button"
            className="nav-burger nav-burger-close"
            aria-label="Close navigation menu"
            onClick={() => setOpen(false)}
          >
            <X size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <div className="nav-links">{links}</div>
        {identity}
      </nav>
    </>
  );
}
