#!/usr/bin/env python3
"""WCAG contrast gate for the blockwatch palette.

Checks every text token against every surface it can appear on, for the base
palette and for each chain theme.

Why the chain themes matter: `blockwatch.css` overrides --orange and --amber
per chain (`html.chain-regtest` and friends). The previous version parsed only
:root, so those palettes were never checked — and the regtest accent was
failing AA on three of four surfaces the whole time.

Translucent surfaces (--odim, --osoft) are composited over the opaque surface
beneath them before checking, because that is what a reader actually sees. They
are checked only against the foregrounds the stylesheet actually pairs them
with — see WASH_TEXT.

Exit codes: 0 pass, 1 contrast failure, 2 the palette could not be parsed.
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CSS = open(os.path.join(HERE, "..", "blockwatch.css")).read()

AA_NORMAL = 4.5   # WCAG 2.1 AA, text under 18.66px bold / 24px
AA_LARGE = 3.0    # large text, and non-text UI components (1.4.11)

# Opaque surfaces a reader can find text on.
SURFACES = ["void", "ink", "surface", "raised"]
# Foreground tokens used as text.
TEXT = ["t1", "t2", "t3", "t4", "orange", "amber", "grn", "neg", "grn2"]
# Translucent accent backgrounds, and the foregrounds actually placed on them.
#
# Deliberately not a cross-product. Every rule in blockwatch.css that paints a
# wash as a background was enumerated, and the opaque surface beneath each was
# resolved from its container, giving the three cases below. A cross-product
# would report failures for combinations the product cannot render, and a gate
# whose output is mostly impossible gets ignored — which is worse than no gate.
#
# Re-derive the rule list with:
#   grep -nE 'background:\s*var\(--o(dim|soft)\)' blockwatch.css
#
# (wash, opaque surface beneath, foregrounds) — with the rules each row covers:
WASH_CASES = [
    # `.term-entry.term-hit-active` paints --odim behind a whole terminal entry
    # and sets no colour, so the entry keeps its own tones — and terminal output
    # uses every token in TEXT. This row is why the wash checks cannot be
    # narrowed to the accent colours. The drawer is rgba(10,10,10,.82) over
    # --void rather than --ink exactly; --ink is the lighter of the two and so
    # the more conservative stand-in.
    # Also: .tb-ver-badge, .tb-sound-badge.sound-on (#titlebar is #0e0e0e),
    # .ph-badge, .snapshot-btn (.ph is --ink), .pd-header-net.net-onion,
    # .pd-badge-dir-out, .pd-svc span.svc-core (.pd-header/.pd-body are --ink),
    # .fork-badge.locked, .bd-fill-badge.bd-fill-med, .peer-badge-out,
    # .peer-badge-onion (panel body), .term-node-alt, .term-cand-active.
    ("odim", "ink", TEXT),
    # `.fork-badge.signal` is the only wash rule using --amber, and it renders in
    # a panel body. Covered by the row above, which includes amber.

    # A peer badge in a hovered (`.tbl tr:hover td`) or selected (`.peer-sel td`)
    # row sits on --surface instead. Those badges are --orange only.
    ("odim", "surface", ["orange"]),

    # `.snapshot-btn:hover` is the only rule that paints --osoft at all, and it
    # lives in a panel header (--ink).
    ("osoft", "ink", ["orange"]),
]

HEX = re.compile(r"--([\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*[;}]")
RGBA = re.compile(r"--([\w-]+):\s*rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)")


def parse_hex(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) == 8:      # #rrggbbaa
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), int(h[6:8], 16) / 255)
    if len(h) != 6:
        raise ValueError("unparseable hex: #" + h)
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 1.0)


def parse_block(text):
    """Every colour token in a declaration block, as (r, g, b, a)."""
    out = {}
    for name, val in HEX.findall(text):
        try:
            out[name] = parse_hex(val)
        except ValueError:
            out[name] = None          # recorded, so it cannot silently vanish
    for name, r, g, b, a in RGBA.findall(text):
        out[name] = (float(r), float(g), float(b), float(a) if a else 1.0)
    return out


def block(selector):
    """The body of the first `selector { ... }` rule."""
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", CSS)
    return m.group(1) if m else None


def over(fg, bg):
    """Composite a possibly-translucent colour over an opaque one."""
    a = fg[3]
    return tuple(round(bg[i] + a * (fg[i] - bg[i])) for i in range(3)) + (1.0,)


def lin(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(c):
    return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])


def ratio(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def hexstr(c):
    return "#%02x%02x%02x" % (c[0], c[1], c[2])


root_body = block(":root")
if root_body is None:
    print("CONTRAST GATE: could not find the :root block in blockwatch.css")
    sys.exit(2)
base = parse_block(root_body)

# Refuse to run on a palette we cannot fully read. Silently skipping a token
# would let a token be renamed and the gate keep reporting PASS.
required = set(TEXT) | set(SURFACES)
missing = sorted(t for t in required if t not in base)
unparsed = sorted(t for t in required if base.get(t, "sentinel") is None)
if missing or unparsed:
    if missing:
        print("CONTRAST GATE: tokens missing from :root — " + ", ".join(missing))
    if unparsed:
        print("CONTRAST GATE: tokens present but unparseable — " + ", ".join(unparsed))
    sys.exit(2)

# Each chain theme is the base palette with its own overrides applied.
themes = {"base (mainnet)": base}
for m in re.finditer(r"html\.(chain-[\w-]+)\s*\{([^}]*)\}", CSS):
    name, body = m.group(1), m.group(2)
    over_tokens = {k: v for k, v in parse_block(body).items() if v is not None}
    if over_tokens:
        merged = dict(base)
        merged.update(over_tokens)
        themes[name] = merged

failures = []
checked = 0
for theme_name, tok in themes.items():
    for t in TEXT:
        for s in SURFACES:
            checked += 1
            r = ratio(tok[t], tok[s])
            if r < AA_NORMAL:
                failures.append((theme_name, t, hexstr(tok[t]), s, hexstr(tok[s]), round(r, 2)))
    for w, base, fgs in WASH_CASES:
        if not tok.get(w):
            continue
        bg = over(tok[w], tok[base])
        for t in fgs:
            checked += 1
            r = ratio(tok[t], bg)
            if r < AA_NORMAL:
                failures.append((theme_name, t, hexstr(tok[t]),
                                 f"{w} on {base}", hexstr(bg), round(r, 2)))

if failures:
    print(f"CONTRAST GATE: FAIL — {len(failures)} of {checked} combinations below AA ({AA_NORMAL}:1)\n")
    width = max(len(f[0]) for f in failures)
    for theme, t, fg, bg_name, bg, r in failures:
        print(f"  {theme:<{width}}  --{t:<7} {fg}  on {bg_name:<18} {bg}   {r}")
    print(f"\n  Large text and non-text UI components are held to {AA_LARGE}:1 by WCAG,")
    print("  but every token here is used for body-sized text somewhere, so all are")
    print(f"  held to {AA_NORMAL}:1.")
    sys.exit(1)

print(f"CONTRAST GATE: PASS — {checked} combinations across {len(themes)} themes "
      f"({', '.join(themes)}) all >= {AA_NORMAL}:1")
sys.exit(0)
