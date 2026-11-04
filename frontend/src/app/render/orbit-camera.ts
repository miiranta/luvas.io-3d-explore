import { Mat4, invert, lookAt, multiply, perspective } from './mat4';
import { Cutaway } from './gl-scene';

const FOV = (50 * Math.PI) / 180;

/** Turntable camera around a target with +y up (the rooms are gravity-aligned, floor at y = 0). */
export class OrbitCamera {
    target = [0, 0, 0];
    distance = 1;
    yaw = 0.6;
    pitch = 0.45;
    private radius = 1;

    get fov(): number {
        return FOV;
    }

    eye(): number[] {
        const c = Math.cos(this.pitch);
        return [
            this.target[0] + this.distance * c * Math.sin(this.yaw),
            this.target[1] + this.distance * Math.sin(this.pitch),
            this.target[2] + this.distance * c * Math.cos(this.yaw),
        ];
    }

    viewProjection(aspect: number): Mat4 {
        const near = Math.max(0.01, Math.min(0.1, this.distance * 0.01));
        const far = this.distance + this.radius * 4 + 1;
        return multiply(
            perspective(FOV, aspect, near, far),
            lookAt(this.eye(), this.target, [0, 1, 0]),
        );
    }

    /** Frames a box from an aerial three-quarter view. */
    frame(min: number[], max: number[]): void {
        this.target = [0, 1, 2].map((a) => (min[a] + max[a]) / 2);
        this.target[1] = min[1] + (max[1] - min[1]) * 0.25;
        this.radius = Math.max(
            0.05,
            Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2,
        );
        this.distance = (this.radius / Math.sin(FOV / 2)) * 1.05;
        this.yaw = 0.6;
        this.pitch = 0.85;
    }

    /** Places the eye at `eye` looking along `forward` (unit), keeping the orbit controls valid. */
    look(eye: number[], forward: number[], distance = 0.6): void {
        this.distance = distance;
        this.target = [0, 1, 2].map((a) => eye[a] + forward[a] * distance);
        this.pitch = Math.asin(Math.max(-1, Math.min(1, -forward[1])));
        this.yaw = Math.atan2(-forward[0], -forward[2]);
    }

    rotate(dx: number, dy: number): void {
        this.yaw -= dx * 0.008;
        this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dy * 0.008));
    }

    zoom(factor: number): void {
        this.distance = Math.max(
            this.radius * 0.02,
            Math.min(this.radius * 20, this.distance * factor),
        );
    }

    /** Moves the target in the view plane by a screen offset (pixels of a `height`-px view). */
    pan(dx: number, dy: number, height: number): void {
        const scale = (2 * this.distance * Math.tan(FOV / 2)) / height;
        const right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
        const up = [
            -Math.sin(this.pitch) * Math.sin(this.yaw),
            Math.cos(this.pitch),
            -Math.sin(this.pitch) * Math.cos(this.yaw),
        ];
        for (let a = 0; a < 3; a++) this.target[a] += (-dx * right[a] + dy * up[a]) * scale;
    }

    /** World ray through a pixel (normalised device coordinates in [−1, 1]). */
    ray(
        ndcX: number,
        ndcY: number,
        aspect: number,
    ): { origin: number[]; direction: number[] } | null {
        const inverse = invert(this.viewProjection(aspect));
        if (!inverse) return null;
        const unproject = (z: number) => {
            const v = [ndcX, ndcY, z, 1];
            const out = [0, 0, 0, 0];
            for (let r = 0; r < 4; r++) {
                out[r] =
                    inverse[r] * v[0] +
                    inverse[4 + r] * v[1] +
                    inverse[8 + r] * v[2] +
                    inverse[12 + r] * v[3];
            }
            return [out[0] / out[3], out[1] / out[3], out[2] / out[3]];
        };
        const origin = unproject(-1);
        const end = unproject(1);
        const d = [end[0] - origin[0], end[1] - origin[1], end[2] - origin[2]];
        const length = Math.hypot(d[0], d[1], d[2]);
        return { origin, direction: [d[0] / length, d[1] / length, d[2] / length] };
    }
}

/** Cutaway for an eye position: the wall cut only applies while the eye is outside the room. */
export function cutawayFor(eye: number[], min: number[], max: number[]): Cutaway {
    const center = [(min[0] + max[0]) / 2, (min[2] + max[2]) / 2];
    const half = [(max[0] - min[0]) / 2, (max[2] - min[2]) / 2];
    const dx = eye[0] - center[0];
    const dz = eye[2] - center[1];
    const inside = Math.abs(dx) < half[0] && Math.abs(dz) < half[1];
    const length = Math.hypot(dx, dz);
    return {
        room: [center[0], center[1], half[0], half[1]],
        direction: inside || length < 1e-6 ? [0, 0] : [dx / length, dz / length],
        floor: min[1],
        ceiling: max[1] - 0.12,
    };
}

/** Same rule as the shaders (CUTAWAY in gl-scene.ts). */
export function isCutAway(p: ArrayLike<number>, offset: number, cut: Cutaway | null): boolean {
    if (!cut) return false;
    const y = p[offset + 1];
    if (y > cut.ceiling) return true;
    const [dx, dz] = cut.direction;
    if (dx === 0 && dz === 0) return false;
    const along = (p[offset] - cut.room[0]) * dx + (p[offset + 2] - cut.room[1]) * dz;
    const extent = Math.abs(dx) * cut.room[2] + Math.abs(dz) * cut.room[3];
    return along > extent - 0.4 && y > cut.floor + 0.25;
}

/**
 * Nearest visible point along a ray: among the points within `angle` radians of the ray (about a
 * point's on-screen radius), the closest to the eye.
 */
export function pickPoints(
    positions: Float32Array,
    origin: number[],
    direction: number[],
    angle: number,
    cut: Cutaway | null,
): number[] | null {
    const tan = Math.tan(angle);
    const [ox, oy, oz] = origin;
    const [dx, dy, dz] = direction;
    let best = Infinity;
    let hit = -1;
    for (let i = 0; i < positions.length; i += 3) {
        const px = positions[i] - ox;
        const py = positions[i + 1] - oy;
        const pz = positions[i + 2] - oz;
        const t = px * dx + py * dy + pz * dz;
        if (t <= 0 || t >= best) continue;
        const off2 = px * px + py * py + pz * pz - t * t;
        if (off2 > t * tan * (t * tan)) continue;
        if (isCutAway(positions, i, cut)) continue;
        best = t;
        hit = i;
    }
    return hit < 0 ? null : [positions[hit], positions[hit + 1], positions[hit + 2]];
}

/** Nearest visible ray–triangle hit (Möller–Trumbore), brute force over the mesh. */
export function pickMesh(
    positions: Float32Array,
    indices: Uint32Array,
    origin: number[],
    direction: number[],
    cut: Cutaway | null,
): number[] | null {
    let best = Infinity;
    const [ox, oy, oz] = origin;
    const [dx, dy, dz] = direction;
    const point = [0, 0, 0];
    for (let f = 0; f < indices.length; f += 3) {
        const a = indices[f] * 3;
        const b = indices[f + 1] * 3;
        const c = indices[f + 2] * 3;
        const e1x = positions[b] - positions[a];
        const e1y = positions[b + 1] - positions[a + 1];
        const e1z = positions[b + 2] - positions[a + 2];
        const e2x = positions[c] - positions[a];
        const e2y = positions[c + 1] - positions[a + 1];
        const e2z = positions[c + 2] - positions[a + 2];
        const px = dy * e2z - dz * e2y;
        const py = dz * e2x - dx * e2z;
        const pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const tx = ox - positions[a];
        const ty = oy - positions[a + 1];
        const tz = oz - positions[a + 2];
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y;
        const qy = tz * e1x - tx * e1z;
        const qz = tx * e1y - ty * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t <= 1e-6 || t >= best) continue;
        point[0] = ox + dx * t;
        point[1] = oy + dy * t;
        point[2] = oz + dz * t;
        if (isCutAway(point, 0, cut)) continue;
        best = t;
    }
    return Number.isFinite(best) ? [ox + dx * best, oy + dy * best, oz + dz * best] : null;
}
