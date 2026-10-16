// Port of scripts/skinning/SkinManager.cs, SkinProfile.cs and SkinConfig.cs
// The default skin, meshes and colorsets are read straight from the repository's user/ folder.
// Colorsets and meshes imported through the settings menu are kept in IndexedDB.

import * as THREE from 'three';
import { OBJLoader } from '../vendor/OBJLoader.js';
import { USER_RES } from './constants.js';
import { SettingsManager } from './settings.js';
import { Storage } from './storage.js';
import { Emitter, parseColor } from './util.js';

export const BUILTIN_COLORSETS = [
    'Café au lait',
    'Cotton Candy',
    'default',
    'Hamster Skittles',
    'Light Blue and White',
    'Mocha',
    'Nebula',
    'Petunia Fade',
    'Purple Pastel',
    'Sunset',
    'Tan',
    'Tundra',
];

export const BUILTIN_MESHES = ['cube', 'plane', 'square', 'squircle'];

const TEXTURES = {
    cursorImage: 'game/cursor.png',
    gridImage: 'game/grid.png',
    gridGuidesImage: 'game/grid_guides.png',
    visibilityAssistImage: 'game/visibility_assist.png',
    panelLeftBackgroundImage: 'game/panel_left_background.png',
    panelRightBackgroundImage: 'game/panel_right_background.png',
    healthImage: 'game/health.png',
    healthBackgroundImage: 'game/health_background.png',
    progressImage: 'game/progress.png',
    progressBackgroundImage: 'game/progress_background.png',
    hitsImage: 'game/hits.png',
    missesImage: 'game/misses.png',
    missFeedbackImage: 'game/miss_feedback.png',
    settingsButtonImage: 'ui/buttons/settings.png',
    openFolderButtonImage: 'ui/buttons/open_folder.png',
    importButtonImage: 'ui/buttons/import.png',
    randomButtonImage: 'ui/buttons/random.png',
    filterButtonImage: 'ui/buttons/filter.png',
    sortButtonImage: 'ui/buttons/sort.png',
    sortAscendButtonImage: 'ui/buttons/sort_ascend.png',
    authorButtonImage: 'ui/buttons/author.png',
    searchButtonImage: 'ui/buttons/search.png',
    layoutListButtonImage: 'ui/buttons/layout_list.png',
    layoutGridButtonImage: 'ui/buttons/layout_grid.png',
    speedPresetMinusMinusButtonImage: 'ui/buttons/speed_minus_minus.png',
    speedPresetMinusButtonImage: 'ui/buttons/speed_minus.png',
    speedPresetMiddleButtonImage: 'ui/buttons/speed_middle.png',
    speedPresetPlusButtonImage: 'ui/buttons/speed_plus.png',
    speedPresetPlusPlusButtonImage: 'ui/buttons/speed_plus_plus.png',
    playButtonImage: 'ui/buttons/play.png',
    favoriteButtonImage: 'ui/buttons/favorite.png',
    unfavoriteButtonImage: 'ui/buttons/unfavorite.png',
    copyButtonImage: 'ui/buttons/copy.png',
    deleteButtonImage: 'ui/buttons/delete.png',
    addVideoButtonImage: 'ui/buttons/add_video.png',
    removeVideoButtonImage: 'ui/buttons/remove_video.png',
    exportButtonImage: 'ui/buttons/export.png',
    grabberNormalImage: 'ui/buttons/grabber_normal.png',
    grabberPressedImage: 'ui/buttons/grabber_pressed.png',
    grabberTickImage: 'ui/buttons/grabber_tick.png',
    jukeboxPlayImage: 'ui/jukebox_play.png',
    jukeboxPauseImage: 'ui/jukebox_pause.png',
    jukeboxSkipImage: 'ui/jukebox_skip.png',
    backgroundTileImage: 'ui/background_tile.png',
    favoriteImage: 'ui/play/favorite.png',
    mapListMaskImage: 'ui/play/maplist_mask.png',
    mapListSelectionCursorImage: 'ui/play/maplist_selection_cursor.png',
    mapListScrollBarTopImage: 'ui/play/scrollbar_top.png',
    mapListScrollBarMiddleImage: 'ui/play/scrollbar_middle.png',
    mapListScrollBarBottomImage: 'ui/play/scrollbar_bottom.png',
    mapListScrollBarBackgroundTopImage: 'ui/play/scrollbar_background_top.png',
    mapListScrollBarBackgroundMiddleImage: 'ui/play/scrollbar_background_middle.png',
    mapListScrollBarBackgroundBottomImage: 'ui/play/scrollbar_background_bottom.png',
    mapListGridCoverBackgroundImage: 'ui/play/grid_cover_background.png',
    mapInfoCoverBackgroundImage: 'ui/play/mapinfo_cover_background.png',
    modNoFailImage: 'modifiers/nofail.png',
    modAutoplayImage: 'modifiers/autoplay.png',
    modGhostImage: 'modifiers/ghost.png',
    modStrobeImage: 'modifiers/strobe.png',
    modChaosImage: 'modifiers/chaos.png',
    modVortexImage: 'modifiers/vortex.png',
    modEarthquakeImage: 'modifiers/earthquake.png',
    modHFlipImage: 'modifiers/hflip.png',
    modVFlipImage: 'modifiers/vflip.png',
};

const MOD_ICONS = {
    NoFail: 'modNoFailImage',
    Autoplay: 'modAutoplayImage',
    Ghost: 'modGhostImage',
    Strobe: 'modStrobeImage',
    Chaos: 'modChaosImage',
    Vortex: 'modVortexImage',
    Earthquake: 'modEarthquakeImage',
    HFlip: 'modHFlipImage',
    VFlip: 'modVFlipImage',
};

export class SkinConfig {
    constructor() {
        this.themeColor = 'c90045';
        this.noteColors = 'default';
        this.noteMesh = 'squircle';
        this.gameSpace = 'grid';
        this.menuSpace = 'waves';
    }
}

async function fetchBytes(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return new Uint8Array(await res.arrayBuffer());
    } catch {
        return null;
    }
}

async function fetchText(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.text();
    } catch {
        return null;
    }
}

const textureLoader = new THREE.TextureLoader();

function loadTexture(url) {
    return new Promise((resolve) => {
        textureLoader.load(
            url,
            (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.generateMipmaps = true;
                tex.minFilter = THREE.LinearMipmapLinearFilter;
                tex.magFilter = THREE.LinearFilter;
                tex.anisotropy = 4;
                resolve(tex);
            },
            undefined,
            () => resolve(null),
        );
    });
}

export function parseColorset(text) {
    // StripEdges().ReplaceLineEndings(",").Split(",")
    const split = text.trim().replace(/\r\n|\r|\n/g, ',').split(',');
    return split.map((s) => parseColor(s, { r: 1, g: 1, b: 1, a: 1 }));
}

export function parseObj(text) {
    const group = new OBJLoader().parse(text);
    const geometries = [];
    group.traverse((o) => {
        if (o.isMesh) geometries.push(o.geometry);
    });
    if (geometries.length === 0) return null;
    // collapse into a single non-indexed geometry with positions + normals
    let total = 0;
    for (const g of geometries) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3);
    let off = 0;
    for (const g of geometries) {
        pos.set(g.attributes.position.array, off);
        off += g.attributes.position.array.length;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

class SkinManagerClass extends Emitter {
    constructor() {
        super();
        this.skin = {
            config: new SkinConfig(),
            noteColors: [parseColor('ff0059'), parseColor('ffd8e6')],
            noteMesh: null,
            urls: {},
            textures: {},
        };
        this.colorsetNames = [...BUILTIN_COLORSETS];
        this.meshNames = [...BUILTIN_MESHES];
        this.notify = () => {};
    }

    skinPath(path) {
        return `${USER_RES}/skins/${SettingsManager.settings.Skin.value}/${path}`;
    }

    url(key) {
        return this.skin.urls[key];
    }

    modIconUrl(name) {
        return this.skin.urls[MOD_ICONS[name]];
    }

    async refreshUserContent() {
        const colorsets = (await Storage.keys('colorsets')).map(String);
        const meshes = (await Storage.keys('meshes')).map(String);
        this.colorsetNames = [...new Set([...BUILTIN_COLORSETS, ...colorsets])];
        this.meshNames = [...new Set([...BUILTIN_MESHES, ...meshes])];
        const s = SettingsManager.settings;
        s.NoteColors.list.values = [...new Set(['skin', 'default', ...this.colorsetNames])];
        s.NoteMesh.list.values = ['skin', ...this.meshNames];
    }

    async loadColorset(name) {
        const stored = await Storage.get('colorsets', name);
        if (stored) return parseColorset(stored);
        if (BUILTIN_COLORSETS.includes(name)) {
            const text = await fetchText(`${USER_RES}/colorsets/${encodeURIComponent(name)}.txt`);
            if (text != null) return parseColorset(text);
        }
        return null;
    }

    async loadMesh(name) {
        const stored = await Storage.get('meshes', name);
        let text = stored ?? null;
        if (text == null && BUILTIN_MESHES.includes(name)) text = await fetchText(`${USER_RES}/meshes/${name}.obj`);
        if (text == null) text = await fetchText(`${USER_RES}/meshes/squircle.obj`);
        return parseObj(text);
    }

    async load() {
        const settings = SettingsManager.settings;
        const skin = this.skin;

        skin.config = new SkinConfig();

        // Textures (served as URLs for the DOM and as THREE textures for 3D)
        for (const [key, path] of Object.entries(TEXTURES)) skin.urls[key] = this.skinPath(path);
        const gameKeys = Object.keys(TEXTURES).filter((k) => TEXTURES[k].startsWith('game/') || TEXTURES[k].startsWith('modifiers/'));
        const loaded = await Promise.all(gameKeys.map((k) => loadTexture(skin.urls[k])));
        gameKeys.forEach((k, i) => {
            skin.textures[k]?.dispose?.();
            skin.textures[k] = loaded[i];
        });

        // Sounds
        const [hit, miss, fail, menu] = await Promise.all([
            fetchBytes(this.skinPath('hit.mp3')),
            fetchBytes(this.skinPath('miss.mp3')),
            fetchBytes(this.skinPath('fail.mp3')),
            fetchBytes(this.skinPath('menu.mp3')),
        ]);
        skin.hitSoundBuffer = hit ?? new Uint8Array();
        skin.missSoundBuffer = miss ?? new Uint8Array();
        skin.failSoundBuffer = fail ?? new Uint8Array();
        skin.menuMusicBuffer = menu ?? new Uint8Array();

        await this.refreshUserContent();

        // Mesh
        const meshName = settings.NoteMesh.value === 'skin' ? skin.config.noteMesh : settings.NoteMesh.value;
        skin.noteMesh?.dispose?.();
        skin.noteMesh = await this.loadMesh(meshName);

        // Colors
        const colorsetName = settings.NoteColors.value === 'skin' ? skin.config.noteColors : settings.NoteColors.value;
        const colors = await this.loadColorset(colorsetName);
        if (colors && colors.length) skin.noteColors = colors;

        // Spaces
        skin.gameSpace = settings.GameSpace.value === 'skin' ? skin.config.gameSpace : settings.GameSpace.value;
        skin.menuSpace = settings.MenuSpace.value === 'skin' ? skin.config.menuSpace : settings.MenuSpace.value;

        if (!SettingsManager.hideNotifications) this.notify(`Loaded skin [${settings.Skin.value}]`);
        this.emit('loaded', skin);
    }
}

export const SkinManager = new SkinManagerClass();
