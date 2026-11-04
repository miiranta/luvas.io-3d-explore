import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LoadedScene } from '../../core/models/scene';

interface Row {
    label: string;
    value: string;
    bad?: boolean;
}

interface Section {
    title: string;
    rows: Row[];
}

const NAMES: Record<string, string> = {
    largura: 'width',
    comprimento: 'length',
    altura_porta: 'door height',
};

const count = (value: number) => value.toLocaleString('en-US');
const fixed = (value: number, digits = 1) => value.toFixed(digits);

@Component({
    selector: 'app-info-sheet',
    templateUrl: './info-sheet.html',
    styleUrl: './info-sheet.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InfoSheet {
    readonly scene = input.required<LoadedScene>();
    readonly close = output<void>();

    readonly title = computed(() => {
        const { id, name } = this.scene().manifest;
        return `${id} · ${name}`;
    });

    readonly sections = computed<Section[]>(() => {
        const scene = this.scene();
        const m = scene.manifest.metrics;
        const reconstruction: Row[] = [
            { label: 'cameras registered', value: `${m.registered} / ${m.frames}` },
            {
                label: 'reprojection mean / median',
                value: `${fixed(m.reprojMeanPx, 2)} / ${fixed(m.reprojMedianPx, 2)} px`,
            },
            { label: 'sparse points', value: count(m.sparsePoints) },
        ];
        if (m.densePoints !== null) {
            reconstruction.push({
                label: `dense points (${m.denseMethod ?? 'MVS'})`,
                value: count(m.densePoints),
            });
        }
        if (scene.mesh) {
            reconstruction.push({
                label: 'mesh (Poisson, simplified)',
                value: `${count(scene.mesh.indices.length / 3)} triangles`,
            });
        }
        const capture: Row[] = [
            { label: 'video', value: `${fixed(m.videoSeconds, 0)} s` },
            { label: 'frames used', value: count(m.frames) },
        ];
        if (m.scaleMPerUnit !== null) {
            capture.push({
                label: 'scale (checkerboard)',
                value: `${fixed(m.scaleMPerUnit, 4)} m / unit`,
            });
        }
        if (m.driftCm !== null && m.pathMeters !== null) {
            capture.push({
                label: 'loop drift',
                value: `${fixed(m.driftCm)} cm · ${fixed(m.driftPct ?? 0, 3)}% of ${fixed(m.pathMeters, 0)} m`,
            });
        }
        const dimensions: Row[] = m.dimensions.map((d) => ({
            label: `${NAMES[d.name] ?? d.name} (tape ${fixed(d.realCm, 0)} cm)`,
            value:
                d.modelCm === null
                    ? 'not measured'
                    : `${fixed(d.modelCm)} cm · ${fixed(d.errorPct ?? 0)}%`,
            bad: d.errorPct === null || d.errorPct > 10,
        }));
        const sections: Section[] = [
            { title: 'reconstruction', rows: reconstruction },
            { title: 'capture and scale', rows: capture },
            { title: 'dimensions (model · error)', rows: dimensions },
        ];
        if (m.wallAngles.length) {
            sections.push({
                title: 'angles between walls',
                rows: [
                    {
                        label: 'expected 90°',
                        value: m.wallAngles.map((a) => `${fixed(a)}°`).join(' · '),
                    },
                ],
            });
        }
        return sections;
    });
}
