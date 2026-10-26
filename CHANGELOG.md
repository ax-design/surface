# Changelog

All notable changes to this package are documented in this file.

## 0.4.1

- Depends on `@ax-design/typed-om` 0.3, which adds the `time` syntax type. A schema with a `<time>` property (an `extraSchema` of a subclass or the schema of a layer) is now read by the surface as a number of milliseconds; with 0.2 it was not understood.

## 0.4.0

- The per-side and per-corner edge properties (`--ax-edge-{side}-kind`, `--ax-edge-{side}-depth` and the rest, plus `--ax-corner-{corner}-shoulder-radius`) now default to `auto`, resolved in JavaScript against the general `--ax-edge-*` and `--ax-corner-shoulder-radius` properties instead of through `:host` CSS fallbacks. Reading a per-side computed style now shows `auto` rather than the resolved value.
- Animating a per-side property from an implicit starting point now switches discretely at the 50% mark instead of interpolating continuously; write an explicit `from` to keep interpolating. Animating the general properties is unchanged.
- Removed `SHARED_FALLBACK_CSS`, `SHARED_SCHEMA` and the `shared` / `fallbackCss` fields of `SchemaBundle` (so `SHAPE.shared` and `SHAPE.fallbackCss` are gone). The general properties are now part of `SHAPE_SCHEMA` and are read on every paint.

## 0.3.3

- A pointer is mapped through a scaled or zoomed ancestor (a page transition, a design preview, `zoom`): its screen position is divided back into the local pixels of the surface, so a press lands where it looks. A surface that tilts still maps through its homography.

## 0.3.2

- A border whose color is transparent is no longer drawn. An animated surface used to write a path it could not show on every frame, and the clip behind it was invalidated with it. Forced colors still draw the border, where a transparent one turns into CanvasText.

## 0.3.1

- A motion to opacity 0 hides the layers at once, not only the content. They used to draw for one more paint at the opacity they had, so a tile starting its entrance showed its fill for a frame.

## 0.3.0

- `motion()` moves a surface in 3D, scales and moves it outside its perspective, and fades it, for entrances and launches. The layers follow it: use acrylic 0.3, elevation 0.2 and reveal-highlight 0.7. Content that a motion hides is hidden at once.
- `press()` and `release()` press a surface from code, and `pressTakenOver` and `pressRemaining()` tell when its press feedback is over. A press from the keyboard or from code is never held back at a reveal boundary.
- `appearance()` follows the display preferences of the user: forced colors, reduced transparency and reduced motion. `useFallback()` and `setAlwaysUseFallback()` switch the effects to their plain fallback. Borders and the focus ring get more contrast with `prefers-contrast: more`.
- The `focus` layer, a focus ring that follows the shape, for keyboard focus only (`:-moz-focusring` before Firefox 85).
- `WINDOWS_EASINGS`, `windowsEasing()`, `bezierAt()` and `parseEasing()`: the curves of the Windows animation theme, and cubic-béziers for scripted animations.
- The layers are made before a surface comes into view.

## 0.2.4

- In Firefox, nothing in a surface gets a 3D transform: any of them turned the blur of acrylic clear. The content and the layers tilt with the closest 2D transform there, and a pressed surface keeps its tilt. The paint box of a surface no longer switches on and off while its shape moves. Use it with acrylic 0.2.1, which cuts its glass to the tilted outline in Firefox.

## 0.2.3

- `SHAPE_SCHEMA`, `BORDER_SCHEMA` and `TILT_SCHEMA`, the groups of the property contract, and a `./schema` subpath that takes the contract without the element.

## 0.2.2

- the `clip` attribute cuts the content to the shape. Pressing or dragging on a surface no longer selects its text or drags its links and images. A surface that can tilt keeps the boxes of its layer containers while it is not pressed too: in Firefox, acrylic on a surface used to turn clear at times while it was pressed, when those boxes were made.

## 0.2.1

- `release()` ends a press before the pointer is up, for containers that take the gesture over (a tile drag).

## 0.2.0

- The `shadow` layer and the `--ax-shadow-*` properties are gone. Use the `elevation` layer of `@ax-design/elevation`, the Elevation shadow of the design system, which follows the shape the same way.
- `--ax-edge-kind`, `--ax-edge-depth` and the other shared edge properties set every side at once, and `--ax-corner-shoulder-radius` rounds where bevel, scoop and notch corners meet the sides.
- The `cusp` edge kind.
- The tilt goes on each layer and on the content instead of on a common parent. Inside `position: sticky`, Firefox showed the wrong backdrop through acrylic while a surface was pressed. Layers with a `backdrop-filter` set `tiltsItself` and apply `frame.tiltTransform` themselves.
