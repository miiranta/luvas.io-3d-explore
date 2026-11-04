import { Injectable, signal } from '@angular/core';
import { decodeCloud, decodeMesh } from '../formats/scene-format';
import { LoadedScene, SceneId, SceneManifest, SceneSummary } from '../models/scene';

export interface Loading {
    id: SceneId;
    /** Fraction of the scene's bytes received, 0–1. */
    progress: number;
}

/** Scene list and the open scene; decoded scenes stay cached while the app is open. */
@Injectable({ providedIn: 'root' })
export class SceneStore {
    readonly index = signal<SceneSummary[] | null>(null);
    readonly scene = signal<LoadedScene | null>(null);
    readonly loading = signal<Loading | null>(null);
    readonly error = signal<string | null>(null);
    private readonly cache = new Map<SceneId, LoadedScene>();
    private request = 0;

    async loadIndex(): Promise<void> {
        try {
            const response = await fetch('scenes/index.json');
            if (!response.ok) throw new Error(`index.json: HTTP ${response.status}`);
            this.index.set((await response.json()) as SceneSummary[]);
        } catch (error) {
            this.error.set(`Could not load the scene list (${(error as Error).message}).`);
        }
    }

    async open(id: SceneId): Promise<void> {
        const request = ++this.request;
        this.error.set(null);
        const cached = this.cache.get(id);
        if (cached) {
            this.scene.set(cached);
            return;
        }
        this.loading.set({ id, progress: 0 });
        try {
            const scene = await this.fetchScene(id, (progress) => {
                if (request === this.request) this.loading.set({ id, progress });
            });
            this.cache.set(id, scene);
            if (request === this.request) this.scene.set(scene);
        } catch (error) {
            if (request === this.request) {
                this.error.set(`Could not load scene ${id} (${(error as Error).message}).`);
            }
        } finally {
            if (request === this.request) this.loading.set(null);
        }
    }

    close(): void {
        this.request++;
        this.loading.set(null);
        this.scene.set(null);
    }

    private async fetchScene(
        id: SceneId,
        onProgress: (progress: number) => void,
    ): Promise<LoadedScene> {
        const response = await fetch(`scenes/${id}/scene.json`);
        if (!response.ok) throw new Error(`scene.json: HTTP ${response.status}`);
        const manifest = (await response.json()) as SceneManifest;
        const { sparse, dense, mesh } = manifest.layers;
        const sizes = [
            sparse.count * 9,
            dense.count * 9,
            mesh ? mesh.indexOffset + mesh.triangles * 12 : 0,
        ];
        const total = sizes.reduce((a, b) => a + b, 0);
        const received = [0, 0, 0];
        const track = (slot: number) => (bytes: number) => {
            received[slot] = bytes;
            onProgress(received.reduce((a, b) => a + b, 0) / total);
        };
        const [sparseBytes, denseBytes, meshBytes] = await Promise.all([
            fetchBytes(`scenes/${id}/${sparse.file}`, sizes[0], track(0)),
            fetchBytes(`scenes/${id}/${dense.file}`, sizes[1], track(1)),
            mesh ? fetchBytes(`scenes/${id}/${mesh.file}`, sizes[2], track(2)) : null,
        ]);
        return {
            manifest,
            sparse: decodeCloud(sparseBytes, sparse),
            dense: decodeCloud(denseBytes, dense),
            mesh: mesh && meshBytes ? decodeMesh(meshBytes, mesh) : null,
        };
    }
}

/** Downloads a file into a buffer of its known size, reporting the bytes received. */
async function fetchBytes(
    url: string,
    size: number,
    onBytes: (bytes: number) => void,
): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
    const bytes = new Uint8Array(size);
    const reader = response.body.getReader();
    let offset = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (offset + value.length > size) throw new Error(`${url}: larger than ${size} bytes`);
        bytes.set(value, offset);
        offset += value.length;
        onBytes(offset);
    }
    if (offset !== size) throw new Error(`${url}: ${offset} of ${size} bytes`);
    return bytes.buffer;
}
