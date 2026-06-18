"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Mail } from "lucide-react";

/**
 * Email-address autocomplete for the chat composer. A *controlled* text input
 * that, as the operator types an address-like token, debounces a fetch to
 * GET /api/recipients?q= and surfaces up to MAX_RESULTS matches (crew rows
 * UNION the company mailboxes, deduped server-side). The dropdown is keyboard
 * navigable (Arrow keys / Enter / Escape); choosing a row calls onSelect with
 * the full email so the caller can insert it.
 *
 * Self-contained — styled with styled-jsx (no globals.css), reusing the app's
 * design tokens so it blends with the surrounding surface.
 */

const MAX_RESULTS = 6;
const DEBOUNCE_MS = 150;

/** Mirrors the GET /api/recipients suggestion shape (id is null for mailboxes). */
interface Suggestion {
  id: string | null;
  name: string;
  email: string;
  role: string | null;
  notes: string | null;
}

/** Trigger only on an address-like token: a run of address-legal characters,
 *  optionally already containing an `@`. Two chars minimum keeps noise down. */
function looksLikeAddress(token: string): boolean {
  return /^[A-Za-z0-9._%+-]{2,}(?:@[A-Za-z0-9.-]*)?$/.test(token);
}

export interface RecipientAutocompleteProps {
  /** Controlled value of the input. */
  value: string;
  /** Called on every keystroke with the new raw value. */
  onChange: (value: string) => void;
  /** Called with the chosen full email address when a suggestion is picked. */
  onSelect: (email: string) => void;
  placeholder?: string;
  /** Forwarded to the input — e.g. a composer-wide aria-label. */
  ariaLabel?: string;
  disabled?: boolean;
}

export default function RecipientAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "name@aquavoy.com",
  ariaLabel = "Recipient email",
  disabled = false,
}: RecipientAutocompleteProps) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  // Debounced search on the trailing address-like token of the current value.
  // All state writes happen asynchronously (in the timeout callback) so this
  // never sets state synchronously in the effect body.
  useEffect(() => {
    const token = value.trim().split(/\s+/).pop() ?? "";
    const myReq = ++reqId.current;
    const handle = setTimeout(async () => {
      // Not an address-like token (or disabled) → collapse the dropdown.
      if (disabled || !looksLikeAddress(token)) {
        if (myReq !== reqId.current) return;
        setItems([]);
        setOpen(false);
        setActive(-1);
        return;
      }
      try {
        const res = await fetch(`/api/recipients?q=${encodeURIComponent(token)}`);
        const json = await res.json();
        // Ignore stale responses — only the latest keystroke's result wins.
        if (myReq !== reqId.current) return;
        const data: Suggestion[] = json?.ok && Array.isArray(json.data) ? json.data : [];
        const next = data.slice(0, MAX_RESULTS);
        setItems(next);
        setOpen(next.length > 0);
        setActive(next.length > 0 ? 0 : -1);
      } catch {
        if (myReq !== reqId.current) return;
        setItems([]);
        setOpen(false);
        setActive(-1);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [value, disabled]);

  // Close when focus/click leaves the component.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActive(-1);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function choose(item: Suggestion) {
    onSelect(item.email);
    setItems([]);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || items.length === 0) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => (i + 1) % items.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => (i - 1 + items.length) % items.length);
        break;
      case "Enter":
        if (active >= 0 && active < items.length) {
          e.preventDefault();
          choose(items[active]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setActive(-1);
        break;
      default:
        break;
    }
  }

  const activeId = open && active >= 0 ? optionId(active) : undefined;

  return (
    <div className="ra-root" ref={rootRef}>
      <span className="ra-icon" aria-hidden="true">
        <Mail size={15} strokeWidth={1.75} />
      </span>
      <input
        type="text"
        className="ra-input"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (items.length > 0) setOpen(true);
        }}
      />
      {open && items.length > 0 && (
        <ul className="ra-list" id={listId} role="listbox" aria-label="Email suggestions">
          {items.map((item, i) => (
            <li
              key={`${item.email}-${i}`}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className={`ra-option${i === active ? " active" : ""}`}
              // Pointer down (not click) so the input's blur doesn't beat the pick.
              onPointerDown={(e) => {
                e.preventDefault();
                choose(item);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="ra-name">{item.name}</span>
              <span className="ra-email">{item.email}</span>
            </li>
          ))}
        </ul>
      )}

      <style jsx>{`
        .ra-root {
          position: relative;
          display: flex;
          align-items: center;
          gap: var(--sp-2);
          width: 100%;
          padding: 0 var(--sp-3);
          background: var(--surface-2);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
        }
        .ra-root:focus-within {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-glow);
        }
        .ra-icon {
          display: inline-flex;
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .ra-input {
          flex: 1;
          min-width: 0;
          padding: var(--sp-3) 0;
          background: transparent;
          border: none;
          outline: none;
          color: var(--text);
          font: inherit;
          font-size: 0.9375rem;
        }
        .ra-input::placeholder {
          color: var(--text-muted);
        }
        .ra-input:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }
        .ra-list {
          position: absolute;
          left: 0;
          right: 0;
          bottom: calc(100% + var(--sp-2));
          z-index: 40;
          margin: 0;
          padding: var(--sp-1);
          list-style: none;
          background: var(--surface-3);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          box-shadow: var(--shadow-2);
          max-height: 16rem;
          overflow-y: auto;
        }
        .ra-option {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          padding: var(--sp-2) var(--sp-3);
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: background var(--transition-fast);
        }
        .ra-option.active,
        .ra-option:hover {
          background: var(--accent-subtle);
        }
        .ra-name {
          color: var(--text);
          font-size: 0.875rem;
          font-weight: 500;
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ra-email {
          color: var(--text-muted);
          font-size: 0.8125rem;
          font-family: var(--font-mono, monospace);
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}</style>
    </div>
  );
}
