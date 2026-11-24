#!/usr/bin/env python3
"""Build app/data/map.json: a small map of the Yellow River and Yangtze region for About.

One-time step. Reads Natural Earth (public domain) 1:50m land and river
GeoJSON and writes simplified SVG path data in a fixed projection, plus the
projection, so the app can place points by longitude and latitude.

Usage: python3 scripts/build-map.py <dir with ne_50m_land.geojson and ne_50m_rivers_lake_centerlines.geojson>
Data: https://github.com/nvkelso/natural-earth-vector (public domain).
"""
import json, math, sys
from pathlib import Path

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / 'app' / 'data' / 'map.json'
W0, E0, S0, N0 = 102.0, 123.5, 25.5, 41.5   # lon/lat window shown
LAT0 = 33.5                                   # equirectangular, scaled at this latitude
K = math.cos(math.radians(LAT0))
SCALE = 40                                    # px per degree of latitude
TOL = 0.06                                    # simplification tolerance, degrees
RIVERS = {'Huang': 'Yellow River', 'Chang Jiang': 'Yangtze', 'Yangtze': 'Yangtze', 'Han': 'Han River'}


def proj(lon, lat):
    return round((lon - W0) * K * SCALE, 1), round((N0 - lat) * SCALE, 1)


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        x0, y0 = pts[i]
        num = abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1)
        den = math.hypot(y2 - y1, x2 - x1) or 1e-9
        d = num / den
        if d > dmax:
            dmax, idx = d, i
    if dmax <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[: idx + 1], tol)[:-1] + simplify(pts[idx:], tol)


def simplify_ring(ring, tol):
    # A closed ring starts and ends at the same point, so split it at the vertex
    # farthest from the start and simplify the two halves.
    x0, y0 = ring[0]
    far = max(range(len(ring)), key=lambda i: (ring[i][0] - x0) ** 2 + (ring[i][1] - y0) ** 2)
    if far == 0:
        return ring
    return simplify(ring[: far + 1], tol)[:-1] + simplify(ring[far:], tol)


def clamp(lon, lat, m=1.5):
    return min(max(lon, W0 - m), E0 + m), min(max(lat, S0 - m), N0 + m)


def near(ring, m=1.5):
    return any(W0 - m < x < E0 + m and S0 - m < y < N0 + m for x, y in ring)


def path(rings, close):
    out = []
    for r in rings:
        pts = [proj(*p) for p in r]
        s = 'M' + ' L'.join(f'{x},{y}' for x, y in pts)
        out.append(s + ('Z' if close else ''))
    return ''.join(out)


def main():
    land = json.loads((SRC / 'ne_50m_land.geojson').read_text())
    rings = []
    for f in land['features']:
        g = f['geometry']
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        for poly in polys:
            outer = poly[0]
            if near(outer):
                # Clamping to an expanded window keeps the fill correct inside the window.
                rings.append(simplify_ring([clamp(*p) for p in outer], TOL))
    rivers = json.loads((SRC / 'ne_50m_rivers_lake_centerlines.geojson').read_text())
    lines = {}
    for f in rivers['features']:
        name = RIVERS.get(f['properties'].get('name'))
        if not name:
            continue
        g = f['geometry']
        for line in (g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]):
            if near(line, 0):
                lines.setdefault(name, []).append(simplify(line, TOL / 2))
    w, h = proj(E0, S0)
    data = {
        'source': 'Natural Earth 1:50m land and rivers (public domain), via scripts/build-map.py',
        'window': [W0, E0, S0, N0], 'lat0': LAT0, 'scale': SCALE, 'width': w, 'height': h,
        'land': path(rings, True),
        'rivers': [{'name': n, 'd': path(ls, False)} for n, ls in lines.items()],
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
    print(f'map: {OUT.stat().st_size / 1024:.1f} KB, {w}x{h}, rivers {list(lines)}')


if __name__ == '__main__':
    main()
