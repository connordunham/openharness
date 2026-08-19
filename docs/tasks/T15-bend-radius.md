# T15 — Bend radius

**Size** M · **Package** `core`, `render` · **Basis** `DOMAIN-DECISIONS.md` D4

## Goal

Warn when a bundle turns more tightly than its contents allow.

Named by the project's harness engineer alongside current capacity as a
highest-value missing check. Cheaper than T14 because most inputs exist.

## What exists already

- `bundleDiameters` in the derived model, computed from bundle contents.
- `Bundle.waypoints` — the path, so turn angles are derivable.
- Covering and jacket data on the parts.

What is missing is the minimum-radius figure and the geometry that turns a
waypoint into an actual radius.

## Contract

New rule `BEND_RADIUS`, severity `warning`.

For each corner in a bundle's path:

1. Compute the effective radius. In plain Layout the path is a polyline, so a
   corner is a point: the radius comes from an authored bend radius if there
   is one, or is unknown. In formboard mode (T12) bundles have a real corner
   radius and this becomes exact.
2. Establish the minimum permissible radius — conventionally a multiple of the
   bundle's outer diameter, with the multiplier depending on construction.
   Shielded and coaxial runs are stricter than loose bundles.
3. Report actual radius, minimum, and which bundle.

**The multiplier is standards or manufacturer data. Cite it.** Make it
overridable per bundle and per covering part: a specific cable's datasheet
always beats a general rule.

## Relationship to T12

In plain Layout the drawing is not to scale, so a tight-looking corner may
mean nothing physically. Be honest about that — where the radius is not known,
report unknown rather than inferring it from screen geometry.

The rule becomes fully meaningful in formboard mode, where lengths and radii
are real. Build it so it strengthens automatically when that data appears
rather than needing rework.

## Acceptance tests

- a bundle with a generous authored radius: no finding
- the same bundle below the multiplier: finding, reporting actual and minimum
- a bundle whose radius is unknown: reported as unknown — not a violation,
  and not a pass
- a per-bundle override beats the general multiplier
- a shielded bundle gets a stricter multiplier than an equivalent unshielded one
- diameter comes from `bundleDiameters`, not recomputed

## Traps

- Unknown is not pass. A tool that silently passes every corner it cannot
  measure is worse than one that says it cannot measure them.
- Diameter here is the bundle's *outer* diameter including coverings, not the
  summed conductor area. Different numbers; only one is right.
