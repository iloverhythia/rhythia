import { GameScene } from './game/game.js';
import { Replay } from './game/replay.js';
import { Lobby } from './lobby.js';
import { MapManager } from './map/manager.js';
import { isValidExt } from './map/parser.js';
import { RenderBackend, TIME } from './render.js';
import { SettingsManager, SettingsProfile } from './settings.js';
import { SkinManager } from './skin.js';
import { createSpace } from './spaces/index.js';
import { Stats } from './stats.js';
import { Storage } from './storage.js';
import { SoundManager } from './sound.js';
import { Overlays } from './ui/overlays.js';
import { LoadingScene } from './ui/loading.js';
import { MainMenu } from './ui/mainMenu.js';
import { ResultsScene } from './ui/results.js';
import { SettingsMenu } from './ui/settingsMenu.js';

const app = {
    settingsManager: SettingsManager,
    skinManager: SkinManager,
    mapManager: MapManager,
    sound: SoundManager,
    stats: Stats,
    lobby: Lobby,
    notify,
};


class SceneManagerClass {
    constructor() {
        this.root = document.getElementById('scenes');
        this.transition = document.createElement('div');
        this.transition.className = 'scene-transition';
        document.body.appendChild(this.transition);
        this.transition.style.zIndex = 60;
        this.scenes = {};
        this.scene = null;
        this.space = null;
        this.spaceName = null;
        this.activeName = null;
        this.loading = false;
    }

    get(name) {
        if (!this.scenes[name]) {
            this.scenes[name] =
                name === 'loading'
                    ? new LoadingScene(app)
                    : name === 'menu'
                      ? new MainMenu(app)
                      : name === 'game'
                        ? new GameScene(app)
                        : new ResultsScene(app);
        }
        return this.scenes[name];
    }

    reloadCurrentScene() {
        this.load(this.activeName, true);
    }

    load(name, skipTransition = false) {
        const next = this.get(name);
        const fadeOut = () =>
            new Promise((resolve) => {
                if (skipTransition) return resolve();
                gsap.to(this.transition, { opacity: 0, duration: 0.2, onComplete: resolve });
            });

        this.loadToken = (this.loadToken ?? 0) + 1;
        const token = this.loadToken;

        fadeOut().then(async () => {
            if (token !== this.loadToken) return;
            this.transition.style.opacity = 1;
            const old = this.scene;
            if (old) {
                old.unload?.();
                old.element.remove();
            }
            this.activeName = name;
            this.scene = next;

            await this.updateSpace(next);
            this.root.appendChild(next.element);
            try {
                await next.load();
            } catch (e) {
                console.error(e);
            }
            SoundManager.refreshMenuMusicPlayback();
        });
    }

    async updateSpace(scene, force = false) {
        const skin = SkinManager.skin;
        const wanted = scene.useGameSpace ? 'game' : 'menu';
        if (!force && wanted === this.spaceName) {
            this.space?.updateState(!!scene.useGameSpace);
            return;
        }
        this.space?.dispose();
        this.space = null;
        this.spaceName = wanted;
        if (!wanted) return;
        const ctx = {
            settings: SettingsManager.settings,
            skin,
            mouse: app.mouse,
        };
        this.space = await createSpace(wanted, ctx);
        this.space.updateState(!!scene.useGameSpace);
        const map = MapManager.selected.value;
        if (map) this.space.setMap?.(map);
    }
}


const audioCache = new Map();
async function decodeAudio(name, bytesLoader) {
    if (audioCache.has(name)) return audioCache.get(name);
    const bytes = await bytesLoader();
    const buffer = await SoundManager.context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    audioCache.set(name, buffer);
    return buffer;
}

SoundManager.getMaps = () => MapManager.maps;
SoundManager.speed = () => Lobby.speed;

MapManager.notify = notify;
SkinManager.notify = notify;

app.selectMap = (map) => {
    MapManager.select(map);
    Lobby.setMap(MapManager.selected.value);
    SoundManager.startMapSelectionPlayback(map);
    app.sceneManager.scenes.menu?.mapInfo.select(map);
};

app.focusMap = (map) => {
    const menu = app.sceneManager.scenes.menu;
    if (menu) menu.mapList.select(map, false);
};

app.playSelected = () => {
    if (!Lobby.map) return;
    GameScene.start(Lobby.map, Lobby.speed, Lobby.startFrom, Lobby.cameraMode, Lobby.modifiers, Lobby.players);
};

app.playReplay = async (replay) => {
    if (!replay.valid) return;
    const map = MapManager.getMapByName(replay.mapID);
    if (!map) return notify('Replay map not found', 2);
    SoundManager.song.stop();
    GameScene.start(map, replay.speed, 0, replay.cameraMode, replay.modifiers, replay.players, [replay]);
};

app.playReplayById = async (id) => {
    const bytes = await Storage.get('replays', id);
    if (!bytes) return;
    const replay = Replay.decode(bytes);
    if (replay.valid) app.playReplay(replay);
};

app.importFiles = async (files) => {
    const maps = [];
    const replays = [];
    for (const f of files) {
        if (isValidExt(f.name, ['.json', '.map'])) {
            const imported = await MapManager.importFile(f);
            maps.push(...imported);
            SoundManager.updateJukeboxQueue();
            const menu = app.sceneManager.scene;
            if (menu instanceof MainMenu) {
                menu.transition('play');
                menu.mapList.updateMaps();
            }
            continue;
        }
        if (!isValidExt(f.name, ['.rpl'])) continue;
        const bytes = new Uint8Array(await f.arrayBuffer());
        const id = baseName(f.name);
        const replay = Replay.decode(bytes);
        if (replay.valid) {
            await Storage.put('replays', id, bytes);
            replays.push(replay);
        }
    }
    if (replays.length > 0) app.playReplay(replays[0]);
};

app.quit = async () => {
    await saveAll();
    notify('Saved. You can close this tab now.');
    SoundManager.song.stop();
    SoundManager.menuMusic.stop();
};

async function saveAll() {
    startedAt = performance.now();
    SettingsManager.save();
    await Stats.save();
}

app.exportUserData = async () => {
    const zip = new globalThis.JSZip();
    for (const store of Storage.STORES) {
        const entries = await Storage.entries(store);
        for (const [key, value] of entries) {
            zip.file(`${store}/${key}`, value);
        }
    }
    for (const name of SettingsManager.getProfiles()) {
        try {
            zip.file(`profiles/${name}.json`, JSON.stringify(SettingsManager.exportProfile(name), null, 2));
        } catch {}
    }
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    downloadBytes(bytes, 'Rhythia-user.zip');
};

app.importUserData = async () => {
    const file = await pickFile('.zip');
    if (!file) return;
    const zip = await globalThis.JSZip.loadAsync(await file.arrayBuffer());
    for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue;
        const [store, ...rest] = entry.name.split('/');
        if (store === 'profiles') {
            const name = baseName(rest.join('/'));
            SettingsManager.importProfile(name, JSON.parse(await entry.async('text')));
        } else if (Storage.STORES.includes(store)) {
            const raw = await entry.async('uint8array');
            await Storage.put(store, rest.join('/'), raw);
        }
    }
    notify('Imported user folder, reloading...');
    setTimeout(() => location.reload(), 1000);
};


async function reloadSkin() {
    await SkinManager.load();
    await SoundManager.updateSkin(SkinManager.skin);
    const scene = app.sceneManager?.scene;
    if (scene?.reloadSkin) await scene.reloadSkin();
}

function importNightlyProfile(text) {
    const root = JSON.parse(text);
    const get = (key) => root.settings?.[key];
    const profile = new SettingsProfile({});
    const importVolume = (key, range) => {
        const channelDb = get(key);
        if (channelDb == null) return 50;
        return Math.round(Math.pow(10, channelDb / 20) * range);
    };
    const conv = {
        AbsoluteInput: get('absolute_mode'),
        AbsoluteSensitivity: get('absolute_scale'),
        CursorDrift: get('enable_drift_cursor'),
        ApproachRate: get('approach_rate'),
        ApproachDistance: get('spawn_distance'),
        Pushback: get('do_note_pushback'),
        FadeOut: get('note_fadeout'),
        FoV: get('fov'),
        NoteColors: get('selected_colorset'),
        NoteMesh: get('selected_mesh'),
        NoteSpeed: get('note_speed'),
        NoteOpacity: get('note_opacity'),
        CursorScale: get('cursor_scale'),
        CursorRotation: get('cursor_spin'),
        CursorTrail: get('cursor_trail'),
        TrailTime: get('trail_time'),
        TrailDetail: get('trail_detail'),
        SimpleHUD: get('simple_hud'),
        HitPopups: get('score_popup'),
        MissPopups: get('show_miss_effect'),
        Fullscreen: get('window_fullscreen'),
        FPS: get('target_fps'),
        VolumeMaster: 100,
        VolumeMusic: importVolume('music_volume', 70),
        VolumeHitSound: importVolume('hit_volume', 80),
        VolumeSFX: importVolume('fail_volume', 80),
        EnableHitSound: get('play_hit_snd'),
        EnableMissSound: get('play_miss_snd'),
        EnableMenuMusic: get('play_menu_music'),
        AutoplayJukebox: get('auto_preview_song'),
        LocalOffset: get('music_offset'),
        RecordReplays: get('record_replays'),
    };

    let name = 'nightly';
    while (SettingsManager.getProfiles().includes(name)) name += '-imported';
    for (const [key, value] of Object.entries(conv)) if (value != null) profile[key] = value;
    SettingsManager.saveProfile(name, profile);
    SettingsManager.setCurrentProfile(name);
    SettingsManager.load(name);
    app.settingsMenu.updateProfileSelection();
    notify(`Created profile '${name}'`);
}

SettingsManager.setHooks({
    notify,
    reloadSkin: () => reloadSkin(),
    updateVolume: () => SoundManager.updateVolume(),
    fullscreen: (v, init) => {
        if (init) return;
        if (v) document.documentElement.requestFullscreen?.();
        else document.exitFullscreen?.();
    },
    menuCursor: (v) => {
        const scene = app.sceneManager?.scene;
        if (scene?.onMenuCursor) scene.onMenuCursor(v);
    },
    exportUserData: () => app.exportUserData(),
    importUserData: () => app.importUserData(),
    importNightly: async () => {
        const file = await pickFile('.json');
        if (!file) return;
        try {
            importNightlyProfile(await file.text());
        } catch (e) {
            console.error(e);
            notify('Settings file corrupted', 2);
        }
    },
    importMeshes: async () => {
        const files = await pickFiles('.glb,.gltf');
        let count = 0;
        for (const f of files) {
            const name = baseName(f.name);
            await Storage.put('meshes', name, new Uint8Array(await f.arrayBuffer()));
            count++;
        }
        await SkinManager.refreshUserContent();
        notify(`Imported ${count} meshes`);
    },
    importColorsets: async () => {
        const files = await pickFiles('.json');
        let count = 0;
        for (const f of files) {
            const name = baseName(f.name);
            await Storage.put('colorsets', name, await f.text());
            count++;
        }
        await SkinManager.refreshUserContent();
        notify(`Imported ${count} colorsets`);
    },
});


function bindInput() {
    const sm = app.sceneManager;

    document.addEventListener('mousemove', (e) => {
        app.mouse.x = e.clientX;
        app.mouse.y = e.clientY;
        if (sm.scene instanceof GameScene) sm.scene.onMouseMove(e);
    });

    let lastTouch = null;

    document.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        if (!touch) return;
        lastTouch = touch;
        app.mouse.x = touch.clientX;
        app.mouse.y = touch.clientY;
        resumeAudio();
        maybeFullscreen(e);
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        if (!touch) return;
        const previous = lastTouch ?? touch;
        const event = {
            clientX: touch.clientX,
            clientY: touch.clientY,
            movementX: touch.clientX - previous.clientX,
            movementY: touch.clientY - previous.clientY,
            target: e.target,
        };
        lastTouch = touch;
        app.mouse.x = touch.clientX;
        app.mouse.y = touch.clientY;
        if (sm.scene instanceof GameScene) sm.scene.onMouseMove(event);
    }, { passive: false });

    document.addEventListener('touchend', () => {
        lastTouch = null;
    }, { passive: false });

    document.addEventListener('mousedown', (e) => {
        resumeAudio();
        maybeFullscreen(e);
        sm.scene?.onMouseDown?.(e);
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener(
        'wheel',
        (e) => {
            if (app.overlays.onWheel(e)) e.preventDefault();
        },
        { passive: false },
    );

    document.addEventListener('pointerlockchange', () => {
        if (sm.scene instanceof GameScene) sm.scene.onPointerLockChange();
    });

    document.addEventListener('keydown', (e) => {
        resumeAudio();
        const settings = SettingsManager.settings;

        // KeybindsManager
        if (e.code === 'F1') {
            e.preventDefault();
            if (!(sm.scene instanceof GameScene && sm.scene.runner?.playing)) {
                app.wikiPopup ??= linkPopup('https://wiki.rhythia.net');
                app.wikiPopup.show(!app.wikiPopup.shown);
            }
            return;
        }
        if (e.code === 'F11' || (e.altKey && (e.code === 'Enter' || e.code === 'NumpadEnter'))) {
            e.preventDefault();
            settings.Fullscreen.value = !document.fullscreenElement;
            return;
        }
        if (e.ctrlKey && e.code === 'KeyM') {
            e.preventDefault();
            if (app.volumeBeforeMute == null) {
                app.volumeBeforeMute = settings.VolumeMaster.value;
                settings.VolumeMaster.value = 0;
            } else {
                settings.VolumeMaster.value = app.volumeBeforeMute;
                app.volumeBeforeMute = null;
            }
            SoundManager.updateVolume();
            return;
        }

        if (e.code === 'Escape' && SettingsManager.shown && !(sm.scene instanceof GameScene)) {
            app.settingsMenu.hideMenu();
            return;
        }
        if (e.code === 'Escape' && OptionPopup.hideTop()) return;
        if (e.ctrlKey && e.code === 'KeyO' && !(sm.scene instanceof MainMenu)) {
            e.preventDefault();
            app.settingsMenu.toggle();
            return;
        }

        if (['Space', 'ArrowUp', 'ArrowDown', 'Tab', 'F2', 'F3', 'Backquote'].includes(e.code) && document.activeElement?.tagName !== 'INPUT') {
            e.preventDefault();
        }
        sm.scene?.onKeyDown?.(e);
    });

    // drag & drop import (Rhythia.FilesDropped)
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
        e.preventDefault();
        const files = [...(e.dataTransfer?.files ?? [])];
        if (files.length) app.importFiles(files);
    });

    document.addEventListener('fullscreenchange', () => {
        const fs = !!document.fullscreenElement;
        for (const item of Object.values(SettingsManager.items)) {
            item.emit('updated', fs);
        }
    });

    window.addEventListener('beforeunload', () => {
        saveAll();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) saveAll();
    });
}

let fullscreenTried = false;
function maybeFullscreen(e) {
    if (fullscreenTried) return;
    if (!SettingsManager.settings.Fullscreen.value) return;
    if (document.fullscreenElement) return;
    fullscreenTried = true;
    document.documentElement.requestFullscreen?.().catch?.(() => {
        fullscreenTried = false;
    });
}


let last = performance.now();
let startedAt = performance.now();
let accumulator = 0;

function frame(now) {
    requestAnimationFrame(frame);
    const settings = SettingsManager.settings;
    let delta = (now - last) / 1000;

    if (settings.FPS.value > 0) {
        accumulator += delta;
        const interval = 1 / settings.FPS.value;
        if (accumulator < interval) {
            last = now;
            return;
        }
        delta = accumulator;
        accumulator = 0;
    }
    last = now;
    delta = Math.min(delta, 0.25);
    TIME.value = now / 1000;

    updateTweens(delta);
    const sm = app.sceneManager;
    SoundManager.refreshMenuMusicPlayback(true);
    sm.scene?.update?.(delta);

    app.overlays.update(delta);

    if (sm.scene?.render) sm.scene.render(app.backend);
}


async function boot() {
    const canvas = document.getElementById('view');
    try {
        app.backend = new RenderBackend(canvas);
    } catch (e) {
        notify(`WebGL initialization failed: ${e.message}`, 3);
        throw e;
    }

    app.sceneManager = new SceneManagerClass();
    app.overlays = new Overlays(app);
    app.menuCursor = app.overlays;

    SettingsManager.load();

    app.mouse = { x: innerWidth / 2, y: innerHeight / 2 };
    window.addEventListener('resize', () => {
        app.backend.resize();
        app.mouse.x = innerWidth / 2;
        app.mouse.y = innerHeight / 2;
    });

    Stats.GamesOpened++;

    await SkinManager.load();
    await SoundManager.updateSkin(SkinManager.skin);
    SoundManager.updateVolume();

    app.settingsMenu = new SettingsMenu(app);
    app.onSettingsShown = (shown) => {
        const scene = app.sceneManager.scene;
        if (scene instanceof GameScene) scene.capture.classList.toggle('hidden', shown || !scene.wantsCapture());
    };

    bindInput();
    requestAnimationFrame(frame);

    app.sceneManager.load('loading');

    await MapManager.initializedPromise;
    SoundManager.updateJukeboxQueue();
    if (location.hash.startsWith('#replay=')) {
        const id = decodeURIComponent(location.hash.slice(8));
        app.playReplayById(id);
    } else {
        SoundManager.stopScopedSession();
    }

    MapManager.on('mapDeleted', (map) => {
        SoundManager.updateJukeboxQueue();
        const menu = app.sceneManager.scenes.menu;
        if (menu) {
            menu.mapList.updateMaps();
            if (menu.mapList.selectedMapID === map.name) {
                menu.mapList.selectedMapID = null;
                menu.mapInfo.select(null);
            }
        }
        if (SoundManager.map?.name === map.name) {
            SoundManager.song.stop();
            SoundManager.map = null;
        }
    });

    setInterval(() => saveAll(), 60000);
}

boot();
