import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    OnDestroy,
    afterNextRender,
    computed,
    effect,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { LoadedScene } from '../../core/models/scene';
import { boxLines, cameraLines, pathLines } from '../../render/camera-lines';
import { GlScene } from '../../render/gl-scene';
import { Mat4 } from '../../render/mat4';
import { OrbitCamera, cutawayFor, pickMesh, pickPoints } from '../../render/orbit-camera';
import { TourView, tourPath, viewAt } from '../../render/tour';

export type Layer = 'mesh' | 'dense' | 'sparse';

interface Pointer {
    x: number;
    y: number;
}

interface Label {
    text: string;
    x: number;
    y: number;
}

const TAP_PIXELS = 8;
const TAP_MS = 350;
const PICK_PIXELS = 7;
const TOUR_SECONDS = 45;
const MAX_PYRAMIDS = 90;
const BACKGROUND = [27 / 255, 18 / 255, 53 / 255];
/** World-space point diameters (m): the dense cloud is about one point per centimetre. */
const POINT_SIZE: Record<Exclude<Layer, 'mesh'>, number> = { dense: 0.014, sparse: 0.035 };

@Component({
    selector: 'app-room-viewer',
    templateUrl: './room-viewer.html',
    styleUrl: './room-viewer.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { '(window:resize)': 'resize()' },
})
export class RoomViewer implements OnDestroy {
    readonly scene = input.required<LoadedScene>();
    readonly back = output<void>();
    readonly openInfo = output<void>();

    private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
    private gl: GlScene | null = null;
    private readonly camera = new OrbitCamera();
    private readonly pointers = new Map<number, Pointer>();
    private gesture: { start: number; x: number; y: number; moved: boolean } | null = null;
    private frame: number | null = null;
    private tourFrame: number | null = null;
    private tour: { path: TourView[]; start: number } | null = null;
    private uploaded: LoadedScene | null = null;

    readonly chosen = signal<Layer | null>(null);
    readonly showCameras = signal(true);
    readonly showPath = signal(true);
    readonly showBox = signal(false);
    readonly cutaway = signal(true);
    readonly measuring = signal(false);
    readonly touring = signal(false);
    readonly marks = signal<number[][]>([]);
    readonly labels = signal<Label[]>([]);
    readonly error = signal<string | null>(null);

    readonly manifest = computed(() => this.scene().manifest);
    readonly hasMesh = computed(() => this.scene().mesh !== null);
    readonly layer = computed<Layer>(() => this.chosen() ?? (this.hasMesh() ? 'mesh' : 'dense'));
    readonly summary = computed(() => {
        const scene = this.scene();
        const layer = this.layer();
        if (layer === 'mesh' && scene.mesh) {
            return `${formatCount(scene.mesh.indices.length / 3)} triangles`;
        }
        const cloud = layer === 'sparse' ? scene.sparse : scene.dense;
        return `${formatCount(cloud.positions.length / 3)} ${layer} points`;
    });
    readonly distance = computed(() => {
        const [a, b] = this.marks();
        if (!a || !b) return null;
        return `${(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100).toFixed(1)} cm`;
    });

    constructor() {
        afterNextRender(() => {
            const gl = this.canvas().nativeElement.getContext('webgl2', {
                antialias: true,
                alpha: false,
            });
            if (!gl) {
                this.error.set('WebGL 2 is not available in this browser.');
                return;
            }
            this.gl = new GlScene(gl);
            this.canvas().nativeElement.addEventListener('webglcontextlost', (event) =>
                event.preventDefault(),
            );
            this.resize();
            this.upload();
        });
        effect(() => {
            this.scene();
            this.upload();
        });
        effect(() => {
            this.layer();
            this.showCameras();
            this.showPath();
            this.showBox();
            this.cutaway();
            this.marks();
            this.requestRender();
        });
    }

    private upload(): void {
        const gl = this.gl;
        const scene = this.scene();
        if (!gl || this.uploaded === scene) return;
        this.stopTour();
        const { cameras, room } = scene.manifest;
        gl.setColored('sparse', { ...scene.sparse, channels: 3 });
        gl.setColored('dense', { ...scene.dense, channels: 3 });
        if (scene.mesh)
            gl.setMesh('mesh', scene.mesh.positions, scene.mesh.colors, scene.mesh.indices);
        else gl.remove('mesh');
        const every = Math.ceil(cameras.poses.length / MAX_PYRAMIDS);
        gl.setColored(
            'cameras',
            cameraLines(cameras.poses, cameras.fovY, cameras.aspect, 0.15, every),
        );
        gl.setColored('path', pathLines(cameras.poses));
        gl.setColored('box', boxLines(room.min, room.max));
        this.uploaded = scene;
        this.chosen.set(null);
        this.setMarks([]);
        this.reframe();
    }

    resize(): void {
        const canvas = this.canvas().nativeElement;
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(canvas.clientWidth * ratio);
        canvas.height = Math.round(canvas.clientHeight * ratio);
        this.requestRender();
    }

    private requestRender(): void {
        if (this.frame !== null || typeof requestAnimationFrame === 'undefined') return;
        this.frame = requestAnimationFrame(() => {
            this.frame = null;
            this.render();
        });
    }

    /** Pixels per metre at unit distance. */
    private pixelScale(): number {
        return this.canvas().nativeElement.height / (2 * Math.tan(this.camera.fov / 2));
    }

    private currentCutaway() {
        const { room } = this.manifest();
        return this.cutaway() ? cutawayFor(this.camera.eye(), room.min, room.max) : null;
    }

    private render(): void {
        const scene = this.gl;
        if (!scene) return;
        const gl = scene.gl;
        const canvas = this.canvas().nativeElement;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(BACKGROUND[0], BACKGROUND[1], BACKGROUND[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        const aspect = canvas.width / Math.max(1, canvas.height);
        const viewProjection = this.camera.viewProjection(aspect);
        const scale = this.pixelScale();
        scene.setCutaway(this.currentCutaway());
        const layer = this.layer();
        if (layer === 'mesh') scene.drawMesh('mesh', viewProjection, this.camera.eye());
        else scene.drawPoints(layer, viewProjection, POINT_SIZE[layer], scale);
        if (this.showBox()) scene.drawLines('box', viewProjection);
        if (this.showPath()) scene.drawLines('path', viewProjection);
        if (this.showCameras()) scene.drawLines('cameras', viewProjection);
        if (this.marks().length > 0) {
            gl.disable(gl.DEPTH_TEST);
            scene.setCutaway(null);
            scene.drawLines('measure-line', viewProjection);
            scene.drawPoints('measure', viewProjection, 0.05, scale);
        }
        this.placeLabels(viewProjection, canvas);
    }

    private placeLabels(viewProjection: Mat4, canvas: HTMLCanvasElement): void {
        const labels: Label[] = [];
        const project = (p: number[], text: string) => {
            const m = viewProjection;
            const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
            const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
            const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
            if (w <= 0) return;
            labels.push({
                text,
                x: ((x / w + 1) / 2) * canvas.clientWidth,
                y: ((1 - y / w) / 2) * canvas.clientHeight,
            });
        };
        const [a, b] = this.marks();
        const distance = this.distance();
        if (a && b && distance)
            project(
                [0, 1, 2].map((k) => (a[k] + b[k]) / 2),
                distance,
            );
        if (this.showBox()) {
            const { min, max, extentX, extentZ } = this.manifest().room;
            const text = (e: { modelCm: number; realCm: number | null }) =>
                `${e.modelCm.toFixed(1)} cm` + (e.realCm ? ` · tape ${e.realCm.toFixed(0)}` : '');
            project([(min[0] + max[0]) / 2, min[1], max[2]], text(extentX));
            project([max[0], min[1], (min[2] + max[2]) / 2], text(extentZ));
        }
        this.labels.set(labels);
    }

    choose(layer: Layer): void {
        this.chosen.set(layer);
        if (this.measuring()) this.setMarks([]);
    }

    toggle(which: 'cameras' | 'path' | 'box' | 'cutaway'): void {
        const flag = {
            cameras: this.showCameras,
            path: this.showPath,
            box: this.showBox,
            cutaway: this.cutaway,
        }[which];
        flag.update((on) => !on);
    }

    toggleMeasure(): void {
        this.measuring.update((on) => !on);
        this.setMarks([]);
    }

    reframe(): void {
        const { room } = this.manifest();
        this.camera.frame(room.min, room.max);
        this.requestRender();
    }

    toggleTour(): void {
        if (this.touring()) {
            this.stopTour();
            return;
        }
        const path = tourPath(this.manifest().cameras.poses);
        if (path.length < 2) return;
        this.tour = { path, start: performance.now() };
        this.touring.set(true);
        const step = (now: number) => {
            const tour = this.tour;
            if (!tour) return;
            const t = (now - tour.start) / (TOUR_SECONDS * 1000);
            if (t >= 1) {
                this.stopTour();
                return;
            }
            const view = viewAt(tour.path, t);
            this.camera.look(view.eye, view.forward);
            this.render();
            this.tourFrame = requestAnimationFrame(step);
        };
        this.tourFrame = requestAnimationFrame(step);
    }

    private stopTour(): void {
        if (this.tourFrame !== null) cancelAnimationFrame(this.tourFrame);
        this.tourFrame = null;
        this.tour = null;
        this.touring.set(false);
    }

    down(event: PointerEvent): void {
        this.stopTour();
        this.canvas().nativeElement.setPointerCapture(event.pointerId);
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        this.gesture =
            this.pointers.size === 1
                ? { start: performance.now(), x: event.clientX, y: event.clientY, moved: false }
                : null;
    }

    move(event: PointerEvent): void {
        const previous = this.pointers.get(event.pointerId);
        if (!previous) return;
        const height = this.canvas().nativeElement.clientHeight;
        if (this.pointers.size === 1) {
            const dx = event.clientX - previous.x;
            const dy = event.clientY - previous.y;
            if (
                this.gesture &&
                Math.hypot(event.clientX - this.gesture.x, event.clientY - this.gesture.y) >
                    TAP_PIXELS
            ) {
                this.gesture.moved = true;
            }
            if (event.buttons & 6 || event.shiftKey) this.camera.pan(dx, dy, height);
            else this.camera.rotate(dx, dy);
        } else if (this.pointers.size === 2) {
            const [a, b] = [...this.pointers.values()];
            const before = Math.hypot(a.x - b.x, a.y - b.y);
            const midBefore = [(a.x + b.x) / 2, (a.y + b.y) / 2];
            this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            const [c, d] = [...this.pointers.values()];
            const after = Math.hypot(c.x - d.x, c.y - d.y);
            const midAfter = [(c.x + d.x) / 2, (c.y + d.y) / 2];
            if (after > 1) this.camera.zoom(before / after);
            this.camera.pan(midAfter[0] - midBefore[0], midAfter[1] - midBefore[1], height);
        }
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        this.requestRender();
    }

    up(event: PointerEvent): void {
        this.pointers.delete(event.pointerId);
        const gesture = this.gesture;
        this.gesture = null;
        if (!gesture || gesture.moved || performance.now() - gesture.start > TAP_MS) return;
        if (this.measuring()) this.pick(event);
    }

    wheel(event: WheelEvent): void {
        event.preventDefault();
        this.stopTour();
        this.camera.zoom(Math.exp(event.deltaY * 0.0012));
        this.requestRender();
    }

    private pick(event: PointerEvent): void {
        const scene = this.scene();
        const canvas = this.canvas().nativeElement;
        const box = canvas.getBoundingClientRect();
        const ndcX = ((event.clientX - box.left) / box.width) * 2 - 1;
        const ndcY = 1 - ((event.clientY - box.top) / box.height) * 2;
        const ray = this.camera.ray(ndcX, ndcY, canvas.width / Math.max(1, canvas.height));
        if (!ray) return;
        const cut = this.currentCutaway();
        const layer = this.layer();
        const ratio = canvas.width / Math.max(1, box.width);
        const hit =
            layer === 'mesh' && scene.mesh
                ? pickMesh(scene.mesh.positions, scene.mesh.indices, ray.origin, ray.direction, cut)
                : pickPoints(
                      (layer === 'sparse' ? scene.sparse : scene.dense).positions,
                      ray.origin,
                      ray.direction,
                      (PICK_PIXELS * ratio) / this.pixelScale(),
                      cut,
                  );
        if (!hit) return;
        this.setMarks(this.marks().length >= 2 ? [hit] : [...this.marks(), hit]);
    }

    private setMarks(marks: number[][]): void {
        this.marks.set(marks);
        const scene = this.gl;
        if (!scene) return;
        const accent = [255, 201, 60, 255];
        scene.setColored(
            'measure',
            marks.length
                ? {
                      positions: Float32Array.from(marks.flat()),
                      colors: Uint8Array.from(marks.flatMap(() => accent)),
                      channels: 4,
                  }
                : null,
        );
        scene.setColored(
            'measure-line',
            marks.length === 2
                ? {
                      positions: Float32Array.from(marks.flat()),
                      colors: Uint8Array.from([...accent, ...accent]),
                      channels: 4,
                  }
                : null,
        );
    }

    ngOnDestroy(): void {
        this.stopTour();
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.gl?.dispose();
    }
}

function formatCount(value: number): string {
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e4) return `${Math.round(value / 1e3)}k`;
    return String(Math.round(value));
}
