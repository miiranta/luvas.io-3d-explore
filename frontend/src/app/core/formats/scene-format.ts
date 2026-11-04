import { CloudLayer, Mesh, MeshLayer, PointCloud } from '../models/scene';

/** 16-bit positions over the [min, max] box back to metres. */
export function dequantize(quantized: Uint16Array, min: number[], max: number[]): Float32Array {
    const positions = new Float32Array(quantized.length);
    const scale = [0, 1, 2].map((a) => (max[a] - min[a]) / 65535);
    for (let i = 0; i < quantized.length; i++) {
        const a = i % 3;
        positions[i] = min[a] + quantized[i] * scale[a];
    }
    return positions;
}

export function decodeCloud(buffer: ArrayBuffer, layer: CloudLayer): PointCloud {
    const values = layer.count * 3;
    if (buffer.byteLength !== values * 3) {
        throw new Error(`${layer.file}: ${buffer.byteLength} bytes, expected ${values * 3}`);
    }
    return {
        positions: dequantize(new Uint16Array(buffer, 0, values), layer.min, layer.max),
        colors: new Uint8Array(buffer, values * 2, values),
    };
}

export function decodeMesh(buffer: ArrayBuffer, layer: MeshLayer): Mesh {
    const values = layer.vertices * 3;
    const expected = layer.indexOffset + layer.triangles * 12;
    if (buffer.byteLength !== expected) {
        throw new Error(`${layer.file}: ${buffer.byteLength} bytes, expected ${expected}`);
    }
    const indices = new Uint32Array(buffer, layer.indexOffset, layer.triangles * 3);
    for (const index of indices) {
        if (index >= layer.vertices) throw new Error(`${layer.file}: index ${index} out of range`);
    }
    return {
        positions: dequantize(new Uint16Array(buffer, 0, values), layer.min, layer.max),
        colors: new Uint8Array(buffer, values * 2, values),
        indices,
    };
}
