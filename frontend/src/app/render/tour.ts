/** A view along the capture path: where the eye is and where it looks. */
export interface TourView {
    eye: number[];
    forward: number[];
}

/**
 * The capture path smoothed by a circular moving average (the loop is closed, so the ends wrap)
 * with the eye a little behind and above each camera — the same walk as the pipeline video.
 */
export function tourPath(poses: number[][]): TourView[] {
    const n = poses.length;
    if (n === 0) return [];
    const half = Math.max(1, Math.floor(n / 25));
    const views: TourView[] = [];
    for (let i = 0; i < n; i++) {
        const center = [0, 0, 0];
        const forward = [0, 0, 0];
        for (let k = -half; k <= half; k++) {
            const pose = poses[(i + k + n) % n];
            for (let a = 0; a < 3; a++) {
                center[a] += pose[a];
                forward[a] += pose[9 + a];
            }
        }
        forward[1] *= 0.5;
        const length = Math.hypot(forward[0], forward[1], forward[2]) || 1;
        const f = forward.map((v) => v / length);
        const c = center.map((v) => v / (2 * half + 1));
        views.push({
            eye: [c[0] - 0.6 * f[0], c[1] + 0.25 - 0.6 * f[1], c[2] - 0.6 * f[2]],
            forward: f,
        });
    }
    return views;
}

/** The view at `t` in [0, 1] along the path, linearly interpolated between cameras. */
export function viewAt(path: TourView[], t: number): TourView {
    const s = Math.max(0, Math.min(1, t)) * (path.length - 1);
    const i = Math.floor(s);
    const j = Math.min(i + 1, path.length - 1);
    const w = s - i;
    const mix = (a: number[], b: number[]) => a.map((v, k) => (1 - w) * v + w * b[k]);
    const forward = mix(path[i].forward, path[j].forward);
    const length = Math.hypot(forward[0], forward[1], forward[2]) || 1;
    return { eye: mix(path[i].eye, path[j].eye), forward: forward.map((v) => v / length) };
}
