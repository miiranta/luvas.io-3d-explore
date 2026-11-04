import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { Dimension, SceneId, SceneSummary } from '../../core/models/scene';
import { SceneStore } from '../../core/services/scene-store';

const LABELS: Record<string, string> = {
    largura: 'Width',
    comprimento: 'Length',
    altura_porta: 'Door',
};

interface Card {
    id: SceneId;
    name: string;
    place: string;
    thumb: string;
    stats: string[];
    dimensions: { label: string; model: string; tape: string; bad: boolean }[];
}

@Component({
    selector: 'app-scene-picker',
    templateUrl: './scene-picker.html',
    styleUrl: './scene-picker.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScenePicker {
    private readonly store = inject(SceneStore);

    readonly open = output<SceneId>();
    readonly error = this.store.error;
    readonly loadingId = computed(() => this.store.loading()?.id ?? null);
    readonly cards = computed<Card[]>(() => (this.store.index() ?? []).map(toCard));
}

function toCard(scene: SceneSummary): Card {
    const geometry = scene.triangles
        ? `${compact(scene.triangles)} triangles`
        : `${compact(scene.densePoints ?? 0)} dense points`;
    return {
        id: scene.id,
        name: scene.name,
        place: scene.place,
        thumb: `scenes/${scene.id}/thumb.jpg`,
        stats: [`${scene.frames} frames`, `${scene.registered} cameras`, geometry],
        dimensions: scene.dimensions.map(toDimension),
    };
}

function toDimension(d: Dimension) {
    return {
        label: LABELS[d.name] ?? d.name,
        model: d.modelCm === null ? '—' : `${d.modelCm.toFixed(1)} cm`,
        tape: `${d.realCm.toFixed(0)} cm`,
        bad: d.errorPct === null || d.errorPct > 10,
    };
}

function compact(value: number): string {
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e4) return `${Math.round(value / 1e3)}k`;
    return String(value);
}
