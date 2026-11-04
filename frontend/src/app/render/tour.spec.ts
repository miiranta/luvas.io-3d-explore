import { tourPath, viewAt } from './tour';

/** Cameras on a circle looking at its centre. */
function ring(n: number): number[][] {
    return Array.from({ length: n }, (_, i) => {
        const a = (2 * Math.PI * i) / n;
        const c = [2 * Math.cos(a), 1.5, 2 * Math.sin(a)];
        const f = [-Math.cos(a), 0, -Math.sin(a)];
        return [...c, 0, 0, 0, 0, 1, 0, ...f];
    });
}

describe('tour', () => {
    it('keeps one view per camera, behind and above it, looking forward', () => {
        const path = tourPath(ring(100));
        expect(path.length).toBe(100);
        for (const view of path) {
            expect(Math.hypot(...view.forward)).toBeCloseTo(1, 6);
            expect(view.eye[1]).toBeCloseTo(1.75, 6);
        }
    });

    it('interpolates between the first and the last view', () => {
        const path = tourPath(ring(60));
        expect(viewAt(path, 0).eye).toEqual(path[0].eye);
        viewAt(path, 1).eye.forEach((v, a) => expect(v).toBeCloseTo(path[59].eye[a], 9));
        expect(Math.hypot(...viewAt(path, 0.37).forward)).toBeCloseTo(1, 6);
    });
});
