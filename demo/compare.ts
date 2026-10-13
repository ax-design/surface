import { register as registerLegacy } from '../../reveal-highlight/src/index.ts';
import { registerRevealLayer } from '../../reveal-highlight/src/surface.ts';
import { register } from '../src/index.js';

registerLegacy({ compat: false, borderDetectionMode: 'experimentalAutoFit' });
register();
registerRevealLayer();
(window as any).__ready = true;
