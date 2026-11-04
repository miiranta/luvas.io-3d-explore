import { decodeCloud, decodeMesh, dequantize } from './scene-format';

/** Same quantization as tools/build-scenes.mjs. */
function quantize(positions: number[], min: number[], max: number[]): Uint16Array {
    return Uint16Array.from(positions, (v, i) =>
        Math.round(((v - min[i % 3]) / (max[i % 3] - min[i % 3])) * 65535),
    );
}

describe('scene format', () => {
    const min = [-2.9, 0, -2.5];
    const max = [2.9, 2.6, 2.6];
    const positions = [-2.9, 0, -2.5, 2.9, 2.6, 2.6, 0.1234, 1.5, -0.75];

    it('dequantizes 16-bit positions to within a tenth of a millimetre', () => {
        const back = dequantize(quantize(positions, min, max), min, max);
        positions.forEach((v, i) => expect(Math.abs(back[i] - v)).toBeLessThan(1e-4));
    });

    it('decodes a cloud (positions block, then RGB)', () => {
        const q = quantize(positions, min, max);
        const colors = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255]);
        const buffer = new Uint8Array(q.byteLength + colors.byteLength);
        buffer.set(new Uint8Array(q.buffer), 0);
        buffer.set(colors, q.byteLength);
        const cloud = decodeCloud(buffer.buffer, { file: 'c.bin', count: 3, min, max });
        expect(cloud.positions.length).toBe(9);
        expect(Array.from(cloud.colors)).toEqual(Array.from(colors));
        expect(() =>
            decodeCloud(new ArrayBuffer(10), { file: 'c.bin', count: 3, min, max }),
        ).toThrow();
    });

    it('decodes a mesh and rejects indices out of range', () => {
        const q = quantize(positions, min, max);
        const colors = new Uint8Array(9).fill(128);
        const indexOffset = Math.ceil((q.byteLength + colors.byteLength) / 4) * 4;
        const layer = { file: 'm.bin', vertices: 3, triangles: 1, indexOffset, min, max };
        const buffer = new ArrayBuffer(indexOffset + 12);
        new Uint8Array(buffer).set(new Uint8Array(q.buffer), 0);
        new Uint8Array(buffer).set(colors, q.byteLength);
        new Uint32Array(buffer, indexOffset, 3).set([0, 1, 2]);
        expect(Array.from(decodeMesh(buffer, layer).indices)).toEqual([0, 1, 2]);
        new Uint32Array(buffer, indexOffset, 3).set([0, 1, 3]);
        expect(() => decodeMesh(buffer, layer)).toThrow();
    });
});
