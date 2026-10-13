<h1 align="center">Surface</h1>

<p align="center">
  Web component that implements Surface of Axiom Design System.
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

Layers are drawn in the order you list them. `fill` comes with this package, other packages add more, for example `reveal` from `@ax-design/reveal-highlight`:

```html
<ax-surface layers="fill reveal">
  <button class="my-button">Hello</button>
</ax-surface>
```

Surfaces only work while they are visible, read their styles only after something changed, and lower the frame rate of far and small surfaces when the page starts dropping frames.

### Watching style changes

A surface notices style changes caused by classes, attributes, `:hover`, `:active`, `:focus`, form states, media queries, stylesheets and your own transitions. If a style of yours depends on something else (for example an element inside another component's shadow root), use `observe="precise"`:

```html
<ax-surface layers="fill" observe="precise">...</ax-surface>
```

or call `element.refresh()` (one surface) or `refreshAll()` (every surface) after the change.

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

### --ax-corner-{corner}-shift-x, --ax-corner-{corner}-shift-y

**Type:** `<length-percentage>`

**Default:** `0px`

**Description:** Moves one corner point into the shape, percentages are relative to the width (`x`) or the height (`y`). Shift the top left and bottom right corners on `x` and you get a parallelogram. Negative values move the corner out of the box.

### --ax-edge-{side}-kind

**Type:** `flat | arc | rect | triangle | trapezoid`

**Default:** `flat`

**Description:** The feature on one side. `arc` is a circular bump or notch, `rect`, `triangle` and `trapezoid` are straight ones.

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

**Description:** Where the middle of the feature sits along the side.

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

## Browser support

Surface works in browsers released since 2018 (Chrome 70, Firefox 63, Safari 12). It needs `ResizeObserver`, `IntersectionObserver` and Pointer Events, and tells you in the console when one of them is missing so that you can load a polyfill.
