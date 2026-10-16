// Port of scripts/database/settings/* and scripts/SettingsManager.cs
// Profiles are stored in localStorage using the same JSON shape as profiles/<name>.json

import { Emitter } from './util.js';

export const Section = { None: 0, Gameplay: 1, Visual: 2, Audio: 3, Video: 4, Other: 5 };
export const SectionNames = ['None', 'Gameplay', 'Visual', 'Audio', 'Video', 'Other'];

const SPACES = ['skin', 'void', 'grid', 'squircles', 'waves', 'galaxy', 'tunnel', 'circulartunnel', 'tritunnel', 'vortex', 'solid', 'relic', 'conspiracy'];

export class SettingsItem extends Emitter {
    constructor(prop, def, opts = {}) {
        super();
        this.prop = prop;
        this.type = opts.type ?? (typeof def === 'boolean' ? 'bool' : typeof def === 'string' ? 'string' : def === null ? 'variant' : 'double');
        this.id = opts.id ?? prop;
        this.title = opts.title ?? '';
        this.description = opts.description ?? '';
        this.placeholder = opts.placeholder ?? '';
        this.section = opts.section ?? Section.None;
        this.slider = opts.slider ?? null;
        this.list = opts.list ? { values: [...opts.list] } : null;
        this.buttons = opts.buttons ?? [];
        this.editable = opts.editable ?? true;
        this.visible = opts.visible ?? true;
        this.saveToDisk = opts.saveToDisk ?? true;
        this.updateAction = opts.updateAction ?? null;
        this.defaultValue = def;
        this._value = def;
        this.init = false;
    }

    get value() {
        return this._value;
    }

    set value(v) {
        if (this.type === 'double') v = Number(v);
        else if (this.type === 'int') v = Math.round(Number(v));
        else if (this.type === 'bool') v = Boolean(v);
        else if (this.type === 'string') v = String(v);
        this._value = v;
        this.updateAction?.(v, !this.init);
        this.emit('updated', v);
        if (!this.init && this.id !== '') this.init = true;
    }

    valueOf() {
        return this._value;
    }

    toString() {
        return String(this._value);
    }

    reset() {
        this.value = this.defaultValue;
    }
}

export class SettingsProfile {
    constructor(hooks = {}) {
        const h = (name) => (...args) => hooks[name]?.(...args);
        const G = Section.Gameplay;
        const V = Section.Visual;
        const Vid = Section.Video;
        const A = Section.Audio;
        const O = Section.Other;
        const items = [];
        const add = (prop, def, opts) => {
            const item = new SettingsItem(prop, def, opts);
            this[prop] = item;
            items.push(item);
            return item;
        };
        const reloadSkin = (_, init) => {
            if (!init) h('reloadSkin')();
        };
        const updateVolume = (_, init) => {
            if (!init) h('updateVolume')();
        };

        // ---- Gameplay
        add('Sensitivity', 0.5, { title: 'Sensitivity', description: 'Adjusts cursor sensitivity', section: G, slider: { step: 0.01, min: 0.01, max: 2.5 } });
        add('AbsoluteSensitivity', 1.0, { title: 'Absolute Sensitivity', description: 'Adjusts absolute area scale', section: G, slider: { step: 0.01, min: 0.01, max: 4.0 } });
        add('AbsoluteInput', false, { title: 'Absolute Input', description: 'Toggles absolute inputs', section: G });
        add('CursorDrift', true, { title: 'Cursor Drift', description: 'Toggles cursor drift', section: G });
        add('ApproachRate', 30, {
            title: 'Approach Rate',
            description: '(AR) Approach rate of hit objects, adjusts how fast hit objects come to the playfield (bigger # = faster)',
            section: G,
            updateAction: () => this.updateApproachTime(),
            slider: { step: 0.5, min: 0.5, max: 100 },
        });
        add('ApproachDistance', 15, {
            title: 'Approach Distance',
            description: '(AD) Approach distance of hit objects, adjusts how far away hit objects spawn (bigger # = further)',
            section: G,
            updateAction: () => this.updateApproachTime(),
            slider: { step: 0.5, min: 0.5, max: 100 },
        });
        add('ApproachTime', 0, { title: 'Approach Time', description: 'Approach time of hit objects', section: G, visible: false, saveToDisk: false });
        add('FadeIn', 10, {
            title: 'Fade In',
            description: 'Starting from when hit objects spawn in, the distance required to travel before becoming fully opaque',
            section: G,
            slider: { step: 1, min: 0, max: 100 },
        });
        add('FadeOut', 75, { title: 'Fade Out', description: 'The transparency of hit objects when going past the playfield', section: G, slider: { step: 1, min: 0, max: 100 } });
        add('Pushback', true, { title: 'Pushback', description: 'Toggles whether hit objects are visible past the playfield or not', section: G });
        add('CameraParallax', 0.25, { title: 'Camera Parallax', description: 'Adjusts the camera parallax', section: G, slider: { step: 0.05, min: 0, max: 1 } });
        add('HUDParallax', 0, { title: 'HUD Parallax', description: '(Not implemented) Adjusts the HUD parallax', section: G, slider: { step: 0.05, min: 0, max: 1 } });
        add('FoV', 70, { title: 'Field of View', description: 'Adjusts the field of view', section: G, slider: { step: 1, min: 60, max: 120 } });

        // ---- Visual
        add('Skin', 'default', {
            title: 'Skin',
            description: 'Selected skin for the game',
            section: V,
            updateAction: reloadSkin,
            buttons: [{ title: 'Skin Folder', description: 'Open the skin folder', onPressed: () => h('openSkinFolder')() }],
            list: ['default'],
        });
        add('MenuSpace', 'skin', { title: 'Menu Space', description: "Overrides the skin's background space for the menu", section: V, updateAction: reloadSkin, list: SPACES });
        add('GameSpace', 'skin', { title: 'Game Space', description: "Overrides the skin's background space for gameplay", section: V, updateAction: reloadSkin, list: SPACES });
        add('SpaceHitEffects', true, { title: 'Space Hit Effects', description: 'Toggles note hit effects for the game space', section: V });
        add('SpaceEffects', true, { title: 'Space Effects', description: 'Toggles non-hit effects for the game space', section: V });
        add('NoteColors', 'skin', { id: 'Colors', title: 'Colors', description: "Overrides the skin's colorset", section: V, updateAction: reloadSkin, list: ['skin', 'default'] });
        add('NoteOpacity', 1, { title: 'Note Opacity', description: 'Sets the maximum opacity for the notes', section: V, slider: { step: 0.05, min: 0, max: 1 } });
        add('NoteOpacityExponent', 1.25, {
            title: 'Note Opacity Exponent',
            description: 'Adjusts the note opacity curve, a higher value will make any sort of transparency appear more quickly',
            section: V,
            slider: { step: 0.05, min: 1, max: 2 },
        });
        add('NoteMesh', 'skin', { title: 'Note Mesh', description: "Overrides the skin's note mesh", section: V, updateAction: reloadSkin, list: ['skin'] });
        add('NoteSize', 0.875, { title: 'Note Size', description: 'Sets the size of the notes, does not change hitboxes', section: V, slider: { step: 0.025, min: 0, max: 2 } });
        add('CursorScale', 1, { title: 'Cursor Scale', description: 'Adjusts the cursor scale, does not change hitboxes', section: V, slider: { step: 0.025, min: 0, max: 4 } });
        add('CursorOpacity', 1, { title: 'Cursor Opacity', description: 'Adjusts the cursor opacity', section: V, slider: { step: 0.05, min: 0, max: 1 } });
        add('CursorRotation', 0, { title: 'Cursor Rotation', description: 'Degrees to rotate the cursor by every second', section: V, slider: { step: 1, min: -360, max: 360 } });
        add('CursorTrail', false, { title: 'Cursor Trail', description: 'Toggles a trail for your cursor', section: V });
        add('TrailTime', 0.05, { title: 'Cursor Trail Time', description: 'Adjusts trail visibility time', section: V, slider: { step: 0.01, min: 0, max: 0.5 } });
        add('TrailDetail', 100, {
            title: 'Cursor Trail Detail',
            description: 'Adjusts the detail for the trail, a high value may impact performance',
            section: V,
            slider: { step: 1, min: 0, max: 500 },
        });
        add('UseCursorInMenus', false, {
            title: 'Use Cursor in Menus',
            description: "Uses the skin's cursor instead of the native cursor",
            section: V,
            updateAction: (v) => h('menuCursor')(v),
        });
        add('HPLerpValue', 60, {
            title: 'HP Bar Easing Value',
            description: 'Adjusts how smooth, or harsh, the HP Bar eases in while it updates',
            section: V,
            slider: { step: 1, min: 10, max: 100 },
        });
        add('GridGuides', true, { title: 'Grid Guides', description: 'Enables grid guides', section: V });
        add('SimpleHUD', false, {
            title: 'Simple HUD',
            description: 'Hides the regular left and right panels, and instead displays a simple miss counter on the right',
            section: V,
        });
        add('SuperSimpleHUD', false, { title: 'Super Simple HUD', description: 'Hides health bar, song duration, and song name', section: V });
        add('AltComboCounter', false, { title: 'Alt. Combo Counter', description: 'Moves the Combo Counter to the HUD', section: V });
        add('VisibilityAssist', false, {
            title: 'Visibility Assist',
            description: 'Enables a dark radial fade to help with visibility (impacts performance significantly)',
            section: V,
        });
        add('HitPopups', true, { title: 'Hit Score Popups', description: 'Toggles a popup on a hit', section: V });
        add('MissPopups', true, { title: 'Miss Popups', description: 'Toggles a popup on a miss', section: V });

        // ---- Video
        add('Fullscreen', true, { title: 'Fullscreen', description: 'Toggles the window to fullscreen', section: Vid, updateAction: (v, init) => h('fullscreen')(v, init) });
        add('BorderlessFullscreen', false, {
            title: 'Borderless Fullscreen',
            description: 'Alters the Fullscreen toggle to use Borderless fullscreen instead of Exclusive, may fix some issues with drawing tablets',
            section: Vid,
        });
        add('LockFPS', false, { title: 'Lock FPS', description: 'Locks maximum frames per second', section: Vid });
        add('FPS', 240, {
            type: 'int',
            title: 'FPS',
            description: 'Adjusts maximum frames per second, we recommend this being 2x your refresh rate',
            section: Vid,
            slider: { step: 5, min: 30, max: 1000 },
        });
        add('VSyncMenus', true, { title: 'V-Sync in Menus', description: 'Toggles V-Sync when in menus', section: Vid });
        add('AntiAliasing', 'Off (roughest)', {
            title: 'Anti Aliasing',
            description: 'Smoothes edges, at the cost of performance',
            section: Vid,
            updateAction: (v, init) => h('antiAliasing')(v, init),
            list: ['Off (roughest)', '2x (rough)', '4x (smooth)', '8x (smoothest)'],
        });

        // ---- Audio
        const vol = { step: 1, min: 0, max: 100 };
        add('VolumeMaster', 50, { title: 'Master Volume', description: 'Master volume control for all audio', section: A, updateAction: updateVolume, slider: vol });
        add('VolumeMusic', 50, { title: 'Music Volume', description: 'Audio control for the music', section: A, updateAction: updateVolume, slider: vol });
        add('VolumeSFX', 50, { title: 'SFX Volume', description: 'Audio control for other sound effects', section: A, updateAction: updateVolume, slider: vol });
        add('VolumeHitSound', 50, { title: 'Hit Sound Volume', description: 'Audio control for hit sound', section: A, updateAction: updateVolume, slider: vol });
        add('VolumeMissSound', 50, { title: 'Miss Sound Volume', description: 'Audio control for miss sound', section: A, updateAction: updateVolume, slider: vol });
        add('VolumeMenuMusic', 50, { title: 'Menu Music Volume', description: 'Audio control for menu music', section: A, updateAction: updateVolume, slider: vol });
        add('AlwaysPlayHitSound', false, { title: 'Always Play Hit Sound', description: 'Toggles hit sound to always play', section: A });
        add('EnableHitSound', true, { title: 'Enable Hit Sound', description: 'Enables hit sound playback', section: A });
        add('EnableMissSound', true, { title: 'Enable Miss Sound', description: 'Enables miss sound playback', section: A });
        add('EnableMenuMusic', true, {
            title: 'Enable Menu Music',
            description: 'Enables menu music playback when the menu is quiet',
            section: A,
            updateAction: (_, init) => {
                if (!init) h('refreshMenuMusic')();
            },
        });
        add('AutoplayJukebox', true, { title: 'Autoplay Jukebox', description: 'Automatically plays the jukebox on start', section: A });
        add('LocalOffset', 0, { title: 'Local Offset', description: 'Adjusts audio offset in milliseconds', section: A, slider: { step: 1, min: -500, max: 500 } });

        // ---- Other
        // Browser builds have no user folder on disk, data lives in the browser's IndexedDB instead
        add('SetUserFolderPath', 'browser storage (IndexedDB)', {
            title: 'Path To User Folder',
            description: "Set the path where Rhythia stores it's files",
            section: O,
            placeholder: 'browser storage (IndexedDB)',
            editable: false,
            saveToDisk: false,
        });
        add('SetUserFolderDialog', null, {
            title: '',
            description: '',
            section: O,
            buttons: [
                { title: 'Export User Folder', description: 'Download every map, replay and score as a backup', onPressed: () => h('exportUserData')() },
                { title: 'Import User Folder', description: 'Restore a backup made with Export User Folder', onPressed: () => h('importUserData')() },
            ],
        });
        add('DisplayFPS', true, { title: 'Display FPS', description: 'Toggles the framerate counter in the corner', section: O });
        add('ImportNightlyProfile', null, {
            title: 'Import Nightly Settings',
            description: 'Imports settings from the nightly client',
            section: O,
            buttons: [{ title: 'Import', description: 'Import manually from a nightly settings file', onPressed: () => h('importNightly')() }],
            saveToDisk: false,
        });
        add('NightlyImportDialog', null, { title: '', description: '', section: O, visible: false, saveToDisk: false });
        add('ImportNightlyMeshes', null, {
            title: 'Import Nightly Meshes',
            description: 'Imports meshes from the nightly folder',
            section: O,
            buttons: [{ title: 'Import Nightly Meshes', description: 'Choose .obj (and .mtl) files from the nightly meshes folder', onPressed: () => h('importMeshes')() }],
            saveToDisk: false,
        });
        add('ImportNightlyColorsets', null, {
            title: 'Import Nightly Colorsets',
            description: 'Imports colorsets from the nightly folder',
            section: O,
            buttons: [{ title: 'Import Nightly Colorsets', description: 'Choose .txt files from the nightly colorsets folder', onPressed: () => h('importColorsets')() }],
            saveToDisk: false,
        });
        add('RecordReplays', true, { title: 'Record Replays', description: 'Toggles recording for replays', section: O });
        add('OptionalPlaytestParameters', true, {
            title: 'Use Editor Playtest Settings',
            description: 'Takes "Start From" and "Speed" from external editors like the SSQE when using the "Playtest" button',
            section: O,
        });
        add('ResetToDefaults', null, {
            title: 'Reset to Defaults',
            description: 'Resets all settings to default values',
            section: O,
            buttons: [{ title: 'Reset', description: 'WARNING: THIS RESETS YOUR CURRENT PROFILE', onPressed: () => h('resetToDefaults')() }],
        });

        this.items = items;
        this.updateApproachTime();
    }

    updateApproachTime() {
        if (this.ApproachTime && this.ApproachDistance && this.ApproachRate) {
            this.ApproachTime.value = this.ApproachDistance.value / this.ApproachRate.value;
        }
    }

    toOrderedSectionList() {
        const out = new Map();
        for (let s = 0; s < SectionNames.length; s++) out.set(s, []);
        for (const item of this.items) out.get(item.section).push(item);
        return out;
    }

    serialize() {
        const data = { _Version: 1 };
        for (const item of this.items) {
            if (!item.saveToDisk) continue;
            let v = item.value;
            if (item.type === 'double') v = Math.round(v * 10000) / 10000;
            data[item.prop] = v;
        }
        return JSON.stringify(data, null, '\t');
    }

    deserialize(json) {
        const data = typeof json === 'string' ? JSON.parse(json) : json;
        for (const item of this.items) {
            if (!item.saveToDisk) continue;
            if (Object.prototype.hasOwnProperty.call(data, item.prop)) item.value = data[item.prop];
            else item.reset();
        }
    }
}

// ---------------------------------------------------------------- SettingsManager

const PROFILE_KEY = (name) => `rhythia.profiles.${name}`;
const CURRENT_KEY = 'rhythia.current_profile';

class SettingsManagerClass extends Emitter {
    constructor() {
        super();
        this.shown = false;
        this.hideNotifications = false;
        this.hooks = {};
        this.settings = new SettingsProfile(this.hooks);
    }

    setHooks(hooks) {
        Object.assign(this.hooks, hooks);
    }

    getCurrentProfile() {
        try {
            return localStorage.getItem(CURRENT_KEY) || 'default';
        } catch {
            return 'default';
        }
    }

    setCurrentProfile(profile = this.getCurrentProfile()) {
        try {
            localStorage.setItem(CURRENT_KEY, profile);
        } catch {}
    }

    getProfiles() {
        const names = new Set(['default']);
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith('rhythia.profiles.')) names.add(key.slice('rhythia.profiles.'.length));
            }
        } catch {}
        return [...names].sort();
    }

    profileExists(name) {
        try {
            return localStorage.getItem(PROFILE_KEY(name)) != null;
        } catch {
            return false;
        }
    }

    save(profile = this.getCurrentProfile()) {
        try {
            localStorage.setItem(PROFILE_KEY(profile), this.settings.serialize());
        } catch {}
        this.emit('saved');
    }

    saveJson(profile, json) {
        try {
            localStorage.setItem(PROFILE_KEY(profile), json);
        } catch {}
    }

    deleteProfile(profile) {
        try {
            localStorage.removeItem(PROFILE_KEY(profile));
        } catch {}
    }

    load(profile = this.getCurrentProfile()) {
        let ok = true;
        try {
            const raw = localStorage.getItem(PROFILE_KEY(profile));
            if (raw == null) {
                this.save(profile);
            } else {
                this.settings.deserialize(raw);
            }
            this.hooks.notify?.(`Loaded profile [${profile}]`);
        } catch (e) {
            ok = false;
            console.error(e);
            this.hooks.notify?.('Settings file corrupted', 2);
        }
        this.emit('loaded');
        return ok;
    }

    resetToDefaults() {
        this.hideNotifications = true;
        const defaults = new SettingsProfile({});
        for (const item of this.settings.items) {
            if (item.prop === 'SetUserFolderPath' || item.prop === 'SetUserFolderDialog') continue;
            item.value = defaults[item.prop].value;
        }
        this.save();
        this.hideNotifications = false;
        this.emit('loaded');
    }
}

export const SettingsManager = new SettingsManagerClass();
