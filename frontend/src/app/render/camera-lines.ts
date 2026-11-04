import { POSE_STRIDE } from '../core/models/scene';
import { ColoredGeometry } from './gl-scene';

const CAMERA_COLOR = [255, 159, 28, 255];
const PATH_COLOR = [255, 93, 143, 255];
const BOX_COLOR = [255, 201, 60, 255];

function lines(segments: number[][], color: number[]): ColoredGeometry {
    const positions = new Float32Array(segments.length * 3);
    const colors = new Uint8Array(segments.length * 4);
    segments.forEach((p, i) => {
        positions.set(p, i * 3);
        colors.set(color, i * 4);
    });
    return { positions, colors, channels: 4 };
}

/**
 * Pyramid (apex at the centre, image plane at `depth`, with an "up" tick) of every `every`-th
 * pose, so a dense capture does not hide the room.
 */
export function cameraLines(
    poses: number[][],
    fovY: number,
    aspect: number,
    depth: number,
    every = 1,
): ColoredGeometry {
    const halfH = depth * Math.tan(fovY / 2);
    const halfW = halfH * aspect;
    const segments: number[][] = [];
    for (let i = 0; i < poses.length; i += every) {
        const pose = poses[i];
        if (pose.length !== POSE_STRIDE) throw new Error('pose with wrong stride');
        const c = pose.slice(0, 3);
        const right = pose.slice(3, 6);
        const up = pose.slice(6, 9);
        const forward = pose.slice(9, 12);
        const at = (x: number, y: number) =>
            [0, 1, 2].map((a) => c[a] + forward[a] * depth + right[a] * x + up[a] * y);
        const corners = [
            at(-halfW, halfH),
            at(halfW, halfH),
            at(halfW, -halfH),
            at(-halfW, -halfH),
        ];
        for (let k = 0; k < 4; k++) segments.push(c, corners[k], corners[k], corners[(k + 1) % 4]);
        const tip = at(0, halfH * 1.6);
        segments.push(corners[0], tip, tip, corners[1]);
    }
    return lines(segments, CAMERA_COLOR);
}

/** The capture path through the camera centres. */
export function pathLines(poses: number[][]): ColoredGeometry {
    const segments: number[][] = [];
    for (let i = 1; i < poses.length; i++) {
        segments.push(poses[i - 1].slice(0, 3), poses[i].slice(0, 3));
    }
    return lines(segments, PATH_COLOR);
}

/** The 12 edges of the room box. */
export function boxLines(min: number[], max: number[]): ColoredGeometry {
    const corner = (i: number) => [
        i & 1 ? max[0] : min[0],
        i & 2 ? max[1] : min[1],
        i & 4 ? max[2] : min[2],
    ];
    const segments: number[][] = [];
    for (let i = 0; i < 8; i++) {
        for (const bit of [1, 2, 4]) {
            if (!(i & bit)) segments.push(corner(i), corner(i | bit));
        }
    }
    return lines(segments, BOX_COLOR);
}
