# Changelog

All notable changes to this package are documented in this file.

## 0.4.4

- A surface costs less to make and to keep. Its style is one constructed sheet that every surface adopts, instead of a style element in each shadow root, and a subclass adds the sheets of its class after it with `static extraSheets()` instead of adding a style element to each instance. A browser without constructable style sheets still gets the style element. The surface above a surface is looked for when it is first needed, not on every connect (the walk up the page costs more the deeper the page is, and a surface that is paused or out of view never needs it).
- The layers of a surface are attached in the write phase of its first frame, not in the callback of the visibility observer. That callback wrote DOM between two frames, so the first read of the next frame, whichever client made it, found the layout dirty and forced it.
- The check for a running author transition on the surface itself (`getAnimations`) runs in the read phase, right after the styles were read and are clean, not in the write phase, where it came after the writes of every surface before it and flushed the styles again for each surface that wrote: on a page of several hundred surfaces that was most of a long task. The running transitions of the page are checked once per frame for all surfaces (`getAnimations` of each running element, not of each running element for each surface), and a surface is animating when it, or an element around it, is running one, found by walking up from the surface instead of walking every running element.
- The properties of a layer are registered with the browser when the layer is (`registerLayer`), and those of the core schema in `register()`, not when the first surface that uses them builds its schema. A registration invalidates the style of the whole page, so one that comes when a component first appears (a card, an arrow) found the page grown and paid for all of it. Depends on `@ax-design/typed-om` 0.3.1, which asks the browser once for each name.

## 0.4.3

- `paused`: a surface with `paused = true` runs no frame, reads no style and draws nothing, as one outside the viewport, and draws again at once when it is set back to `false`. For a surface that is known to show nothing for a while, such as a part of a component that has faded out: a page with hundreds of them costs nothing until they show.

## 0.4.2

- `PRIORITY_PRESSED`, `PRIORITY_POINTER` and `PRIORITY_IDLE` are exported, so code that is not a surface can be a client of the frame scheduler with a priority (`services().scheduler.request`).
- A surface class may override `visibilityTarget()` to share the visibility of another element (its component's host). The page then watches one element for all of them instead of one per surface, which took most of the cost of a scroll on a page with hundreds of surfaces. Several surfaces may share an element in the visibility tracker.

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
