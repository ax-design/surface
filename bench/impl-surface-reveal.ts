// <ax-surface layers="reveal">: the legacy reveal effect drawn by the surface stack.
import { registerLayer } from '@ax-design/surface';
import { createRevealLayer } from '../../reveal-highlight/src/surfaceLayer.ts';
import type { BenchImpl } from './types.ts';
import { surface } from './impl-surface.ts';

export const surfaceReveal: BenchImpl = {
    setup(mode) {
        surface.setup(mode);
        registerLayer('reveal', createRevealLayer);
    },
    mount(root, count) {
        return surface.mount(root, count, 'reveal');
    },
    pointerTarget: surface.pointerTarget,
};
