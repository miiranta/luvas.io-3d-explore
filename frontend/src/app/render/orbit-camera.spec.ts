import { OrbitCamera, cutawayFor, isCutAway, pickMesh, pickPoints } from './orbit-camera';

const min = [-3, 0, -2];
const max = [3, 2.6, 2];

describe('orbit camera', () => {
    it('look() puts the eye where asked, facing the given direction', () => {
        const camera = new OrbitCamera();
        const forward = [0.6, -0.2, -Math.sqrt(1 - 0.36 - 0.04)];
        camera.look([1, 1.4, 0.5], forward);
        const eye = camera.eye();
        [1, 1.4, 0.5].forEach((v, a) => expect(eye[a]).toBeCloseTo(v, 6));
        const d = camera.target.map((v, a) => v - eye[a]);
        const length = Math.hypot(d[0], d[1], d[2]);
        forward.forEach((v, a) => expect(d[a] / length).toBeCloseTo(v, 6));
    });

    it('frames a room from above', () => {
        const camera = new OrbitCamera();
        camera.frame(min, max);
        const eye = camera.eye();
        expect(eye[1]).toBeGreaterThan(max[1]);
        expect(Math.hypot(eye[0], eye[2])).toBeGreaterThan(3);
    });
});

describe('cutaway', () => {
    it('cuts the ceiling and the wall facing an outside eye, nothing else', () => {
        const cut = cutawayFor([0, 5, 10], min, max);
        expect(cut.direction[1]).toBeCloseTo(1, 6);
        expect(isCutAway([0, 2.55, 0], 0, cut)).toBe(true);
        expect(isCutAway([0, 1, 1.9], 0, cut)).toBe(true);
        expect(isCutAway([0, 0.1, 1.9], 0, cut)).toBe(false);
        expect(isCutAway([0, 1, -1.9], 0, cut)).toBe(false);
    });

    it('keeps every wall when the eye is inside the room', () => {
        const cut = cutawayFor([0.5, 1.5, 0.5], min, max);
        expect(cut.direction).toEqual([0, 0]);
        expect(isCutAway([0, 1, 1.9], 0, cut)).toBe(false);
        expect(isCutAway([0, 2.55, 0], 0, cut)).toBe(true);
    });
});

describe('picking', () => {
    it('finds the nearest point near the ray and skips cut points', () => {
        const positions = Float32Array.from([0, 1, -1, 0, 1, -3, 0.5, 1, -2, 0, 2.55, -1.5]);
        const hit = pickPoints(positions, [0, 1, 0], [0, 0, -1], 0.01, null);
        expect(hit).toEqual([0, 1, -1]);
        const down = pickPoints(positions, [0, 3, -1.5], [0, -1, 0], 0.01, null);
        expect(down?.[1]).toBeCloseTo(2.55, 5);
        const cut = cutawayFor([0, 1.5, 0], min, max);
        expect(pickPoints(positions, [0, 3, -1.5], [0, -1, 0], 0.01, cut)).toBeNull();
    });

    it('hits a triangle', () => {
        const positions = Float32Array.from([-1, 0, -1, 1, 0, -1, 0, 0, 1]);
        const hit = pickMesh(positions, Uint32Array.from([0, 1, 2]), [0, 2, 0], [0, -1, 0], null);
        expect(hit).not.toBeNull();
        expect(hit![1]).toBeCloseTo(0, 6);
        expect(
            pickMesh(positions, Uint32Array.from([0, 1, 2]), [5, 2, 0], [0, -1, 0], null),
        ).toBeNull();
    });
});
