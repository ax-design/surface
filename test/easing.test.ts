import { expect, test } from 'bun:test';
import { WINDOWS_EASINGS, bezierAt, parseEasing, windowsEasing } from '../src/easing.js';

test('the Windows curves come out as CSS', () => {
    expect(windowsEasing(54)).toBe('cubic-bezier(0, 0.5, 0.5, 1)');
    expect(Object.keys(WINDOWS_EASINGS).length).toBe(20);
    expect(() => windowsEasing(55)).toThrow();
});

test('bezierAt meets the ends and the linear curve', () => {
    for (const id of Object.keys(WINDOWS_EASINGS)) {
        const b = WINDOWS_EASINGS[Number(id)];
        expect(bezierAt(b, 0)).toBe(0);
        expect(bezierAt(b, 1)).toBe(1);
    }
    for (const t of [0.1, 0.25, 0.5, 0.9]) expect(Math.abs(bezierAt([0, 0, 1, 1], t) - t)).toBeLessThan(1e-6);
});

test('bezierAt matches known values of ease', () => {
    // CSS `ease` at 0.5 is about 0.8024.
    expect(Math.abs(bezierAt([0.25, 0.1, 0.25, 1], 0.5) - 0.8024)).toBeLessThan(1e-3);
    // A strong ease-out is far ahead of linear early on.
    expect(bezierAt(WINDOWS_EASINGS[54], 0.2)).toBeGreaterThan(0.5);
});

test('parseEasing reads keywords and cubic-bezier(), and nothing else', () => {
    expect(parseEasing('linear')).toEqual([0, 0, 1, 1]);
    expect(parseEasing(' cubic-bezier(0.1, 0.9, 0.2, 1) ')).toEqual([0.1, 0.9, 0.2, 1]);
    expect(parseEasing('cubic-bezier(0.35, 2.2, 0.5, 1)')).toEqual([0.35, 2.2, 0.5, 1]);
    expect(parseEasing('cubic-bezier(1.5, 0, 0, 1)')).toBeNull();
    expect(parseEasing('steps(4)')).toBeNull();
    expect(parseEasing('')).toBeNull();
});
