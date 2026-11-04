// Converts the outputs of the MO446 room pipeline (Trabalho 2, results/<video>/) into the assets
// the app loads from public/scenes/: point clouds and mesh with 16-bit positions, the camera
// poses, the room box measured by RANSAC and the metrics. Coordinates go from the pipeline frame
// (metres, z up, floor at z = 0) to the y-up frame of the renderer: (x, y, z) -> (x, z, -y).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RESULTS = resolve(
    process.env.T2_RESULTS ?? '../../../Visao-Task2/mo-446-visao-computacional/Trabalho 2/results',
);
const OUT = resolve('public/scenes');
const SCENES = [
    {
        id: 'A',
        name: 'Laboratório do Recod',
        place: 'Recod lab, Institute of Computing — Unicamp',
    },
    { id: 'B', name: 'Sala 90', place: 'Room 90, Institute of Computing — Unicamp' },
    { id: 'C', name: 'Copa do IC', place: 'Kitchen, Institute of Computing — Unicamp' },
];

const SIZES = { char: 1, uchar: 1, short: 2, ushort: 2, int: 4, uint: 4, float: 4, double: 8 };
const READERS = {
    char: 'getInt8',
    uchar: 'getUint8',
    short: 'getInt16',
    ushort: 'getUint16',
    int: 'getInt32',
    uint: 'getUint32',
    float: 'getFloat32',
    double: 'getFloat64',
};

/** Binary little-endian PLY: vertex properties by name and, when present, triangle indices. */
export function readPly(path) {
    const bytes = readFileSync(path);
    const end = bytes.indexOf('end_header\n') + 'end_header\n'.length;
    const header = bytes.subarray(0, end).toString('latin1').split('\n');
    if (!header.includes('format binary_little_endian 1.0'))
        throw new Error(`${path}: not binary LE`);
    const elements = [];
    for (const line of header) {
        const [kind, ...rest] = line.trim().split(/\s+/);
        if (kind === 'element') elements.push({ name: rest[0], count: +rest[1], props: [] });
        else if (kind === 'property' && rest[0] === 'list')
            elements
                .at(-1)
                .props.push({ list: true, countType: rest[1], type: rest[2], name: rest[3] });
        else if (kind === 'property') elements.at(-1).props.push({ type: rest[0], name: rest[1] });
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = end;
    const out = { vertices: {}, count: 0, faces: null };
    for (const element of elements) {
        if (element.name === 'vertex') {
            out.count = element.count;
            for (const prop of element.props)
                out.vertices[prop.name] = new Float64Array(element.count);
            for (let i = 0; i < element.count; i++) {
                for (const prop of element.props) {
                    out.vertices[prop.name][i] = view[READERS[prop.type]](offset, true);
                    offset += SIZES[prop.type];
                }
            }
        } else if (element.name === 'face') {
            const [prop] = element.props;
            const faces = new Uint32Array(element.count * 3);
            for (let f = 0; f < element.count; f++) {
                const n = view[READERS[prop.countType]](offset, true);
                offset += SIZES[prop.countType];
                if (n !== 3) throw new Error(`${path}: face ${f} has ${n} vertices`);
                for (let k = 0; k < 3; k++) {
                    faces[f * 3 + k] = view[READERS[prop.type]](offset, true);
                    offset += SIZES[prop.type];
                }
            }
            out.faces = faces;
        } else {
            throw new Error(`${path}: unexpected element ${element.name}`);
        }
    }
    return out;
}

/** Pipeline frame (z up) to renderer frame (y up). */
const toYUp = ([x, y, z]) => [x, z, -y];

function positionsYUp(ply) {
    const { x, y, z } = ply.vertices;
    const positions = new Float64Array(ply.count * 3);
    for (let i = 0; i < ply.count; i++) {
        positions[i * 3] = x[i];
        positions[i * 3 + 1] = z[i];
        positions[i * 3 + 2] = -y[i];
    }
    return positions;
}

function colorsOf(ply) {
    const { red, green, blue } = ply.vertices;
    const colors = new Uint8Array(ply.count * 3);
    for (let i = 0; i < ply.count; i++) {
        colors[i * 3] = red[i];
        colors[i * 3 + 1] = green[i];
        colors[i * 3 + 2] = blue[i];
    }
    return colors;
}

/** 16-bit positions over the bounding box (sub-millimetre for a room) and the box itself. */
export function quantize(positions) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
        min[i % 3] = Math.min(min[i % 3], positions[i]);
        max[i % 3] = Math.max(max[i % 3], positions[i]);
    }
    const q = new Uint16Array(positions.length);
    for (let i = 0; i < positions.length; i++) {
        const a = i % 3;
        q[i] = Math.round(((positions[i] - min[a]) / Math.max(max[a] - min[a], 1e-9)) * 65535);
    }
    return { q, min: min.map(round6), max: max.map(round6) };
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;
const round4 = (v) => Math.round(v * 1e4) / 1e4;

function writeCloud(dir, file, ply) {
    const { q, min, max } = quantize(positionsYUp(ply));
    const colors = colorsOf(ply);
    writeFileSync(
        join(dir, file),
        Buffer.concat([Buffer.from(q.buffer), Buffer.from(colors.buffer)]),
    );
    return { file, count: ply.count, min, max };
}

function writeMesh(dir, file, ply) {
    const { q, min, max } = quantize(positionsYUp(ply));
    const colors = colorsOf(ply);
    const pad = Buffer.alloc((4 - ((q.byteLength + colors.byteLength) % 4)) % 4);
    writeFileSync(
        join(dir, file),
        Buffer.concat([
            Buffer.from(q.buffer),
            Buffer.from(colors.buffer),
            pad,
            Buffer.from(ply.faces.buffer),
        ]),
    );
    return {
        file,
        vertices: ply.count,
        triangles: ply.faces.length / 3,
        indexOffset: q.byteLength + colors.byteLength + pad.length,
        min,
        max,
    };
}

/** COLMAP text model: intrinsics and the pose of every registered image, sorted by name. */
function readCameras(dir, excluded) {
    const [model, w, h, f] = readFileSync(join(dir, 'cameras.txt'), 'utf8')
        .split('\n')
        .find((line) => line && !line.startsWith('#'))
        .split(' ')
        .slice(1);
    if (!model.includes('RADIAL') && !model.includes('PINHOLE')) throw new Error(`camera ${model}`);
    const lines = readFileSync(join(dir, 'images.txt'), 'utf8')
        .split('\n')
        .filter((line) => !line.startsWith('#'));
    const poses = [];
    for (let i = 0; i + 1 < lines.length; i += 2) {
        const fields = lines[i].trim().split(/\s+/);
        if (fields.length < 10) continue;
        const [qw, qx, qy, qz, tx, ty, tz] = fields.slice(1, 8).map(Number);
        const name = fields[9];
        if (excluded.has(name)) continue;
        // cam_from_world rotation; its rows are the camera axes in world coordinates
        const R = [
            [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
            [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
            [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
        ];
        const t = [tx, ty, tz];
        const center = [0, 1, 2].map((a) => -(R[0][a] * t[0] + R[1][a] * t[1] + R[2][a] * t[2]));
        const right = toYUp(R[0]);
        const up = toYUp(R[1].map((v) => -v));
        const forward = toYUp(R[2]);
        poses.push({ name, pose: [...toYUp(center), ...right, ...up, ...forward].map(round4) });
    }
    poses.sort((a, b) => a.name.localeCompare(b.name));
    return {
        fovY: round6(2 * Math.atan(+h / 2 / +f)),
        aspect: round6(+w / +h),
        names: poses.map((p) => p.name),
        poses: poses.map((p) => p.pose),
    };
}

/** Room box (y up) and the measured dimensions, with the tape value of each axis. */
function readRoom(sala, metrics) {
    const [[x0, x1], [y0, y1], [z0, z1]] = sala.bounds;
    const dims = Object.fromEntries(metrics.dimensions.map((d) => [d.source, d]));
    const xIsLength = sala.x_extent_m >= sala.y_extent_m;
    const real = (axis) =>
        (dims[(axis === 'x') === xIsLength ? 'auto:length' : 'auto:width'] ?? {}).real_cm ?? null;
    return {
        min: [x0, z0, -y1].map(round4),
        max: [x1, z1, -y0].map(round4),
        floor: round4(sala.floor_z),
        // measured extent along the renderer x and z axes and the tape value of each
        extentX: { modelCm: round4(sala.x_extent_m * 100), realCm: real('x') },
        extentZ: { modelCm: round4(sala.y_extent_m * 100), realCm: real('y') },
    };
}

function summarize(metrics, frames) {
    const optional = (v) => (v === undefined || v === null ? null : round4(v));
    const dims = metrics.dimensions.map((d) => ({
        name: d.name,
        realCm: d.real_cm,
        modelCm: optional(d.model_cm),
        errorCm: optional(d.abs_err_cm),
        errorPct: optional(d.rel_err_pct),
    }));
    const drift = metrics.loop_drift;
    return {
        frames: frames.n_keyframes,
        videoSeconds: round4(frames.duration_s),
        registered: metrics.sfm.n_reg_images,
        reprojMeanPx: round4(metrics.reproj_mean_px),
        reprojMedianPx: round4(metrics.reproj_median_px),
        sparsePoints: metrics.n_sparse_points_clean,
        densePoints: metrics.n_dense_points,
        denseMethod: metrics.dense_method,
        scaleMPerUnit: metrics.scale?.scale ? round6(metrics.scale.scale) : null,
        driftCm: drift ? round4(drift.drift_cm) : null,
        driftPct: drift ? round4(drift.drift_pct) : null,
        pathMeters: drift ? round4(drift.trajectory_length_m) : null,
        wallAngles: (metrics.room.wall_angles ?? []).map((a) => round4(a.angle_deg)),
        dimensions: dims,
    };
}

mkdirSync(OUT, { recursive: true });
const index = [];
for (const scene of SCENES) {
    const src = join(RESULTS, scene.id);
    const dir = join(OUT, scene.id);
    mkdirSync(dir, { recursive: true });
    const sala = JSON.parse(readFileSync(join(src, 'sala.json'), 'utf8'));
    const metrics = JSON.parse(readFileSync(join(src, 'metricas.json'), 'utf8'));
    const frames = JSON.parse(readFileSync(join(src, 'quadros', 'frames.json'), 'utf8'));
    const meshPath = join(src, 'extras', '4_malha_poisson', 'malha_poisson_web.ply');
    const layers = {
        sparse: writeCloud(dir, 'sparse.bin', readPly(join(src, 'nuvem_esparsa.ply'))),
        dense: writeCloud(dir, 'dense.bin', readPly(join(src, 'nuvem_densa.ply'))),
        mesh: existsSync(meshPath) ? writeMesh(dir, 'mesh.bin', readPly(meshPath)) : null,
    };
    const manifest = {
        ...scene,
        metrics: summarize(metrics, frames),
        layers,
        cameras: readCameras(join(src, 'modelo_metrico', 'txt'), new Set(sala.excluded_cameras)),
        room: readRoom(sala, metrics),
    };
    writeFileSync(join(dir, 'scene.json'), JSON.stringify(manifest));
    index.push({
        id: scene.id,
        name: scene.name,
        place: scene.place,
        registered: manifest.metrics.registered,
        frames: manifest.metrics.frames,
        densePoints: manifest.metrics.densePoints,
        triangles: layers.mesh?.triangles ?? null,
        dimensions: manifest.metrics.dimensions,
    });
    console.log(
        `${scene.id}: ${layers.dense.count} dense, ${layers.sparse.count} sparse, ` +
            `${layers.mesh ? layers.mesh.triangles + ' triangles' : 'no mesh'}, ` +
            `${manifest.cameras.poses.length} cameras`,
    );
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');
