import { boxLines, cameraLines, pathLines } from './camera-lines';

const pose = [1, 1.5, 2, 1, 0, 0, 0, 1, 0, 0, 0, -1];

describe('camera lines', () => {
    it('draws a pyramid with its apex at the centre and the image plane ahead', () => {
        const lines = cameraLines([pose], Math.PI / 3, 16 / 9, 0.2);
        const points = lines.positions.length / 3;
        expect(points).toBe(20);
        expect(Array.from(lines.positions.slice(0, 3))).toEqual([1, 1.5, 2]);
        expect(lines.positions[5]).toBeCloseTo(2 - 0.2, 6);
        expect(lines.positions[4]).toBeCloseTo(1.5 + 0.2 * Math.tan(Math.PI / 6), 6);
    });

    it('draws every n-th pose only', () => {
        expect(cameraLines([pose, pose, pose, pose, pose], 1, 1, 0.2, 2).positions.length / 3).toBe(
            60,
        );
    });

    it('joins consecutive camera centres', () => {
        const other = [...pose];
        other[0] = 3;
        expect(pathLines([pose, other, pose]).positions.length).toBe(4 * 3);
    });

    it('draws the 12 edges of the room box', () => {
        expect(boxLines([0, 0, 0], [1, 2, 3]).positions.length).toBe(24 * 3);
    });
});
