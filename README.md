<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ax-design/surface/master/docs/logo-r.png">
    <img src="https://raw.githubusercontent.com/ax-design/surface/master/docs/logo.png" alt="Ax Surface">
  </picture>
</h1>

<p align="center">
  Web component that Combine All Layers of Axiom Design System.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@ax-design/surface"><img src="https://img.shields.io/npm/v/@ax-design/surface.svg" alt="npm version"></a>
  <a href="https://github.com/ax-design/surface/actions/workflows/ci.yml"><img src="https://github.com/ax-design/surface/actions/workflows/ci.yml/badge.svg" alt="CI Status"></a>
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT Licence" />
</p>

## Installation

```bash
// with npm
npm install @ax-design/surface

// with bun
bun add @ax-design/surface
```

and import it:

```javascript
import { register } from '@ax-design/surface';
register();
```

## Usage

A surface is the box that every visual effect of Axiom Design System draws on. It owns the shape, the tilt and one frame scheduler for the whole page, and it draws its content with layers.
To give your element a shape, wrap it with `ax-surface` and pick the layers you need.
Here's an example:

```html
<ax-surface layers="fill">
  <button class="my-button">Hello</button>
</ax-surface>
```

```css
ax-surface {
  --ax-radius: 12px;
  --ax-fill-color: white;
  --ax-border-color: #3b4252;
}
```

Layers are drawn in the order you list them, and your content is always on top. `fill` comes with this package, other packages add more: `elevation` from `@ax-design/elevation` (a shadow that follows the shape), `reveal` from `@ax-design/reveal-highlight` and `acrylic` from `@ax-design/acrylic`:

```html
<ax-surface layers="elevation fill reveal">
  <button class="my-button">Hello</button>
</ax-surface>
```

Want to try the properties? Run `bun install && bun run demo` in this repository and open the page it prints. It has a playground, shapes after the Material 3 shape set and a few tiles.

Surfaces only work while they are visible, read their styles only after something changed, and lower the frame rate of far and small surfaces when the page starts dropping frames.

### Watching style changes

A surface notices style changes caused by classes, attributes, `:hover`, `:active`, `:focus`, form states, media queries, stylesheets and your own transitions. If a style of yours depends on something else (for example an element inside another component's shadow root), use `observe="precise"`:

```html
<ax-surface layers="fill" observe="precise">...</ax-surface>
```

or call `element.refresh()` (one surface) or `refreshAll()` (every surface) after the change.

### Surfaces inside surfaces

A surface inside a tilted surface (for example `ax-reveal` inside `ax-pressure`) follows the tilt: your pointer is mapped through every tilt above it, so its effects stay under your pointer.

## Style Controlling

Surface component uses custom properties to manage its shape. In the names below, `{corner}` is one of `top-left`, `top-right`, `bottom-right`, `bottom-left`, and `{side}` is one of `top`, `right`, `bottom`, `left`.

Shape properties are not inherited, set them on the `ax-surface` element itself.

### --ax-radius

**Type:** `<length-percentage>`

**Default:** `0px`

**Description:** The radius of every corner. Percentages are relative to the shorter side. Like `border-radius`, radii that do not fit are scaled down.

### --ax-{corner}-radius

**Type:** `<length-percentage>`

**Default:** `-1px`

**Description:** The radius of one corner. A negative value means "use `--ax-radius`".

### --ax-corner-shape

**Type:** `round | bevel | scoop | notch`

**Default:** `round`

**Description:** The shape of every corner, with the same meaning as the CSS `corner-shape` keywords.

### --ax-corner-{corner}-shape

**Type:** `round | bevel | scoop | notch | auto`

**Default:** `auto`

**Description:** The shape of one corner. `auto` means "use `--ax-corner-shape`".

### --ax-corner-shoulder-radius, --ax-corner-{corner}-shoulder-radius

**Type:** `<length>`

**Default:** `0px`

**Description:** Rounds the two points where a `bevel`, `scoop` or `notch` corner meets the sides. `round` corners ignore it. The general property sets every corner unless a corner sets its own. With `--ax-radius: 50%` and `scoop`, neighboring corners meet in the middle of each side, and the shoulder radius rounds those points into a soft star; very large values turn it into a circle.

### --ax-corner-{corner}-shift-x, --ax-corner-{corner}-shift-y

**Type:** `<length-percentage>`

**Default:** `0px`

**Description:** Moves one corner point into the shape, percentages are relative to the width (`x`) or the height (`y`). Shift the top left and bottom right corners on `x` and you get a parallelogram. Negative values move the corner out of the box.

### --ax-edge-kind, --ax-edge-depth, --ax-edge-span, --ax-edge-at, --ax-edge-ratio, --ax-edge-tip-radius, --ax-edge-shoulder-radius

**Description:** The feature of every side at once. Each one is the default of the side properties below with the same name, so `--ax-edge-depth` sets `--ax-edge-top-depth`, `--ax-edge-right-depth` and so on, unless a side sets its own. Types and defaults are the same as for the side properties. Transitions and animations of these properties move all four sides.

```css
.cookie {
  --ax-radius: 30%;
  --ax-edge-kind: cusp;
  --ax-edge-depth: -6px;
  --ax-edge-span: 100%;
  --ax-edge-tip-radius: 20px;
  /* The top side goes deeper than the others. */
  --ax-edge-top-depth: -12px;
}
```

Sides run clockwise (see `--ax-edge-{side}-at`), so one `--ax-edge-at` away from 50% turns every feature the same way around the shape: the result has rotational symmetry, not mirror symmetry.

### --ax-edge-{side}-kind

**Type:** `flat | arc | rect | triangle | trapezoid | cusp`

**Default:** `flat`

**Description:** The feature on one side. `arc` is a circular bump or notch, `rect`, `triangle` and `trapezoid` are straight ones. `cusp` is two arcs that leave the side smoothly at both ends of the span and meet in a point: inward it pinches the side (the waist of the Material bun, the gaps of the clover), outward it makes a pointed arch. It needs no shoulder radius, and `tip-radius` rounds the point.

### --ax-edge-{side}-depth

**Type:** `<length>`

**Default:** `0px`

**Description:** How far the feature goes, positive values go out of the shape, negative values go into it.

### --ax-edge-{side}-span

**Type:** `<length-percentage>`

**Default:** `33%`

**Description:** The width of the feature along the side, percentages are relative to the length of the side.

### --ax-edge-{side}-at

**Type:** `<length-percentage>`

**Default:** `50%`

**Description:** Where the middle of the feature sits along the side. Sides run clockwise: `top` from left to right, `right` from top to bottom, `bottom` from right to left and `left` from bottom to top. So `--ax-edge-bottom-at: 20%` is near the bottom right corner.

### --ax-edge-{side}-ratio

**Type:** `<number>`

**Default:** `0.5`

**Description:** For `trapezoid` only, the width of the far end compared to the base. `1` gives a rectangle, `0` a triangle, and animating it morphs one into the other.

### --ax-edge-{side}-tip-radius, --ax-edge-{side}-shoulder-radius

**Type:** `<length>`

**Default:** `0px`

**Description:** Rounds the far corners (tip) and the corners where the feature meets the side (shoulder).

### --ax-border-width

**Type:** `<length>`

**Default:** `1px`

**Description:** The width of the border on every side. A surface keeps its border equally thick on screen while it is tilted.

### --ax-border-{side}-width

**Type:** `<length>`

**Default:** `-1px`

**Description:** The width of the border on one side. A negative value means "use `--ax-border-width`".

### --ax-tilt-mode

**Type:** `off | absolute | relative`

**Default:** `off`

**Description:** Tilts the surface toward the point you press. `absolute` sinks the pressed side by `--ax-tilt-depth`, `relative` tilts it by `--ax-tilt-factor` degrees.

### --ax-tilt-depth

**Type:** `<length>`

**Default:** `1px`

**Description:** The depth at which one side sinks down when you press the edge of the surface.

### --ax-tilt-factor

**Type:** `<number>`

**Default:** `2`

**Description:** The angle in degrees for `relative` mode.

### --ax-tilt-zoom

**Type:** `<length>`

**Default:** `0.8px`

**Description:** The extent to which the whole surface falls down when you press its center.

### --ax-tilt-perspective

**Type:** `<length>`

**Default:** `25px`

**Description:** The perspective of the tilt, check out [this tutorial](https://www.w3schools.com/cssref/css3_pr_perspective.asp).

### --ax-tilt-direction

**Type:** `normal | inverted`

**Default:** `normal`

**Description:** `inverted` lifts the pressed side instead of sinking it.

### --ax-fill-color

**Type:** `<color>`

**Default:** `transparent`

**Description:** For the `fill` layer, the color inside the shape.

### --ax-border-color

**Type:** `<color>`

**Default:** `transparent`

**Description:** For the `fill` layer, the color of the border.

## Writing a layer

A layer is an object that draws one thing on the surface. Register it with a name, then use the name in the `layers` attribute:

```javascript
import { registerLayer } from '@ax-design/surface';

registerLayer('outline', () => ({
  attach(container) { /* create your canvas or SVG in container */ },
  detach() {},
  write(frame) {
    // frame.shape.outline, frame.pointer, frame.values, frame.changed ...
    return false; // true asks for another frame
  },
}));
```

Layers draw inside the paint box (`frame.paint`): the element's box, grown to fit features that go out of the shape. If your layer paints outside the shape (a glow, a shadow), tell the surface how far with `overflow`, in px, for every side or as `[top, right, bottom, left]`:

```javascript
registerLayer('glow', () => ({
  overflow(values, width, height) {
    return 16;
  },
  // ...
}));
```

A paint box larger than the element overlaps its neighbors, and the browser may then have to composite them separately. Ask only for what you draw.

While the surface is tilted, it puts the tilt on each layer's container. If your layer uses `backdrop-filter`, set `tiltsItself: true` and apply `frame.tiltTransform` to your own elements, around the center of the element's box: inside `position: sticky`, Firefox renders a backdrop-filter under a transformed ancestor with the wrong backdrop.

## Writing an element

Subclass `AxSurface` to make an element with its own property names. `layerNames_()` picks the layers, `shapeFor()` and `borderWidthsFor()` read the shape, and `tiltParams()` and `tiltPerspective()` read the tilt:

```javascript
import { AxSurface } from '@ax-design/surface';

class MyCard extends AxSurface {
  static schemaKey = 'my-card';
  static extraSchema = [{ name: '--my-card-lean', syntax: { type: 'number' }, initial: '3', inherits: true }];

  layerNames_() { return ['fill']; }

  tiltParams(values, width, height, x, y) {
    const lean = values.number('--my-card-lean');
    return { width, height, perspective: 400, rotateX: (0.5 - y / height) * lean, rotateY: (x / width - 0.5) * lean, translateZ: 0 };
  }
}
customElements.define('my-card', MyCard);
```

## Browser support

Several packages may each bundle their own copy of Surface (the `build/` files of `@ax-design/reveal-highlight` and `@ax-design/acrylic` do), and they share their layers and their scheduler on the page.

The copy that loads first defines `<ax-surface>`. Newer properties, such as the shared `--ax-edge-*` properties, only work when that copy knows them, so keep the copies on the page at the same version.

Surface works in browsers released since 2018 (Chrome 70, Firefox 63, Safari 12). It needs `ResizeObserver`, `IntersectionObserver` and Pointer Events, and tells you in the console when one of them is missing so that you can load a polyfill.

## Changes in 0.2

* The `shadow` layer and the `--ax-shadow-*` properties are gone. Use the `elevation` layer of `@ax-design/elevation`, the Elevation shadow of the design system, which follows the shape the same way.
* `--ax-edge-kind`, `--ax-edge-depth` and the other shared edge properties set every side at once, and `--ax-corner-shoulder-radius` rounds where bevel, scoop and notch corners meet the sides.
* The `cusp` edge kind.
* The tilt goes on each layer and on the content instead of on a common parent. Inside `position: sticky`, Firefox showed the wrong backdrop through acrylic while a surface was pressed. Layers with a `backdrop-filter` set `tiltsItself` and apply `frame.tiltTransform` themselves.
* 0.2.1: `release()` ends a press before the pointer is up, for containers that take the gesture over (a tile drag).
