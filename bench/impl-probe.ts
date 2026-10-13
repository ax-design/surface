// Prototype of the probe-based style reader, to measure its cost against the legacy baseline.
// Each Surface resolves its numeric --ax-* properties through real CSS properties on hidden
// elements in its shadow root. Containers are sized to the percentage basis of their slots
// (width, height, min(width, height), 100px), so getComputedStyle returns the final px value.
// The same elements carry a 1ms transition and act as change detectors.
import type { BenchImpl } from './types.ts';

type Basis = 'w' | 'h' | 'min' | 'abs';
interface Slot {
    name: string;
    basis: Basis;
    signed: boolean;
    fallback: string;
    number?: boolean;
}

const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
const SIDES = ['top', 'right', 'bottom', 'left'];

const SLOTS: Slot[] = [
    { name: '--ax-radius', basis: 'min', signed: false, fallback: '0px' },
    ...CORNERS.map((c) => ({ name: `--ax-${c}-radius`, basis: 'min' as Basis, signed: false, fallback: '0px' })),
    ...CORNERS.map((c) => ({ name: `--ax-corner-${c}-shift-x`, basis: 'w' as Basis, signed: true, fallback: '0px' })),
    ...CORNERS.map((c) => ({ name: `--ax-corner-${c}-shift-y`, basis: 'h' as Basis, signed: true, fallback: '0px' })),
    ...SIDES.flatMap((s) => [
        { name: `--ax-edge-${s}-depth`, basis: 'abs' as Basis, signed: true, fallback: '0px' },
        { name: `--ax-edge-${s}-span`, basis: (s === 'top' || s === 'bottom' ? 'w' : 'h') as Basis, signed: false, fallback: '33%' },
        { name: `--ax-edge-${s}-at`, basis: 'abs' as Basis, signed: false, fallback: '50%' },
        { name: `--ax-edge-${s}-ratio`, basis: 'abs' as Basis, signed: false, fallback: '0.5', number: true },
        { name: `--ax-edge-${s}-tip-radius`, basis: 'abs' as Basis, signed: false, fallback: '0px' },
        { name: `--ax-edge-${s}-shoulder-radius`, basis: 'abs' as Basis, signed: false, fallback: '0px' },
    ]),
    { name: '--ax-border-width', basis: 'abs', signed: false, fallback: '1px' },
    ...SIDES.map((s) => ({ name: `--ax-border-${s}-width`, basis: 'abs' as Basis, signed: false, fallback: '0px' })),
];

// Real properties whose resolved value is the used px value and whose % resolves against the
// containing block width.
export const variant = new URLSearchParams(location.search).get('variant') || 'all';
// Variants that read raw strings from the host instead of reader probes.
const rawRead = variant.startsWith('raw') || variant.startsWith('final');

// Distinct weights so that unrelated value changes do not cancel out in the hash detector.
const WEIGHTS = SLOTS.map((_, i) => (1 + i * 0.0173).toFixed(4));

const SIGNED_PROPS = ['margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'left'];
const UNSIGNED_PROPS = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'width'];
const CAMEL: Record<string, string> = {};
for (const p of [...SIGNED_PROPS, ...UNSIGNED_PROPS]) CAMEL[p] = p.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

interface Placement {
    slot: Slot;
    element: number;
    prop: string;
}

interface Layout {
    css: string;
    html: string;
    placements: Placement[];
    elementCount: number;
}

function buildLayout(): Layout {
    const placements: Placement[] = [];
    const elements: { basis: Basis; signedFree: string[]; unsignedFree: string[] }[] = [];
    for (const slot of SLOTS) {
        let index = elements.findIndex(
            (e) => e.basis === slot.basis && (slot.signed ? e.signedFree.length : e.signedFree.length + e.unsignedFree.length) > 0
        );
        if (index < 0) {
            elements.push({ basis: slot.basis, signedFree: SIGNED_PROPS.slice(), unsignedFree: UNSIGNED_PROPS.slice() });
            index = elements.length - 1;
        }
        const e = elements[index];
        const prop = slot.signed ? e.signedFree.shift()! : (e.unsignedFree.shift() ?? e.signedFree.shift()!);
        placements.push({ slot, element: index, prop });
    }
    const rules: string[] = [];
    elements.forEach((_, i) => {
        const decls = placements
            .filter((p) => p.element === i)
            .map((p) => {
                const value = p.slot.number ? `calc(var(${p.slot.name}, ${p.slot.fallback}) * 1px)` : `var(${p.slot.name}, ${p.slot.fallback})`;
                return `${p.prop}: ${value};`;
            });
        const props = placements.filter((p) => p.element === i).map((p) => `${p.prop} 1ms`);
        const transition = variant === 'all' ? ` transition: ${props.join(', ')};` : '';
        rules.push(`#p${i} { ${decls.join(' ')}${transition} }`);
    });
    const byBasis: Record<Basis, number[]> = { w: [], h: [], min: [], abs: [] };
    elements.forEach((e, i) => byBasis[e.basis].push(i));
    const container = (basis: Basis) =>
        `<div class="c" id="c-${basis}">${byBasis[basis].map((i) => `<div class="p" id="p${i}"></div>`).join('')}${basis === 'abs' && variant === 'hash' ? '<div id="d"></div>' : ''}</div>`;
    // The hash detector folds every slot into one margin. Percentages resolve against #c-abs.
    const terms = SLOTS.map((slot, i) =>
        slot.number ? `var(${slot.name}, ${slot.fallback}) * ${WEIGHTS[i]}px` : `var(${slot.name}, ${slot.fallback}) * ${WEIGHTS[i]}`
    );
    const KEYWORDS = ['round', 'bevel', 'scoop', 'notch', 'none', 'arc', 'rect', 'triangle', 'trapezoid', 'auto'];
    const keywordProps = ['--ax-corner-shape', ...CORNERS.map((c) => `--ax-corner-${c}-shape`), ...SIDES.map((s) => `--ax-edge-${s}-kind`)];
    const keywordDetector =
        variant.startsWith('final') && variant !== 'final-inert'
            ? `${KEYWORDS.filter((k) => k !== 'none').map((k) => `@keyframes ${k} {}`).join(' ')} @keyframes ax-unset {}
#k { position: absolute; width: 1px; height: 1px; animation-name: ${keywordProps.map((p) => `var(${p}, ax-unset)`).join(', ')}; animation-duration: 1ms; }`
            : '';
    // final2: the hash lives in transform-origin, which never triggers layout.
    // Numbers get a 100px weight so a 0.01 step still moves the width by a full pixel.
    const roTerms = SLOTS.map((slot, i) =>
        slot.number ? `var(${slot.name}, ${slot.fallback}) * ${(100 * Number(WEIGHTS[i])).toFixed(2)}px` : `var(${slot.name}, ${slot.fallback}) * ${WEIGHTS[i]}`
    );
    const detector = variant === 'final-ro'
        ? `#d { position: absolute; height: 1px; width: calc(100000px + ${roTerms.join(' + ')}); }
.probes { contain: strict; }`
        : variant === 'final-inert'
        ? `#d { position: absolute; width: 1px; height: 1px; transform-origin: calc(${terms.join(' + ')}) 0; }
.probes { contain: strict; }`
        : variant === 'final2' || variant === 'final-num' || variant === 'final-kw'
        ? `#d { position: absolute; width: 1px; height: 1px; transform-origin: calc(${terms.join(' + ')}) 0; transition: transform-origin 1ms; }
.probes { contain: strict; }`
        : variant === 'hash' || variant === 'rawhash' || variant === 'final' ? `#d { position: relative; height: 0; margin-left: calc(${terms.join(' + ')}); transition: margin-left 1ms; }` : '';
    const css = `
:host { display: inline-block; position: relative; }
.probes { position: absolute; left: 0; top: 0; width: 0; height: 0; overflow: hidden; visibility: hidden; pointer-events: none; }
.c { position: absolute; left: 0; top: 0; height: 0; }
.p { position: relative; height: 0; box-sizing: content-box; }
#c-abs { width: 100px; }
${rules.join('\n')}
${detector}
${keywordDetector}
canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
.content { position: relative; }`;
    const raw = rawRead;
    const rawDetector =
        variant === 'rawhash' || variant.startsWith('final')
            ? `<div class="probes"><div class="c" id="c-abs">${variant === 'final-kw' ? '' : '<div id="d"></div>'}${variant.startsWith('final') && variant !== 'final-num' && variant !== 'final-inert' ? '<div id="k"></div>' : ''}</div></div>`
            : '';
    const probes = raw ? rawDetector : `<div class="probes">${(['w', 'h', 'min', 'abs'] as Basis[]).map(container).join('')}</div>`;
    const html = `<style>${css}</style><canvas></canvas>${probes}<div class="content"><slot></slot></div>`;
    return { css, html, placements, elementCount: elements.length };
}

const layout = buildLayout();
const template = document.createElement('template');
template.innerHTML = layout.html;

export const stats = { reads: 0, readMs: 0, elements: layout.elementCount, slowPath: 0 };
const SIMPLE = /^-?(\d+\.?\d*|\.\d+)(px|%)?$/;

export function readAll() {
    document.querySelectorAll('ax-probe-surface').forEach((el) => (el as ProbeSurface).read());
}

class ProbeSurface extends HTMLElement {
    private root: ShadowRoot;
    private probeEls: HTMLElement[] = [];
    private cw!: HTMLElement;
    private ch!: HTMLElement;
    private cm!: HTMLElement;
    values = new Float64Array(SLOTS.length);
    private dirty = false;

    constructor() {
        super();
        this.root = this.attachShadow({ mode: 'open' });
        this.root.appendChild(document.importNode(template.content, true));
        if (!rawRead) {
            for (let i = 0; i < layout.elementCount; i++) this.probeEls.push(this.root.getElementById(`p${i}`)!);
            this.cw = this.root.getElementById('c-w')!;
            this.ch = this.root.getElementById('c-h')!;
            this.cm = this.root.getElementById('c-min')!;
        }
        this.root.addEventListener('transitionrun', this.markDirty);
        if (variant === 'final-ro') {
            const d = this.root.getElementById('d')!;
            detectorOwner.set(d, this);
            detectorObserver.observe(d);
        }
        this.root.addEventListener('animationstart', this.markDirty);
    }

    markDirty = () => {
        if (this.dirty) return;
        this.dirty = true;
        requestAnimationFrame(this.read);
    };

    connectedCallback() {
        observer.observe(this);
    }

    disconnectedCallback() {
        observer.unobserve(this);
    }

    resize(width: number, height: number) {
        if (rawRead) {
            this.markDirty();
            return;
        }
        this.cw.style.width = `${width}px`;
        this.ch.style.width = `${height}px`;
        this.cm.style.width = `${Math.min(width, height)}px`;
        this.markDirty();
    }

    read = () => {
        this.dirty = false;
        const start = performance.now();
        if (rawRead) {
            // Fast path: literal px, % and plain numbers parse directly. Anything else would go
            // to the shared slow-path probe, which this prototype only counts.
            const style = getComputedStyle(this);
            for (let i = 0; i < SLOTS.length; i++) {
                const text = style.getPropertyValue(SLOTS[i].name).trim();
                if (text === '') {
                    this.values[i] = NaN;
                } else if (SIMPLE.test(text)) {
                    this.values[i] = parseFloat(text);
                } else {
                    stats.slowPath++;
                }
            }
            stats.reads++;
            stats.readMs += performance.now() - start;
            return;
        }
        const styles = this.probeEls.map((el) => getComputedStyle(el));
        const placements = layout.placements;
        for (let i = 0; i < placements.length; i++) {
            const p = placements[i];
            this.values[i] = parseFloat((styles[p.element] as unknown as Record<string, string>)[CAMEL[p.prop]]);
        }
        stats.reads++;
        stats.readMs += performance.now() - start;
    };
}

const detectorOwner = new WeakMap<Element, ProbeSurface>();
const detectorObserver = new ResizeObserver((entries) => {
    for (const entry of entries) detectorOwner.get(entry.target)?.markDirty();
});

const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
        const box = entry.contentRect;
        (entry.target as ProbeSurface).resize(box.width, box.height);
    }
});

export const probe: BenchImpl = {
    setup() {
        customElements.define('ax-probe-surface', ProbeSurface);
    },
    mount(root, count) {
        const grid = document.createElement('div');
        grid.className = 'grid';
        for (let i = 0; i < count; i++) {
            const surface = document.createElement('ax-probe-surface');
            const button = document.createElement('button');
            button.className = 'btn';
            button.textContent = `Item ${i}`;
            surface.appendChild(button);
            grid.appendChild(surface);
        }
        root.appendChild(grid);
        // Resolves after ResizeObserver delivered sizes and every surface read once.
        return new Promise((resolve) => {
            const check = () => (stats.reads >= count ? resolve() : requestAnimationFrame(check));
            requestAnimationFrame(check);
        });
    },
    pointerTarget(root) {
        return root.firstElementChild as HTMLElement;
    },
    afterToggle() {
        // Variants without a working detector model "re-read everything on change".
        if (variant === 'raw' || variant === 'final-inert') requestAnimationFrame(readAll);
    },
};
