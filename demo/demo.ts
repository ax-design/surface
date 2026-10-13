import { registerAcrylicLayer } from '@ax-design/acrylic';
import { registerRevealLayer } from '@ax-design/reveal-highlight';
import { register } from '../src/index.js';

registerRevealLayer();
registerAcrylicLayer();
register();

// Shapes after the Material 3 shape set, for a 100px reference size. Values in px scale with
// the size they are shown at.
interface Preset {
    name: string;
    size?: [number, number];
    props: Record<string, string>;
}

const PRESETS: Preset[] = [
    { name: 'Circle', props: { '--ax-radius': '50%' } },
    { name: 'Square', props: { '--ax-radius': '28%' } },
    { name: 'Slanted', props: { '--ax-radius': '18%', '--ax-corner-top-left-shift-x': '14%', '--ax-corner-bottom-right-shift-x': '14%' } },
    {
        name: 'Arch',
        props: { '--ax-top-left-radius': '50%', '--ax-top-right-radius': '50%', '--ax-bottom-right-radius': '14%', '--ax-bottom-left-radius': '14%' },
    },
    { name: 'Fan', props: { '--ax-radius': '14%', '--ax-bottom-right-radius': '100%' } },
    {
        name: 'Arrow',
        props: {
            '--ax-radius': '14%',
            '--ax-corner-top-left-shift-x': '50%',
            '--ax-corner-top-right-shift-x': '50%',
            '--ax-edge-bottom-kind': 'triangle',
            '--ax-edge-bottom-depth': '-24px',
            '--ax-edge-bottom-span': '64%',
            '--ax-edge-bottom-tip-radius': '6px',
            '--ax-edge-bottom-shoulder-radius': '8px',
        },
    },
    { name: 'Semicircle', size: [100, 50], props: { '--ax-top-left-radius': '50px', '--ax-top-right-radius': '50px', '--ax-bottom-right-radius': '8px', '--ax-bottom-left-radius': '8px' } },
    { name: 'Pill', size: [100, 56], props: { '--ax-radius': '50%' } },
    { name: 'Triangle', props: { '--ax-radius': '16%', '--ax-corner-top-left-shift-x': '50%', '--ax-corner-top-right-shift-x': '50%' } },
    {
        name: 'Diamond',
        props: {
            '--ax-radius': '12%',
            '--ax-corner-top-left-shift-y': '50%',
            '--ax-corner-top-right-shift-x': '50%',
            '--ax-corner-bottom-right-shift-y': '50%',
            '--ax-corner-bottom-left-shift-x': '50%',
        },
    },
    {
        name: 'Puffy diamond',
        props: {
            '--ax-radius': '30%',
            '--ax-corner-top-left-shift-y': '50%',
            '--ax-corner-top-right-shift-x': '50%',
            '--ax-corner-bottom-right-shift-y': '50%',
            '--ax-corner-bottom-left-shift-x': '50%',
        },
    },
    { name: 'Clamshell', props: { '--ax-radius': '30%', '--ax-corner-shape': 'bevel' } },
    {
        name: '4-sided cookie',
        props: Object.assign(
            { '--ax-radius': '34%' },
            ...['top', 'right', 'bottom', 'left'].map((s) => ({
                [`--ax-edge-${s}-kind`]: 'arc',
                [`--ax-edge-${s}-depth`]: '-7px',
                [`--ax-edge-${s}-span`]: '44%',
                [`--ax-edge-${s}-shoulder-radius`]: '6px',
            }))
        ),
    },
    {
        name: '4-leaf clover',
        props: Object.assign(
            { '--ax-radius': '30%' },
            ...['top', 'right', 'bottom', 'left'].map((s) => ({
                [`--ax-edge-${s}-kind`]: 'arc',
                [`--ax-edge-${s}-depth`]: '-16px',
                [`--ax-edge-${s}-span`]: '40%',
                [`--ax-edge-${s}-shoulder-radius`]: '10px',
            }))
        ),
    },
    {
        name: 'Ghost-ish',
        props: {
            '--ax-top-left-radius': '50%',
            '--ax-top-right-radius': '50%',
            '--ax-bottom-right-radius': '12%',
            '--ax-bottom-left-radius': '12%',
            '--ax-edge-bottom-kind': 'arc',
            '--ax-edge-bottom-depth': '-12px',
            '--ax-edge-bottom-span': '32%',
            '--ax-edge-bottom-shoulder-radius': '5px',
        },
    },
    { name: 'Pixel circle', props: { '--ax-radius': '18%', '--ax-corner-shape': 'notch' } },
    {
        name: 'Ticket',
        size: [100, 76],
        props: {
            '--ax-radius': '12px',
            '--ax-edge-left-kind': 'arc',
            '--ax-edge-left-depth': '-9px',
            '--ax-edge-left-span': '42%',
            '--ax-edge-right-kind': 'arc',
            '--ax-edge-right-depth': '-9px',
            '--ax-edge-right-span': '42%',
        },
    },
    {
        // Two rounded rectangles on top of each other.
        name: 'Bun',
        props: Object.assign(
            { '--ax-radius': '28%' },
            ...['left', 'right'].map((s) => ({
                [`--ax-edge-${s}-kind`]: 'triangle',
                [`--ax-edge-${s}-depth`]: '-12px',
                [`--ax-edge-${s}-span`]: '44px',
                [`--ax-edge-${s}-tip-radius`]: '4px',
                [`--ax-edge-${s}-shoulder-radius`]: '10px',
            }))
        ),
    },
    {
        // A square with a triangle out of every side; the triangles go out of the box.
        name: 'Sun',
        size: [64, 64],
        props: Object.assign(
            { '--ax-radius': '4px' },
            ...['top', 'right', 'bottom', 'left'].map((s) => ({
                [`--ax-edge-${s}-kind`]: 'triangle',
                [`--ax-edge-${s}-depth`]: '24px',
                [`--ax-edge-${s}-span`]: '60%',
                [`--ax-edge-${s}-tip-radius`]: '5px',
                [`--ax-edge-${s}-shoulder-radius`]: '4px',
            }))
        ),
    },
];

const scalePx = (value: string, factor: number) => value.replace(/(-?\d*\.?\d+)px/g, (_, n) => `${Math.round(parseFloat(n) * factor * 10) / 10}px`);

// ----- Playground -----

const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
const CORNER_LABELS = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
const SIDES = ['top', 'right', 'bottom', 'left'];
const SIDE_LABELS = ['Top', 'Right', 'Bottom', 'Left'];

type Control =
    | { kind: 'range'; label: string; prop: string; min: number; max: number; step: number; unit: string; initial: string; auto?: string }
    | { kind: 'select'; label: string; prop: string; options: string[]; initial: string }
    | { kind: 'color'; label: string; prop: string; initial: string; alpha?: boolean };

const range = (label: string, prop: string, min: number, max: number, step: number, unit: string, initial: string, auto?: string): Control => ({
    kind: 'range',
    label,
    prop,
    min,
    max,
    step,
    unit,
    initial,
    auto,
});
const select = (label: string, prop: string, options: string[], initial: string): Control => ({ kind: 'select', label, prop, options, initial });
const color = (label: string, prop: string, initial: string, alpha = false): Control => ({ kind: 'color', label, prop, initial, alpha });

// Controls of one group; {corner} and {side} stand for the selected corner or side.
interface Group {
    title: string;
    layer?: string;
    pick?: { key: 'corner' | 'side'; labels: string[] };
    controls: Control[];
}

const GROUPS: Group[] = [
    {
        title: 'Shape',
        controls: [
            range('Radius', '--ax-radius', 0, 50, 1, '%', '0px'),
            select('Corners', '--ax-corner-shape', ['round', 'bevel', 'scoop', 'notch'], 'round'),
        ],
    },
    {
        title: 'Corner',
        pick: { key: 'corner', labels: CORNER_LABELS },
        controls: [
            range('Radius', '--ax-{corner}-radius', -1, 50, 1, '%', '-1px', 'auto'),
            select('Shape', '--ax-corner-{corner}-shape', ['auto', 'round', 'bevel', 'scoop', 'notch'], 'auto'),
            range('Shift x', '--ax-corner-{corner}-shift-x', -20, 50, 1, '%', '0px'),
            range('Shift y', '--ax-corner-{corner}-shift-y', -20, 50, 1, '%', '0px'),
        ],
    },
    {
        title: 'Edge',
        pick: { key: 'side', labels: SIDE_LABELS },
        controls: [
            select('Kind', '--ax-edge-{side}-kind', ['flat', 'arc', 'rect', 'triangle', 'trapezoid'], 'flat'),
            range('Depth', '--ax-edge-{side}-depth', -80, 80, 1, 'px', '0px'),
            range('Span', '--ax-edge-{side}-span', 0, 100, 1, '%', '33%'),
            range('At', '--ax-edge-{side}-at', 0, 100, 1, '%', '50%'),
            range('Ratio', '--ax-edge-{side}-ratio', 0, 1, 0.05, '', '0.5'),
            range('Tip radius', '--ax-edge-{side}-tip-radius', 0, 40, 1, 'px', '0px'),
            range('Shoulder', '--ax-edge-{side}-shoulder-radius', 0, 40, 1, 'px', '0px'),
        ],
    },
    {
        title: 'Border',
        controls: [range('Width', '--ax-border-width', 0, 10, 0.5, 'px', '1px'), color('Color', '--ax-border-color', 'rgba(0, 0, 0, 0)', true)],
    },
    {
        title: 'Tilt',
        controls: [
            select('Mode', '--ax-tilt-mode', ['off', 'absolute', 'relative'], 'off'),
            range('Depth', '--ax-tilt-depth', 0, 20, 0.5, 'px', '1px'),
            range('Factor', '--ax-tilt-factor', 0, 20, 0.5, '', '2'),
            range('Perspective', '--ax-tilt-perspective', 25, 1500, 5, 'px', '25px'),
        ],
    },
    { title: 'Fill', layer: 'fill', controls: [color('Color', '--ax-fill-color', 'rgba(0, 0, 0, 0)', true)] },
    {
        title: 'Shadow',
        layer: 'shadow',
        controls: [
            color('Color', '--ax-shadow-color', 'rgba(0, 0, 0, 0.3)', true),
            range('Blur', '--ax-shadow-blur', 0, 80, 1, 'px', '12px'),
            range('X', '--ax-shadow-x', -40, 40, 1, 'px', '0px'),
            range('Y', '--ax-shadow-y', -40, 40, 1, 'px', '4px'),
        ],
    },
    {
        title: 'Acrylic',
        layer: 'acrylic',
        controls: [
            color('Tint', '--acrylic-tint-color', 'rgb(0, 0, 0)'),
            range('Tint opacity', '--acrylic-tint-opacity', 0, 1, 0.01, '', '0.6'),
            range('Blur', '--acrylic-blur', 0, 80, 1, 'px', '20px'),
        ],
    },
    {
        title: 'Reveal',
        layer: 'reveal',
        controls: [color('Color', '--reveal-color', 'rgb(0, 0, 0)'), range('Opacity', '--reveal-opacity', 0, 1, 0.01, '', '0.26')],
    },
];

const LAYERS = ['shadow', 'fill', 'acrylic', 'reveal'];

const INITIAL: Record<string, string> = {
    '--ax-radius': '16%',
    '--ax-border-width': '1px',
    '--ax-tilt-mode': 'absolute',
    '--ax-tilt-depth': '3px',
    '--ax-tilt-perspective': '600px',
    '--ax-fill-color': 'rgba(255, 255, 255, 0.85)',
    '--ax-shadow-color': 'rgba(10, 12, 30, 0.45)',
    '--ax-shadow-blur': '30px',
    '--ax-shadow-y': '12px',
    '--acrylic-tint-color': 'rgb(255, 255, 255)',
    '--acrylic-tint-opacity': '0.18',
    '--acrylic-blur': '24px',
    '--reveal-color': 'rgb(255, 255, 255)',
    '--reveal-opacity': '0.3',
};

const subject = document.getElementById('subject') as HTMLElement;
const output = document.getElementById('output') as HTMLElement;
const form = document.getElementById('controls') as HTMLFormElement;

const state = {
    layers: ['shadow', 'acrylic', 'reveal'],
    size: [240, 150] as [number, number],
    props: { ...INITIAL } as Record<string, string>,
    picked: { corner: 0, side: 0 },
};

const defaults: Record<string, string> = {};
for (const g of GROUPS) {
    for (const c of g.controls) {
        if (g.pick) {
            const names = g.pick.key === 'corner' ? CORNERS : SIDES;
            for (const n of names) defaults[c.prop.replace(`{${g.pick.key}}`, n)] = c.initial;
        } else {
            defaults[c.prop] = c.initial;
        }
    }
}

const resolveProp = (g: Group, c: Control) =>
    g.pick ? c.prop.replace(`{${g.pick.key}}`, (g.pick.key === 'corner' ? CORNERS : SIDES)[state.picked[g.pick.key]]) : c.prop;
const current = (prop: string) => (prop in state.props ? state.props[prop] : defaults[prop]);

function parseColor(value: string): { hex: string; alpha: number } {
    const m = value.match(/rgba?\(([^)]+)\)/);
    const parts = m ? m[1].split(',').map((s) => parseFloat(s)) : [0, 0, 0, 1];
    const hex = '#' + parts.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
    return { hex, alpha: parts.length > 3 ? parts[3] : 1 };
}

function rgba(hex: string, alpha: number): string {
    const n = parseInt(hex.slice(1), 16);
    const rgb = `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
    return alpha >= 1 ? `rgb(${rgb})` : `rgba(${rgb}, ${alpha})`;
}

function apply() {
    subject.setAttribute('layers', state.layers.join(' '));
    subject.style.cssText = '';
    subject.style.width = `${state.size[0]}px`;
    subject.style.height = `${state.size[1]}px`;
    for (const prop in state.props) subject.style.setProperty(prop, state.props[prop]);
    const lines = Object.keys(state.props)
        .filter((p) => state.props[p] !== defaults[p])
        .map((p) => `  <span class="p">${p}</span>: ${state.props[p]};`);
    output.innerHTML =
        `&lt;ax-surface class="my-surface" layers="${state.layers.join(' ')}"&gt;...&lt;/ax-surface&gt;\n\n` +
        `.my-surface {\n  width: ${state.size[0]}px;\n  height: ${state.size[1]}px;\n${lines.join('\n')}\n}`;
}

function set(prop: string, value: string) {
    if (value === defaults[prop]) delete state.props[prop];
    else state.props[prop] = value;
    apply();
}

// Builds the form; called again when the selected corner or side changes.
function render() {
    form.textContent = '';
    const head = document.createElement('h3');
    head.textContent = 'Layers';
    form.appendChild(head);
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const layer of LAYERS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = layer;
        b.setAttribute('aria-pressed', String(state.layers.indexOf(layer) >= 0));
        b.onclick = () => {
            const on = state.layers.indexOf(layer) >= 0;
            state.layers = LAYERS.filter((l) => (l === layer ? !on : state.layers.indexOf(l) >= 0));
            apply();
            render();
        };
        chips.appendChild(b);
    }
    form.appendChild(chips);

    for (const g of GROUPS) {
        if (g.layer && state.layers.indexOf(g.layer) < 0) continue;
        const h = document.createElement('h3');
        h.textContent = g.title;
        form.appendChild(h);
        if (g.pick) {
            const seg = document.createElement('div');
            seg.className = 'segmented';
            const pick = g.pick;
            pick.labels.forEach((label, i) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.textContent = label;
                b.setAttribute('aria-pressed', String(state.picked[pick.key] === i));
                b.onclick = () => {
                    state.picked[pick.key] = i;
                    render();
                };
                seg.appendChild(b);
            });
            form.appendChild(seg);
        }
        for (const c of g.controls) form.appendChild(row(g, c));
    }
}

function row(g: Group, c: Control): HTMLElement {
    const prop = resolveProp(g, c);
    const el = document.createElement('div');
    el.className = 'row';
    const label = document.createElement('label');
    label.textContent = c.label;
    el.appendChild(label);
    const value = current(prop);
    if (c.kind === 'range') {
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(c.min);
        input.max = String(c.max);
        input.step = String(c.step);
        const out = document.createElement('output');
        const n = parseFloat(value);
        input.value = String(c.auto && n < 0 ? c.min : n);
        const show = () => (out.textContent = c.auto && parseFloat(input.value) < 0 ? c.auto : `${input.value}${c.unit}`);
        show();
        input.oninput = () => {
            show();
            const v = parseFloat(input.value);
            set(prop, c.auto && v < 0 ? c.initial : `${v}${c.unit}`);
        };
        el.appendChild(input);
        el.appendChild(out);
    } else if (c.kind === 'select') {
        const s = document.createElement('select');
        for (const o of c.options) s.appendChild(new Option(o, o, false, o === value));
        s.onchange = () => set(prop, s.value);
        el.appendChild(s);
    } else {
        const { hex, alpha } = parseColor(value);
        const input = document.createElement('input');
        input.type = 'color';
        input.value = hex;
        el.appendChild(input);
        let a = alpha;
        if (c.alpha) {
            el.style.gridTemplateColumns = '96px 44px 1fr 40px';
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '0';
            slider.max = '1';
            slider.step = '0.01';
            slider.value = String(alpha);
            slider.title = 'Opacity';
            const out = document.createElement('output');
            out.textContent = alpha.toFixed(2);
            slider.oninput = () => {
                a = parseFloat(slider.value);
                out.textContent = a.toFixed(2);
                set(prop, rgba(input.value, a));
            };
            el.appendChild(slider);
            el.appendChild(out);
        }
        input.oninput = () => set(prop, rgba(input.value, a));
    }
    return el;
}

function loadPreset(p: Preset) {
    const keep: Record<string, string> = {};
    // Keep layers, colors, tilt and effects; replace the shape.
    for (const prop in state.props) if (!/^--ax-(radius|corner|edge|top-|bottom-)/.test(prop)) keep[prop] = state.props[prop];
    const [w, h] = p.size || [100, 100];
    const factor = 2.2;
    state.size = [Math.round(w * factor), Math.round(h * factor)];
    state.props = keep;
    for (const prop in p.props) state.props[prop] = scalePx(p.props[prop], factor);
    apply();
    render();
    subject.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ----- Gallery -----

const gallery = document.getElementById('gallery') as HTMLElement;
for (const p of PRESETS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'shape-card';
    const s = document.createElement('ax-surface');
    s.setAttribute('layers', 'fill');
    const [w, h] = p.size || [100, 100];
    const factor = 0.76;
    s.style.width = `${Math.round(w * factor)}px`;
    s.style.height = `${Math.round(h * factor)}px`;
    for (const prop in p.props) s.style.setProperty(prop, scalePx(p.props[prop], factor));
    card.appendChild(s);
    card.appendChild(document.createTextNode(p.name));
    card.onclick = () => loadPreset(p);
    gallery.appendChild(card);
}

apply();
render();
(window as unknown as { __ready: boolean }).__ready = true;
