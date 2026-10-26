// Default change detection: instead of a detector per surface (precise but about 95 us per
// surface on a page-wide change), listen to the things that change styles and re-read only the
// visible surfaces they can affect. A re-read costs about 10 us and stops early when nothing
// changed.
//
// Covered: attribute and DOM changes (MutationObserver), :hover, :active, :focus and
// :focus-within (pointer and focus events), form state (change and input events), media
// queries (resize and common matchMedia features), stylesheets added, removed or loaded, author
// transitions or animations on a surface or its ancestors where the engine fires events for
// them, and running animations on the surface itself (getAnimations, for WebKit).
//
// Not covered (use observe="precise" or call refresh()): changes inside third-party shadow
// roots, selectors that depend on elements outside the mutated subtree in ways no event
// reports, author animations of inherited custom properties on ancestors in engines that fire
// no events for them (WebKit).

export interface TriggerTarget {
    // Called when the surface may have new computed styles.
    invalidateStyle(): void;
}

function composedParent(node: Node): Node | null {
    if (node.parentNode) return node.parentNode;
    const host = (node as ShadowRoot).host;
    return host || null;
}

// True when `scope` is `node` or one of its ancestors, crossing shadow boundaries.
export function composedContains(scope: Node, node: Node): boolean {
    for (let n: Node | null = node; n; n = composedParent(n)) if (n === scope) return true;
    return false;
}

function ancestors(node: Node | null): Node[] {
    const chain: Node[] = [];
    for (let n = node; n; n = composedParent(n)) chain.push(n);
    return chain.reverse();
}

// The roots of the subtrees whose :hover or :focus state changes when the state moves from
// `from` to `to`: the children of their lowest common ancestor on each side.
function changedBranches(from: Node | null, to: Node | null): Node[] {
    if (!from || !to) return [document];
    const a = ancestors(from);
    const b = ancestors(to);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (i === 0) return [document];
    const out: Node[] = [];
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
    return out;
}

const MEDIA_QUERIES = [
    '(prefers-color-scheme: dark)',
    '(prefers-reduced-motion: reduce)',
    '(prefers-reduced-transparency: reduce)',
    '(prefers-contrast: more)',
    '(forced-colors: active)',
    '(orientation: portrait)',
    '(hover: hover)',
];

// Above this many scopes in one batch, re-read every surface instead of testing containment.
const MAX_SCOPES = 16;

export class StyleTriggers {
    private targets = new Map<Node, TriggerTarget>();
    // Elements with running author transitions or animations, with a running count.
    private running = new Map<Element, number>();
    private scopes: Node[] = [];
    private all = false;
    private scheduled = false;
    private started = false;

    add(host: Node, target: TriggerTarget): void {
        this.targets.set(host, target);
        if (!this.started) this.start();
    }

    delete(host: Node): void {
        this.targets.delete(host);
    }

    has(host: Node): boolean {
        return this.targets.has(host);
    }

    // Re-read every tracked surface.
    refreshAll(): void {
        this.invalidate(document);
    }

    // True while an author transition or animation runs on the host or one of its ancestors.
    // The surface then re-reads every frame until it ends.
    isAnimating(host: Node): boolean {
        if (!this.running.size) return false;
        this.prune();
        // The host is inside a running element, or is one: its ancestors are looked up, not the running
        // elements walked for each host (a page of hundreds of surfaces and a dozen running transitions).
        for (let n: Node | null = host; n; n = composedParent(n)) if (this.running.has(n as Element)) return true;
        return false;
    }

    // Whether the running elements were checked in this frame (cleared after it, in a microtask).
    private pruned = false;

    // Drops the running elements that have no animation any more. getAnimations (2020+) corrects counts
    // when cancel events are missing, and costs a style flush, so it is asked once per frame for all the
    // surfaces and not once per surface.
    private prune(): void {
        if (this.pruned) return;
        this.pruned = true;
        Promise.resolve().then(() => {
            this.pruned = false;
        });
        this.running.forEach((_, element) => {
            if (element.getAnimations && element.getAnimations().length === 0) this.running.delete(element);
        });
    }

    private invalidate(scope: Node) {
        if (this.all) return;
        if (scope === document || scope === document.documentElement || this.scopes.length >= MAX_SCOPES) {
            this.all = true;
            this.scopes = [];
        } else if (this.scopes.indexOf(scope) < 0) {
            this.scopes.push(scope);
        }
        if (this.scheduled) return;
        this.scheduled = true;
        // Flush in a microtask: mutation records and events of one task coalesce.
        Promise.resolve().then(this.flush);
    }

    private flush = () => {
        this.scheduled = false;
        const all = this.all;
        const scopes = this.scopes;
        this.all = false;
        this.scopes = [];
        this.targets.forEach((target, host) => {
            if (all || scopes.some((s) => composedContains(s, host))) target.invalidateStyle();
        });
    };

    private start() {
        this.started = true;
        if (typeof MutationObserver !== 'undefined') {
            new MutationObserver((records) => {
                for (const r of records) {
                    // Attribute changes can affect the element, its subtree and, through sibling
                    // combinators, its siblings' subtrees: scope to the parent.
                    const t = r.target;
                    this.invalidate(composedParent(t) || t);
                }
            }).observe(document, { attributes: true, childList: true, subtree: true });
        }
        const capture = { capture: true, passive: true } as AddEventListenerOptions;
        window.addEventListener(
            'pointerover',
            (e) => {
                for (const s of changedBranches((e as PointerEvent).relatedTarget as Node | null, e.target as Node)) this.invalidate(s);
            },
            capture
        );
        window.addEventListener(
            'pointerout',
            (e) => {
                // Leaving the window: relatedTarget is null.
                if (!(e as PointerEvent).relatedTarget) this.invalidate(document);
            },
            capture
        );
        // :active covers the pressed element and all its ancestors.
        for (const type of ['pointerdown', 'pointerup', 'pointercancel']) {
            window.addEventListener(type, (e) => this.invalidate(ancestors(e.target as Node)[1] || document), capture);
        }
        window.addEventListener('focusin', (e) => {
            for (const s of changedBranches((e as FocusEvent).relatedTarget as Node | null, e.target as Node)) this.invalidate(s);
        }, true);
        window.addEventListener('focusout', (e) => {
            if (!(e as FocusEvent).relatedTarget) this.invalidate(e.target as Node);
        }, true);
        // Form state (:checked, :valid, :placeholder-shown) changes no attribute. It can match
        // through :has() anywhere above, so re-read everything; these events are user paced.
        for (const type of ['change', 'input']) document.addEventListener(type, () => this.invalidate(document), true);
        window.addEventListener('resize', () => this.invalidate(document), { passive: true });
        if (typeof matchMedia === 'function') {
            for (const q of MEDIA_QUERIES) {
                const list = matchMedia(q);
                const onChange = () => this.invalidate(document);
                // addEventListener on MediaQueryList is Safari 14+; addListener is older.
                if (list.addEventListener) list.addEventListener('change', onChange);
                else if (list.addListener) list.addListener(onChange);
            }
        }
        // Stylesheets finishing to load (insertion is a childList mutation).
        document.addEventListener(
            'load',
            (e) => {
                const t = e.target as Element;
                if (t && (t.tagName === 'LINK' || t.tagName === 'STYLE')) this.invalidate(document);
            },
            true
        );
        // Author transitions and animations on surfaces or their ancestors.
        const begin = (e: Event) => {
            const t = e.target as Element;
            this.running.set(t, (this.running.get(t) || 0) + 1);
            this.invalidate(t);
        };
        const finish = (e: Event) => {
            const t = e.target as Element;
            const n = (this.running.get(t) || 0) - 1;
            if (n > 0) this.running.set(t, n);
            else this.running.delete(t);
            this.invalidate(t);
        };
        for (const type of ['transitionrun', 'animationstart']) document.addEventListener(type, begin, true);
        for (const type of ['transitionend', 'transitioncancel', 'animationend', 'animationcancel']) document.addEventListener(type, finish, true);
    }
}
