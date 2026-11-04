import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { SCENE_IDS, SceneId } from './core/models/scene';
import { SceneStore } from './core/services/scene-store';
import { BusyVeil } from './ui/busy-veil/busy-veil';
import { InfoSheet } from './ui/info-sheet/info-sheet';
import { RoomViewer } from './ui/room-viewer/room-viewer';
import { ScenePicker } from './ui/scene-picker/scene-picker';

@Component({
    selector: 'app-root',
    imports: [BusyVeil, InfoSheet, RoomViewer, ScenePicker],
    templateUrl: './app.html',
    styleUrl: './app.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { '(window:popstate)': 'followUrl()' },
})
export class App implements OnInit {
    private readonly store = inject(SceneStore);

    readonly scene = this.store.scene;
    readonly showInfo = signal(false);

    ngOnInit(): void {
        this.store.loadIndex();
        this.followUrl();
    }

    /** Opens the scene of `?scene=` (also on back/forward navigation). */
    followUrl(): void {
        const id = new URLSearchParams(location.search).get('scene')?.toUpperCase();
        if (id && (SCENE_IDS as readonly string[]).includes(id)) this.store.open(id as SceneId);
        else this.store.close();
    }

    open(id: SceneId): void {
        history.pushState(null, '', `?scene=${id}`);
        this.store.open(id);
    }

    back(): void {
        this.showInfo.set(false);
        history.pushState(null, '', location.pathname);
        this.store.close();
    }
}
