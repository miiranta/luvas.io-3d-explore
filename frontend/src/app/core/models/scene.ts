/** Scenes as written by tools/build-scenes.mjs (public/scenes/). */
export type SceneId = 'A' | 'B' | 'C';

export const SCENE_IDS: readonly SceneId[] = ['A', 'B', 'C'];

/** A measured dimension: tape value and the value measured on the model. */
export interface Dimension {
    name: string;
    realCm: number;
    modelCm: number | null;
    errorCm: number | null;
    errorPct: number | null;
}

/** One entry of public/scenes/index.json. */
export interface SceneSummary {
    id: SceneId;
    name: string;
    place: string;
    registered: number;
    frames: number;
    densePoints: number | null;
    triangles: number | null;
    dimensions: Dimension[];
}

/** A point layer: 16-bit positions over [min, max] followed by RGB8 colours. */
export interface CloudLayer {
    file: string;
    count: number;
    min: number[];
    max: number[];
}

/** The mesh: 16-bit positions, RGB8 colours, then uint32 triangle indices at `indexOffset`. */
export interface MeshLayer {
    file: string;
    vertices: number;
    triangles: number;
    indexOffset: number;
    min: number[];
    max: number[];
}

export interface SceneMetrics {
    frames: number;
    videoSeconds: number;
    registered: number;
    reprojMeanPx: number;
    reprojMedianPx: number;
    sparsePoints: number;
    densePoints: number | null;
    denseMethod: string | null;
    scaleMPerUnit: number | null;
    driftCm: number | null;
    driftPct: number | null;
    pathMeters: number | null;
    wallAngles: number[];
    dimensions: Dimension[];
}

/** Floor-plane extent of the room box measured on the model, with the tape value. */
export interface Extent {
    modelCm: number;
    realCm: number | null;
}

/** Room box measured by RANSAC (y up, metres). */
export interface Room {
    min: number[];
    max: number[];
    floor: number;
    extentX: Extent;
    extentZ: Extent;
}

/** Number of values per pose: centre, right, up and forward axes (world, y up). */
export const POSE_STRIDE = 12;

export interface Cameras {
    fovY: number;
    aspect: number;
    names: string[];
    /** POSE_STRIDE numbers per registered camera, in capture order. */
    poses: number[][];
}

/** public/scenes/<id>/scene.json. */
export interface SceneManifest {
    id: SceneId;
    name: string;
    place: string;
    metrics: SceneMetrics;
    layers: { sparse: CloudLayer; dense: CloudLayer; mesh: MeshLayer | null };
    cameras: Cameras;
    room: Room;
}

export interface PointCloud {
    positions: Float32Array;
    colors: Uint8Array;
}

export interface Mesh extends PointCloud {
    indices: Uint32Array;
}

/** A scene with its geometry decoded and ready for the GPU. */
export interface LoadedScene {
    manifest: SceneManifest;
    sparse: PointCloud;
    dense: PointCloud;
    mesh: Mesh | null;
}
