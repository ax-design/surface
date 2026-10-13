// Browser checks for <ax-surface>. Some steps need real input; the driver performs them when
// window.__step asks for it and answers through window.__ack.
import { apply, resolve, toSvgPath } from '@ax-design/shape';
import { register, services, shapeSpecFrom, borderWidthsFrom } from '../src/index.js';
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

const byId = (id: string) => document.getElementById(id) as AxSurface;
const fillPath = (el: AxSurface) => el.shadowRoot!.querySelector('.layer-fill path')!.getAttribute('d') || '';
// Default surfaces register with the shared triggers; precise ones carry a detector.
const observing = (el: AxSurface) => services().triggers.has(el) || !!el.shadowRoot!.querySelector('.ax-typed-om-c');
const hasDetector = (el: AxSurface) => !!el.shadowRoot!.querySelector('.ax-typed-om-c');

// Count every rAF the page schedules, to prove the scheduler sleeps when idle.
let rafCalls = 0;
const rawRaf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    rafCalls++;
    return rawRaf(cb);
};

async function run() {
    register();
    await frames(4);
    const a = byId('a');

    // 1. Output equals the shape package for the same values.
    const st = a.debugState;
    const expected = toSvgPath(resolve(shapeSpecFrom(st.values!, 160, 60), { borderWidths: borderWidthsFrom(st.values!) }).outline);
    check('fill path matches resolve()', fillPath(a) === expected && expected.length > 0, fillPath(a).slice(0, 60));

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
    const tiltBox = t.shadowRoot!.querySelector('.tilt') as HTMLElement;
    check('pressed surface tilts', tiltBox.style.transform.indexOf('rotateX') >= 0, tiltBox.style.transform);
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
    await ask('release');
    await frames(8);
    check('released surface returns flat', tiltBox.style.transform === '', tiltBox.style.transform);

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

    // 6. Idle: no animation frames at all.
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

    return { userAgent: navigator.userAgent, checks };
}

run().then(
    (r) => (window.__result = r),
    (e) => (window.__result = { error: String((e && e.stack) || e) })
);
