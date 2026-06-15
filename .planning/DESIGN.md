# DESIGN — Aquavoy

> Reverse-engineered from the SHIPPED design system (`src/app/globals.css`). This documents what exists; new work conforms to it. Do NOT replace the aesthetic — extend it.

## §1 Direction Commit

1. **Aesthetic direction:** terminal-native operations console with a maritime skin — dark, instrument-panel calm, monospace metadata.
2. **Color strategy:** Committed — single teal accent (hue 192) over a deep-ocean neutral ground (hue 220), restrained use; danger/success only where semantic.
3. **Scene sentence:** Wency at a desk in a small Dutch shipping office, late afternoon, one monitor, running the company's files and mailboxes by talking to a calm dark-themed console.
4. **Differentiation:** the dark-ocean ground with a faint "light from above" radial gradient and sonar-sweep skeletons — it reads like a vessel instrument panel, not a web app.

## §2 Color (OKLCH — as shipped)

Ground/neutrals tinted toward ocean hue 220; accent teal hue 192.

| Token | Value |
|---|---|
| `--bg` | `oklch(0.14 0.015 220)` |
| `--bg-subtle` | `oklch(0.12 0.012 220)` |
| `--surface` / `--surface-2` / `--surface-3` | `oklch(0.19 / 0.24 / 0.28 …220)` |
| `--border` / `--border-subtle` | `oklch(0.30 / 0.24 …220)` |
| `--text` / `--text-dim` / `--text-muted` | `oklch(0.93 / 0.62 / 0.48 …220)` |
| `--accent` / `--accent-hover` | `oklch(0.72 0.14 192)` / `oklch(0.66 …)` |
| `--danger` | `oklch(0.66 0.17 25)` |
| `--success` | `oklch(0.72 0.14 160)` |

No `#000`/`#fff` anywhere. Body uses a radial "depth-of-water" gradient from the top.

## §3 Typography

- **Display/body:** Instrument Sans (400/500/600/700) — `--font-sans`
- **Mono (metadata, tags, timestamps, labels):** JetBrains Mono (400/500/600) — `--font-mono`
- Fluid base: `clamp(0.9375rem, 0.875rem + 0.25vw, 1rem)`; headings `clamp()` scaled; tight letter-spacing on headings (`-0.02…-0.03em`).
- **Never** swap to Inter/Roboto/Arial/system-ui as the primary.

## §4 Spacing

8px grid via `--sp-1`..`--sp-8` (4px→64px). Page padding fluid: `clamp(1rem, 3vw, 3.5rem)`. Radius scale: `--radius-sm 6px` / `--radius 8px` / `--radius-lg 12px`.

## §5 Components (token-driven, shipped)

`.btn` (+ `.ghost` `.danger` `.sm`), `.list`/`.item`, `.panel`/`.panel-h`, `.bubble` (chat), `.composer`, `.history-*`, `.badge` (ok/muted/err), `.notice` (err/ok), `.crew-item`, `.pick-btn` (identity gate), inputs. All 44px+ touch targets.

## §6 Depth

Shadow used sparingly — `pick-btn` hover `0 8px 24px oklch(0 0 0 / 0.3)`; gate logo glow in teal. Elevation mostly via surface-step (`surface` → `surface-2` → `surface-3`), not heavy shadows.

## §7 Motion

`--ease-out: cubic-bezier(0.22, 1, 0.36, 1)`; fast 150ms / base 200ms. Named animations: `bubble-in`, `history-slide`, `sonar-sweep` (skeletons), `spin`, `dot-pulse` (typing), `gate-logo-in`. No bounce. `prefers-reduced-motion` fully respected.

## §8 Iconography

Inline/emoji-light; no icon-font dependency. Keep single-family if icons are added.

## §9 Responsive

Mobile-first; breakpoints at 640px / 641px / 720px. Nav collapses labels to short forms; `.item` grid drops a column; chat goes full-width; prep grid stacks.

## §10 Anti-pattern checklist

- [ ] No `#000`/`#fff` — use OKLCH tokens
- [ ] No Inter/Roboto/Arial/system-ui as primary font
- [ ] No gray shadows — tint toward hue 220/192
- [ ] Metadata/timestamps in JetBrains Mono, not sans
- [ ] All interactive targets ≥ 44px
- [ ] `prefers-reduced-motion` honored on any new animation
- [ ] New surfaces use the surface-step tokens, not ad-hoc lightness
