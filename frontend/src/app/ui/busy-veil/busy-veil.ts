import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SceneStore } from '../../core/services/scene-store';

@Component({
    selector: 'app-busy-veil',
    templateUrl: './busy-veil.html',
    styleUrl: './busy-veil.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { '[class.visible]': 'visible()' },
})
export class BusyVeil {
    private readonly store = inject(SceneStore);

    readonly visible = computed(() => this.store.loading() !== null);
    readonly label = computed(() => {
        const loading = this.store.loading();
        return loading ? `loading ${loading.id} · ${Math.round(loading.progress * 100)}%` : '';
    });
}
