// Baseline: @ax-design/reveal-highlight v0.5.3, built from the sibling checkout.
import { register } from '../../reveal-highlight/src/index.ts';
import type { BenchImpl } from './types.ts';

export const legacy: BenchImpl = {
    setup(mode) {
        register({ compat: false, borderDetectionMode: mode });
    },
    mount(root, count) {
        const provider = document.createElement('ax-reveal-provider');
        const bound = document.createElement('ax-reveal-bound');
        const grid = document.createElement('div');
        grid.className = 'grid';
        for (let i = 0; i < count; i++) {
            const reveal = document.createElement('ax-reveal');
            const button = document.createElement('button');
            button.className = 'btn';
            button.textContent = `Item ${i}`;
            reveal.appendChild(button);
            grid.appendChild(reveal);
        }
        bound.appendChild(grid);
        provider.appendChild(bound);
        root.appendChild(provider);
        // Each ax-reveal joins its boundary in a setTimeout(0) after connecting.
        return new Promise((resolve) => setTimeout(resolve, 0));
    },
    pointerTarget(root) {
        return root.querySelector('ax-reveal-bound') as HTMLElement;
    },
};
