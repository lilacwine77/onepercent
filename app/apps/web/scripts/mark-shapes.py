"""The 1% mark as shapes, for styles.css --shape-mark and --shape-wordmark.

    python3 app/apps/web/scripts/mark-shapes.py

The pre-boot shell (index.html .boot) and the route mark (.route-loading) draw the
mark as a CSS mask, never as text: a shape does not count as the page's first
contentful paint, so it can show before the app boots without moving FCP, LCP or
blocking time (scripts/lcp.mjs). The outlines are Fraunces 700, laid out exactly as
the text is (tracking -0.11em after each glyph, the baseline from the line box), in
a box that also holds the ink that overflows it. Prints the two custom properties
and the box of each: width, height and the layout centre to rotate about, in em.
Needs fontTools (WOFF 1, no Brotli).
"""
import os
from urllib.parse import quote

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(
    HERE, "../node_modules/@fontsource/fraunces/files/fraunces-latin-700-normal.woff"
)
EM = 1000.0
TRACKING = -0.11


def number(value):
    return ("%.1f" % value).rstrip("0").rstrip(".")


def shape(font, percent_scale, line_height):
    glyphs, cmap, metrics = font.getGlyphSet(), font.getBestCmap(), font["hmtx"]
    upem = font["head"].unitsPerEm
    ascent, descent = font["OS/2"].sTypoAscender, -font["OS/2"].sTypoDescender
    one, percent = cmap[ord("1")], cmap[ord("%")]
    s1, s2 = EM / upem, percent_scale * EM / upem
    track = TRACKING * EM
    advance = metrics[one][0] * s1
    width = advance + track + metrics[percent][0] * s2 + track
    height = line_height * EM
    baseline = (height - (ascent + descent) * s1) / 2 + ascent * s1
    placed = ((one, (s1, 0, 0, -s1, 0, baseline)), (percent, (s2, 0, 0, -s2, advance + track, baseline)))
    bounds = BoundsPen(glyphs)
    for glyph, transform in placed:
        glyphs[glyph].draw(TransformPen(bounds, transform))
    ink = bounds.bounds
    room = 4.0
    x0, y0 = min(0, ink[0] - room), min(0, ink[1] - room)
    x1, y1 = max(width, ink[2] + room), max(height, ink[3] + room)
    pen = SVGPathPen(glyphs, ntos=number)
    for glyph, transform in placed:
        glyphs[glyph].draw(TransformPen(pen, transform))
    box = f"{number(x0)} {number(y0)} {number(x1 - x0)} {number(y1 - y0)}"
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}"><path d="{pen.getCommands()}"/></svg>'
    uri = ("data:image/svg+xml," + quote(svg, safe=" /=:,.-'")).replace('"', "'")
    em = lambda value: round(value / EM, 4)
    return uri, em(x1 - x0), em(y1 - y0), em(width / 2 - x0), em(height / 2 - y0)


font = TTFont(FONT)
for name, percent_scale, line_height in (("mark", 1.0, 0.85), ("wordmark", 0.8, 1.0)):
    uri, width, height, origin_x, origin_y = shape(font, percent_scale, line_height)
    print(f"/* {name}: {width}em x {height}em, layout centre {origin_x}em {origin_y}em */")
    print(f'--shape-{name}: url("{uri}");')
