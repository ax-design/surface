// Browser checks for <ax-surface>. Some steps need real input; the driver performs them when
// window.__step asks for it and answers through window.__ack.
import { apply, resolve, tiltHomography, toSvgPath } from '@ax-design/shape';
import { appearance, register, registerLayer, services, setAlwaysUseFallback, shapeSpecFrom, borderWidthsFrom } from '../src/index.js';
import type { AxSurface } from '../src/index.js';

interface Check {
    name: string;
    ok: boolean;
    detail: string;
}

declare global {
    interface Window {
        __result?: unknown;
        __step?: string;
        __ack?: string;
    }
}

const checks: Check[] = [];
const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });
const frames = (n: number) =>
    new Promise<void>((resolve) => {
        const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
        requestAnimationFrame(step);
    });
const ask = async (step: string) => {
    window.__ack = '';
    window.__step = step;
    while (window.__ack !== step) await frames(1);
    await frames(3);
};

const geckoTest = CSS.supports('-moz-appearance', 'none');
const byId = (id: string) => document.getElementById(id) as AxSurface;
const fillPath = (el: AxSurface) => el.shadowRoot!.querySelector('.layer-fill path')!.getAttribute('d') || '';
// Default surfaces register with the shared triggers; precise ones carry a detector.
const observing = (el: AxSurface) => services().triggers.has(el) || !!el.shadowRoot!.querySelector('.ax-typed-om-c');
const hasDetector = (el: AxSurface) => !!el.shadowRoot!.querySelector('.ax-typed-om-c');

// Count every rAF the page schedules, to prove the scheduler sleeps when idle.
const probes: { [id: string]: { appearance: boolean; tilt: boolean; fallback: boolean }[] } = {};

let rafCalls = 0;
const rawRaf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    rafCalls++;
    return rawRaf(cb);
};

async function run() {
    // A layer that only follows the pointer, like reveal does.
    registerLayer('pointer-probe', () => ({ tracksPointer: true, attach() {}, detach() {}, write: () => false }));
    // A layer that paints outside the shape, like a shadow, by as much as the --halo-* properties say.
    const haloLength = (name: string) => ({ name, syntax: { type: 'length' as const }, initial: '0px', inherits: false });
    registerLayer('halo', () => ({
        schema: [haloLength('--halo-top'), haloLength('--halo-x'), haloLength('--halo-bottom')],
        static: true,
        overflow: (v) => [v.length('--halo-top'), v.length('--halo-x'), v.length('--halo-bottom'), v.length('--halo-x')],
        attach() {},
        detach() {},
        write: () => false,
    }));
    // A layer that records what each frame tells it about the appearance and the tilt.
    registerLayer('appearance-probe', () => {
        let id = '';
        return {
            static: true,
            attach(container) {
                id = ((container.getRootNode() as ShadowRoot).host as HTMLElement).id;
            },
            detach() {},
            write(frame) {
                const log = probes[id] || (probes[id] = []);
                log.push({ appearance: frame.changed.appearance, tilt: frame.changed.tilt, fallback: frame.appearance.alwaysUseFallback });
                return false;
            },
        };
    });
    register();
    await frames(4);
    const a = byId('a');

    // 1. Output equals the shape package for the same values.
    const st = a.debugState;
    const expected = toSvgPath(resolve(shapeSpecFrom(st.values!, 160, 60), { borderWidths: borderWidthsFrom(st.values!) }).outline);
    check('fill path matches resolve()', fillPath(a) === expected && expected.length > 0, fillPath(a).slice(0, 60));

    // 1b. A layer's overflow grows the paint box per side.
    {
        const sh = byId('sh');
        const p = sh.debugState.paint;
        check('layer overflow grows the paint box', p.left === -15 && p.top === -9 && p.width === 130 && p.height === 50 + 9 + 21, JSON.stringify(p));
        const layers = sh.shadowRoot!.querySelector('.layers') as HTMLElement;
        check('the layer box takes the paint box', layers.className === 'layers box' && layers.style.top === '-9px', layers.className + ' ' + layers.style.cssText);
    }

    // 1c. Shared edge properties apply to every side unless a side sets its own, and a
    // transition of a shared property reaches the sides frame by frame.
    {
        const e = byId('e');
        const sides = ['top', 'right', 'bottom', 'left'];
        const read = () => sides.map((s) => `${e.debugState.values!.keyword(`--ax-edge-${s}-kind`)} ${e.debugState.values!.length(`--ax-edge-${s}-depth`)}`).join(', ');
        e.classList.add('shared');
        await frames(4);
        check('shared edge properties reach every side', read() === 'arc -10, arc -10, arc -10, arc -10', read());
        e.classList.add('top');
        await frames(4);
        check('a side property wins over the shared one', read() === 'arc 6, arc -10, arc -10, arc -10', read());
        e.classList.remove('top');
        e.classList.add('grow');
        const depths = new Set<number>();
        const start = performance.now();
        while (performance.now() - start < 550) {
            await frames(1);
            depths.add(e.debugState.values!.length('--ax-edge-right-depth'));
        }
        const between = [...depths].filter((d) => d < -10.5 && d > -29.5).length;
        check('a shared transition animates the sides', between >= 3 && depths.has(-30), `between=${between} values=${[...depths].map((d) => d.toFixed(1)).join(' ')}`);
        e.className = '';
        await frames(4);
        check('removing the shared properties restores flat sides', read() === 'flat 0, flat 0, flat 0, flat 0', read());
        e.classList.add('corners');
        await frames(4);
        const shoulders = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((c) => e.debugState.values!.length(`--ax-corner-${c}-shoulder-radius`)).join(' ');
        check('shared corner shoulder radius, one corner overridden', shoulders === '7 3 7 7', shoulders);
        e.className = '';
        await frames(4);
    }

    // 1d. clip cuts the content to the shape: a corner outside the rounding hits nothing of it.
    {
        const cl = byId('cl');
        await frames(4);
        const r = cl.getBoundingClientRect();
        const hit = (x: number, y: number) => document.elementFromPoint(r.left + x, r.top + y);
        const content = byId('clc');
        check('clip cuts the content to the shape', hit(2, 2) !== content && hit(50, 30) === content, `${hit(2, 2) && (hit(2, 2) as Element).id}`);
        cl.removeAttribute('clip');
        await frames(4);
        check('without clip the content is whole', hit(2, 2) === content);
    }

    // 2. Ancestor class change is picked up.
    const before = fillPath(a);
    document.body.classList.add('theme');
    await frames(4);
    check('ancestor class change re-renders', fillPath(a) !== before && fillPath(a).indexOf('A') < 0, fillPath(a).slice(0, 60));
    document.body.classList.remove('theme');
    await frames(4);
    check('class removal restores', fillPath(a) === before);

    // 3. :hover through real pointer input.
    const h = byId('h');
    const hoverBefore = fillPath(h);
    await ask('hover-h');
    check(':hover change re-renders', fillPath(h) !== hoverBefore);
    await ask('leave');
    check(':hover end restores', fillPath(h) === hoverBefore);

    // 4. Only visible surfaces observe.
    const far = byId('far');
    check('offscreen surface does not observe', !observing(far) && observing(a));
    far.scrollIntoView();
    await frames(6);
    check('surface observes after scrolling into view', observing(far));
    check('scrolled-out surface stops observing', !observing(a));
    window.scrollTo(0, 0);
    await frames(6);

    // 5. Tilt on press, released back to flat.
    const t = byId('t');
    await ask('press-t');
    // The tilt goes on the content and on each layer container, not on a common parent.
    const content = t.shadowRoot!.querySelector('.content') as HTMLElement;
    const fillBox = t.shadowRoot!.querySelector('.layer-fill') as HTMLElement;
    const tiltBox = t.shadowRoot!.querySelector('.tilt') as HTMLElement;
    // Gecko tilts with the closest 2D transform: a 3D one anywhere turns acrylic clear.
    check('pressed surface tilts', content.style.transform.indexOf(geckoTest ? 'matrix(' : 'rotateX') >= 0, content.style.transform);
    check('layer containers tilt with the content', fillBox.style.transform === content.style.transform && getComputedStyle(fillBox).display === 'block', fillBox.style.transform);
    check('no common tilted parent', getComputedStyle(tiltBox).transform === 'none', getComputedStyle(tiltBox).transform);
    // Pointer mapping under tilt: projecting the local point lands on the pointer.
    const s = t.debugState;
    const rect = t.getBoundingClientRect();
    const tiltState = s.tilt;
    if (s.local && tiltState) {
        const { tiltHomography } = await import('@ax-design/shape');
        const screen = apply(tiltHomography(tiltState), { x: s.local.x, y: s.local.y });
        // Compare with the coordinates the event carried; some engines round them.
        const pointer = services().pointer;
        const err = Math.hypot(screen.x + rect.left - pointer.x, screen.y + rect.top - pointer.y);
        check('local pointer maps back to the screen pointer', err < 0.5, `err=${err.toFixed(3)}`);
    } else {
        check('local pointer maps back to the screen pointer', false, 'no local pointer or tilt');
    }
    // release() ends the press while the pointer is still down (a container took the gesture).
    t.release();
    await frames(8);
    check('release() returns the surface flat while pressed', content.style.transform === '', content.style.transform);
    await ask('release');
    await frames(8);
    // A surface that can tilt keeps the boxes of its layer containers: one made or dropped while
    // it tilts turns acrylic next to it clear in Firefox.
    check('released surface returns flat and keeps its boxes', content.style.transform === '' && fillBox.style.transform === '' && getComputedStyle(fillBox).display === 'block', `${content.style.transform} ${getComputedStyle(fillBox).display}`);
    t.style.setProperty('--ax-tilt-mode', 'off');
    await frames(8);
    check('a surface that does not tilt has no container boxes', getComputedStyle(fillBox).display === 'contents', getComputedStyle(fillBox).display);
    t.style.removeProperty('--ax-tilt-mode');
    await frames(8);

    // 4b. With a paint box larger than the element (a halo), the layer containers cover the
    // paint box and still turn around the element's center: the drawing lands where the tilt
    // homography puts the paint box.
    {
        const sh = byId('sh');
        sh.style.setProperty('--ax-tilt-mode', 'absolute');
        sh.style.setProperty('--ax-tilt-depth', '30px');
        // A paint box far off center, so a wrong origin shows.
        sh.style.setProperty('--halo-bottom', '55px');
        sh.style.setProperty('--ax-tilt-perspective', '300px');
        await frames(4);
        await ask('press-sh');
        await frames(8);
        const state = sh.debugState;
        const fill = sh.shadowRoot!.querySelector('.layer-fill') as HTMLElement;
        if (state.tilt) {
            const host = sh.getBoundingClientRect();
            const got = fill.getBoundingClientRect();
            const p = state.paint;
            // Gecko: the 2D transform written, around the element center.
            const m = /matrix\(([^)]*)\)/.exec(fill.style.transform);
            const [ma, mb, mc, md, me, mf] = m ? m[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
            const cx = host.width / 2;
            const cy = host.height / 2;
            const H = tiltHomography(state.tilt);
            const map = (q: { x: number; y: number }) => {
                if (!geckoTest) return apply(H, q);
                const x = q.x - cx;
                const y = q.y - cy;
                return { x: ma * x + mc * y + me + cx, y: mb * x + md * y + mf + cy };
            };
            const pts = [
                { x: p.left, y: p.top },
                { x: p.left + p.width, y: p.top },
                { x: p.left + p.width, y: p.top + p.height },
                { x: p.left, y: p.top + p.height },
            ].map(map);
            const xs = pts.map((q) => q.x + host.left);
            const ys = pts.map((q) => q.y + host.top);
            const err = Math.max(
                Math.abs(Math.min(...xs) - got.left),
                Math.abs(Math.max(...xs) - got.right),
                Math.abs(Math.min(...ys) - got.top),
                Math.abs(Math.max(...ys) - got.bottom)
            );
            check('tilted paint box turns around the element center', err < 0.5, `err=${err.toFixed(3)}`);
        } else {
            check('tilted paint box turns around the element center', false, 'no tilt');
        }
        await ask('release');
        await frames(8);
        for (const name of ['mode', 'depth', 'perspective']) sh.style.removeProperty(`--ax-tilt-${name}`);
        sh.style.setProperty('--halo-bottom', '21px');
    }

    // 5a. Nested surfaces: with the outer one tilted, the inner one maps the pointer through
    // the outer tilt (its bounding rect is the box around a projected quad by then).
    await ask('press-outer');
    await ask('move-inner');
    {
        const outer = byId('outer');
        const inner = byId('inner');
        const os = outer.debugState;
        const is = inner.debugState;
        const pointer = services().pointer;
        const or = outer.getBoundingClientRect();
        if (os.tilt && is.local) {
            const { tiltHomography } = await import('@ax-design/shape');
            // Inner local -> outer plane (offset of the inner box inside the outer one at rest).
            const offset = (inner as any).offsetInParent as { x: number; y: number };
            const screen = apply(tiltHomography(os.tilt), { x: is.local.x + offset.x, y: is.local.y + offset.y });
            const err = Math.hypot(screen.x + or.left - pointer.x, screen.y + or.top - pointer.y);
            check('nested surface maps the pointer through the outer tilt', err < 0.5, `err=${err.toFixed(3)}`);
        } else {
            check('nested surface maps the pointer through the outer tilt', false, `tilt=${!!os.tilt} local=${!!is.local}`);
        }
    }
    await ask('release');
    await frames(8);

    // 5b. Precise mode attaches a detector; default mode does not.
    check('precise surface has a detector', hasDetector(byId('p')) && !hasDetector(a));
    const pBefore = fillPath(byId('p'));
    byId('p').style.setProperty('--ax-radius', '18px');
    await frames(4);
    check('precise surface sees an inline style change', fillPath(byId('p')) !== pBefore);

    // 5c. Author transition on a custom property is followed frame by frame.
    const m = byId('m');
    const seen = new Set<string>();
    m.classList.add('big');
    const start = performance.now();
    while (performance.now() - start < 450) {
        await frames(1);
        seen.add(fillPath(m));
    }
    const finalPath = fillPath(m);
    m.classList.remove('big');
    await frames(1);
    m.style.transition = 'none';
    m.classList.add('big');
    await frames(4);
    check('author transition renders intermediate frames', seen.size >= 4, `distinct=${seen.size}`);
    check('author transition ends at the final shape', finalPath === fillPath(m));
    m.style.transition = '';

    // 5d. :checked through :has(), no attribute changes.
    const c = byId('c');
    const cBefore = fillPath(c);
    await ask('click-cb');
    check(':has(:checked) change re-renders', fillPath(c) !== cBefore);

    // 5e. A surface moved into view by a :hover layout change (no scroll, no mutation).
    const shifted = byId('s');
    const tracked = () => services().triggers.has(shifted);
    check('surface below the fold is not tracked', !tracked());
    await ask('hover-pusher');
    await new Promise((r) => setTimeout(r, 500));
    await frames(4);
    check('hover-driven layout shift makes it visible', tracked() && fillPath(shifted).length > 0);
    await ask('leave');

    // 6. Idle: no animation frames at all.
    // Let the visibility round that follows the last pointer activity (300 ms) settle first.
    await new Promise((r) => setTimeout(r, 600));
    await frames(5);
    rafCalls = 0;
    await new Promise((r) => setTimeout(r, 400));
    check('idle page schedules no frames', rafCalls === 0, `rafCalls=${rafCalls}`);

    // 7. Disconnect and reconnect.
    const parent = a.parentNode!;
    parent.removeChild(a);
    await frames(3);
    parent.insertBefore(a, parent.firstChild);
    await frames(5);
    check('reconnected surface renders again', fillPath(a) === before && observing(a));

    // 8. No text selection and no native drag under a surface, unless asked for.
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = 'link';
    const own = document.createElement('span');
    own.draggable = true;
    a.append(link, own);
    const drag = (el: Element) => {
        const e = new Event('dragstart', { bubbles: true, cancelable: true });
        el.dispatchEvent(e);
        return e.defaultPrevented;
    };
    check('a link in a surface is not dragged', drag(link));
    check('draggable="true" in a surface still drags', !drag(own));
    const select = getComputedStyle(a).userSelect || (getComputedStyle(a) as unknown as Record<string, string>).webkitUserSelect;
    check('a surface selects no text', select === 'none', select);
    link.remove();
    own.remove();

    // 9. Appearance: the focus ring, forced colors, the page's fallback and reduced motion.
    {
        const fr = byId('fr');
        const ring = () => fr.shadowRoot!.querySelector('.layer-focus svg') as SVGSVGElement;
        const forcedOk = () => matchMedia('(forced-colors: active)').matches;
        check('no focus ring without focus', ring().style.display === 'none', ring().style.display);
        await ask('tab-to-fb');
        const fb = document.getElementById('fb');
        if (document.activeElement === fb && fb!.matches(':focus-visible')) {
            check('focus ring shows for keyboard focus', ring().style.display === '', ring().style.display);
            const outline = fillPath(fr);
            const paths = Array.from(ring().querySelectorAll('mask path'));
            check('focus ring follows the shape', paths.length === 4 && paths.every((p) => p.getAttribute('d') === outline), outline.slice(0, 40));
            // Bands of 0-1 px (secondary) and 1-3 px (primary) outside the outline.
            const widths = paths.map((p) => p.getAttribute('stroke-width')).join(',');
            check('focus ring bands are 1 px and 2 px wide', widths === '2,0,6,2', widths);
            const fills = Array.from(ring().querySelectorAll('rect')).map((r) => r.getAttribute('fill')).join(' | ');
            check('focus ring takes the Windows colors', fills === 'rgba(255, 255, 255, 0.6) | rgba(0, 0, 0, 1)', fills);

            await ask('media:forcedColors=active');
            if (forcedOk()) {
                await frames(3);
                const forcedFills = Array.from(ring().querySelectorAll('rect')).map((r) => r.getAttribute('fill')).join(' | ');
                check('forced colors: focus ring in Canvas and CanvasText', forcedFills === 'Canvas | CanvasText', forcedFills);
                const fillEl = fr.shadowRoot!.querySelectorAll('.layer-fill path')[1];
                const strokeEl = fr.shadowRoot!.querySelectorAll('.layer-fill path')[2];
                check('forced colors: fill turns Canvas, keeping its alpha', fillEl.getAttribute('fill') === 'Canvas' && fillEl.getAttribute('fill-opacity') === '1', `${fillEl.getAttribute('fill')} ${fillEl.getAttribute('fill-opacity')}`);
                check('forced colors: border turns CanvasText', strokeEl.getAttribute('stroke') === 'CanvasText', String(strokeEl.getAttribute('stroke')));
                check('forced colors reach appearance()', appearance().forcedColors);
                await ask('media:forcedColors=none');
                await frames(3);
                check('leaving forced colors restores the fill', fillEl.getAttribute('fill') === 'rgba(255, 255, 255, 1)', String(fillEl.getAttribute('fill')));
            }

            fb!.blur();
            await frames(3);
            check('focus ring hides when focus leaves', ring().style.display === 'none', ring().style.display);
        } else {
            check('keyboard focus reaches the button', false, String(document.activeElement && document.activeElement.id));
        }

        // The page's fallback reaches every visible surface, observe="precise" ones too, in a
        // frame that says so even though no style value changed.
        for (const id of ['fr', 'pp']) probes[id] = [];
        setAlwaysUseFallback(true);
        await frames(3);
        for (const id of ['fr', 'pp']) {
            const log = probes[id] || [];
            check(`setAlwaysUseFallback reaches #${id}`, log.some((f) => f.appearance && f.fallback), JSON.stringify(log));
        }
        setAlwaysUseFallback(false);
        await frames(3);

        // Reduced motion: the tilt takes its target in one frame instead of a 50 ms tween.
        const tiltFrames = async () => {
            probes.tm = [];
            await ask('press-at:tm');
            const pressed = probes.tm.filter((f) => f.tilt).length;
            await ask('release');
            await frames(3);
            return pressed;
        };
        const tweened = await tiltFrames();
        await ask('media:reducedMotion=reduce');
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
            const jumped = await tiltFrames();
            check('reduced motion: the tilt jumps to its target', tweened > 1 && jumped === 1, `tween ${tweened} frames, reduced ${jumped}`);
            await ask('media:reducedMotion=null');
        }
    }

    return { userAgent: navigator.userAgent, checks };
}

run().then(
    (r) => (window.__result = r),
    (e) => (window.__result = { error: String((e && e.stack) || e) })
);
