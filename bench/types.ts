export type BorderDetectionMode = 'strictEdge' | 'experimentalAutoFit';

export interface BenchImpl {
    setup(mode: BorderDetectionMode): void;
    // Builds `count` interactive items under `root`. Resolves once the implementation has
    // registered all of them.
    mount(root: HTMLElement, count: number): Promise<void>;
    // Element that receives pointer events in strictEdge mode.
    pointerTarget(root: HTMLElement): HTMLElement;
    // Called right after the toggle scenario flips the theme class.
    afterToggle?(): void;
}

export interface FrameStats {
    frames: number;
    workP50: number;
    workP95: number;
    workMax: number;
    workTotal: number;
    intervalP50: number;
    intervalP95: number;
    slowFrames: number;
}

export interface BenchResult {
    impl: string;
    scenario: string;
    mode: BorderDetectionMode;
    count: number;
    userAgent: string;
    isolated?: boolean;
    mountMs?: number;
    sweep?: FrameStats;
    toggleWorkMs?: number;
    toggleFlushMs?: number;
    probe?: { reads: number; readMs: number; elements: number; slowPath: number };
    error?: string;
}
