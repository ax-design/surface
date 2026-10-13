// The new stack: <ax-surface layers="fill"> with the full read, detect and render pipeline.
import { StyleBinding } from '@ax-design/typed-om';
import { CORE_SCHEMA, register } from '../src/index.js';
import type { BenchImpl } from './types.ts';

export const surface: BenchImpl = {
    setup() {
        // Experiment switches: ?variant=no-detect | inherit
        const variant = new URLSearchParams(location.search).get('variant');
        if (variant === 'no-detect') StyleBinding.prototype.observe = function () {};
        if (variant === 'inherit') for (const spec of CORE_SCHEMA) spec.inherits = true;
        if (variant === 'unregistered') (CSS as unknown as { registerProperty?: unknown }).registerProperty = undefined;
        register();
    },
    mount(root, count) {
        const grid = document.createElement('div');
        grid.className = 'grid';
        for (let i = 0; i < count; i++) {
            const s = document.createElement('ax-surface');
            s.setAttribute('layers', 'fill');
            const button = document.createElement('button');
            button.className = 'btn';
            button.textContent = `Item ${i}`;
            s.appendChild(button);
            grid.appendChild(s);
        }
        root.appendChild(grid);
        // Ready once every visible surface drew its path.
        return new Promise((resolve) => {
            const check = () => {
                const pending = Array.prototype.some.call(grid.children, (s: Element) => {
                    const r = s.getBoundingClientRect();
                    if (r.bottom < 0 || r.top > innerHeight) return false;
                    const path = s.shadowRoot && s.shadowRoot.querySelector('.layer-fill path');
                    return !path || !path.getAttribute('d');
                });
                if (pending) requestAnimationFrame(check);
                else resolve();
            };
            requestAnimationFrame(check);
        });
    },
    pointerTarget(root) {
        return root.firstElementChild as HTMLElement;
    },
};
