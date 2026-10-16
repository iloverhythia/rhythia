// Port of scripts/scenes/Game.cs, scripts/PlayerInputController.cs, scripts/game/managers/CursorManager.cs,
// scripts/game/renderers/TrailRenderer.cs, scripts/game/ui/PauseMenu.cs and the playback half of ReplayManager.cs

import * as THREE from 'three';
import { BOUNDS, CURSOR_SIZE } from '../constants.js';
import { Leaderboard, Score } from '../map/leaderboard.js';
import { Storage } from '../storage.js';
import { Trans, angleDifference, clamp, formatTime, inverseLerp, tween, v2clamp, v2finite, v2lerp } from '../util.js';
import { Attempt } from './attempt.js';
import { CameraSpin, basisZ } from './camera.js';
import { Hud } from './hud.js';
import { NoteRenderer } from './noteRenderer.js';
import { ReplayRecorder } from './replay.js';
import { Runner } from './runner.js';

const TRAIL_SPAWN_RATE = 240;
const TRAIL_MAX_DETAIL = 100;

function el(tag, cls, parent, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    parent?.appendChild(e);
    return e;
}

// Godot Basis.LookingAt(dir, up).GetEuler() (YXZ)
function lookingAtEuler(dir) {
    const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const d = { x: dir.x / l, y: dir.y / l, z: dir.z / l };
    return { x: Math.asin(clamp(d.y, -1, 1)), y: Math.atan2(-d.x, -d.z), z: 0 };
}

export class GameScene {
    constructor(app) {
        this.app = app;
        this.name = 'SceneGame';
        this.useGameSpace = true;
        this.addSpaceAsChild = true;

        this.element = el('div', 'scene scene-game');
        this.buildDom();

        this.scene = new THREE.Scene();
        this.gameGroup = new THREE.Group();
        this.scene.add(this.gameGroup);
        this.hudGroup = new THREE.Group();
        this.renderersGroup = new THREE.Group();
        this.gameGroup.add(this.hudGroup, this.renderersGroup);

        this.camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 4000);
        this.camera.rotation.order = 'YXZ';
        this.camera.position.set(0, 0, 3.75);

        this.orthoCamera = new THREE.OrthographicCamera(-2.25, 2.25, 2.25, -2.25, 0.05, 139);
        this.orthoCamera.position.set(0, 0, 0.60892284);

        this.attempt = null;
        this.space = null;
        this.menuShown = false;
        this.fadeoutToggleValue = -1;
        this.trails = [];
        this.deltaAccumulator = 0;
        this.cursors = [];
        this.lockRequested = false;
        this.viewerVisible = false;
        this.canShowOrtho = false;
        this.seekerHovered = false;
    }

    // ---------------------------------------------------------------- DOM (pause menu, replay viewer)

    buildDom() {
        const root = this.element;

        this.capture = el('div', 'capture-hint hidden', root, 'Click to capture the cursor');

        // ReplayViewer
        this.viewer = el('div', 'replay-viewer', root);
        this.viewerBackground = el('div', 'replay-viewer-bg', this.viewer);
        this.orthoPanel = el('div', 'replay-ortho', this.viewer);
        this.viewerTip = el('div', 'replay-tip', this.viewer, 'Press F2 to hide replay UI, F3 to hide orthogonal camera, F to toggle note fade out, P to toggle note pushback');
        this.viewerPause = el('button', 'replay-pause', this.viewer);
        this.viewerTime = el('div', 'replay-time', this.viewer, '0:00 / 0:00');
        this.viewerSeek = el('input', 'slider replay-seek', this.viewer);
        this.viewerSeek.type = 'range';
        this.viewerSeek.min = 0;
        this.viewerSeek.max = 1;
        this.viewerSeek.step = 'any';
        this.viewerPause.addEventListener('click', () => this.togglePause());
        this.viewerSeek.addEventListener('input', () => this.updateSeekLabel(Number(this.viewerSeek.value)));
        this.viewerSeek.addEventListener('pointerdown', () => (this.seekerHovered = true));
        this.viewerSeek.addEventListener('change', () => {
            this.seek(Number(this.viewerSeek.value));
            this.seekerHovered = false;
            this.viewerSeek.blur();
        });

        // Pause Menu
        this.menu = el('div', 'pause-menu hidden', root);
        el('div', 'pause-bg', this.menu);
        const hide = el('button', 'pause-hide', this.menu);
        hide.addEventListener('mousedown', (e) => {
            if (e.button <= 1) this.hideMenu();
        });
        hide.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.hideMenu();
        });
        const holder = el('div', 'pause-holder', this.menu);
        el('div', 'pause-header', holder, 'PAUSED');
        el('div', 'pause-separator', holder);
        const button = (text, fn) => {
            const b = el('button', 'pause-button', holder, text);
            b.addEventListener('click', fn);
            return b;
        };
        button('RESUME', () => this.hideMenu());
        button('RESTART', () => this.restart());
        button('SETTINGS', () => this.app.settingsMenu.showMenu());
        button('GIVE UP', () => this.runner.giveUp());
        el('div', 'pause-note', holder, 'NOTE: Pausing disqualifies your pass');
    }

    // ---------------------------------------------------------------- static entry (Game.Play)

    static async play(app, map, speed, startFrom, cameraMode, mods, players = null, replays = null) {
        if (GameScene.startQueued) return;
        GameScene.startQueued = true;
        try {
            const parsed = await app.mapManager.decode(map);
            parsed.ephemeral = map.ephemeral ?? false;
            const audio = parsed.audioBuffer ? await app.decodeMapAudio(parsed) : null;
            const attempt = new Attempt({
                map: parsed,
                speed,
                startFrom,
                cameraMode,
                mods,
                players,
                replays,
                settings: app.settingsManager.settings,
                skin: app.skinManager.skin,
                songLength: audio?.duration ?? 0,
            });
            attempt.audio = audio;
            GameScene.attempt = attempt;
            app.sceneManager.load('game');
        } catch (e) {
            console.error(e);
            GameScene.startQueued = false;
        }
    }

    // ---------------------------------------------------------------- scene lifecycle

    async load() {
        const app = this.app;
        const attempt = GameScene.attempt;
        this.attempt = attempt;
        const settings = attempt.settings;
        this.runnerSettings = attempt.isReplay ? attempt.replays[0].settings : settings;

        this.runner = new Runner({
            sound: app.sound,
            stats: app.stats,
            settingsManager: app.settingsManager,
            onStop: (results) => {
                this.releasePointer();
                if (results) app.sceneManager.load('results');
            },
            onSaveReplay: (a) => (a.savePromise = this.saveReplay(a)),
            onLeaderboard: (a, speed) => (a.scorePromise = this.saveScore(a, speed)),
        });
        this.runner.skinColors = app.skinManager.skin.noteColors;
        this.runner.tempMode = false;

        this.hud = new Hud({ group: this.hudGroup, skinManager: app.skinManager, sound: app.sound });
        await this.hud.loadImages();
        this.runner.hud = this.hud;

        this.noteRenderer?.dispose();
        this.noteRenderer = new NoteRenderer(this.runner, this.renderersGroup, app.skinManager);
        this.runner.renderers = [this.noteRenderer];
        this.runner.cursorManager = this;
        this.runner.replayManager = this;
        this.runner.attempt = attempt;

        // space
        this.space = app.sceneManager.space;
        if (this.space) {
            this.scene.add(this.space.root);
            this.space.updateState(true);
            this.space.updateMap(attempt.map, await app.mapManager.getCoverUrl(attempt.map));
            this.unsubHit = this.runner.on('hitResultChanged', (_, r) => {
                if (r === 1) this.space.onHit(attempt.combo);
            });
        }

        // song
        const song = app.sound.song;
        song.stop();
        song.stream = attempt.audio ?? null;
        song.pitchScale = attempt.speed;

        // CursorManager._EnterTree
        this.camera.position.set(0, 0, 3.75);
        this.camera.rotation.set(0, 0, 0);
        this.camera.fov = this.runnerSettings.FoV.value;

        this.replayLength = attempt.isReplay ? attempt.maxReplayLength : 0;
        this.cursorPosition = { x: 0, y: 0 };
        this.recorder = null;

        this.menuShown = false;
        this.menu.classList.add('hidden');
        this.menu.style.opacity = 0;

        if (attempt.isReplay) this.mode = 'PLAYBACK';
        else if (settings.RecordReplays.value && !attempt.modifiers.some((m) => m.name === 'Autoplay')) {
            this.recorder = new ReplayRecorder(attempt);
            this.mode = 'RECORD';
        } else this.mode = 'NONE';

        this.trails = [];
        this.deltaAccumulator = 0;

        this.runner.play();

        // cursors (after hud.init created the cursor mesh)
        this.cursors = [this.hud.cursor];
        if (attempt.isReplay) {
            for (let i = 1; i < attempt.replays.length; i++) {
                const c = this.hud.cursor.clone();
                c.material = this.hud.cursor.material.clone();
                this.hud.add(c);
                this.cursors.push(c);
            }
        }

        this.showReplayViewer(attempt, attempt.isReplay);
        this.showOrthogonalCamera(attempt, attempt.isReplay);
        this.updateSeekLabel(0);

        GameScene.startQueued = false;

        if (!attempt.isReplay) {
            app.stats.Attempts++;
            const cached = app.mapManager.getMapByName(attempt.map.name);
            if (cached) {
                cached.playCount++;
                app.mapManager.update(cached);
            }
        }

        this.lastPointerLock = 0;
        this.capturePointer();
        app.menuCursor.updateVisible(false);
    }

    unload() {
        this.releasePointer();
        this.unsubHit?.();
        this.runner?.removeAllListeners?.();
        this.hud?.clear();
        this.noteRenderer?.dispose();
        this.noteRenderer = null;
        if (this.space) this.scene.remove(this.space.root);
        this.capture.classList.add('hidden');
    }

    // ---------------------------------------------------------------- pointer handling

    wantsCapture() {
        const a = this.attempt;
        return a && !a.isReplay && !a.settings.AbsoluteInput.value && !this.menuShown && this.runner?.playing !== undefined;
    }

    capturePointer() {
        const a = this.attempt;
        const canvas = this.app.backend.canvas;
        if (!a || a.isReplay) {
            document.body.classList.toggle('hide-cursor', a?.isReplay && !this.viewerVisible);
            return;
        }
        if (a.settings.AbsoluteInput.value) {
            document.body.classList.add('hide-cursor');
            return;
        }
        if (document.pointerLockElement === canvas) return;
        this.lockRequested = true;
        try {
            const p = canvas.requestPointerLock({ unadjustedMovement: true });
            if (p?.catch) {
                p.catch(() => {
                    const p2 = canvas.requestPointerLock();
                    p2?.catch?.(() => this.capture.classList.remove('hidden'));
                });
            }
        } catch {
            this.capture.classList.remove('hidden');
        }
    }

    releasePointer() {
        this.lockRequested = false;
        document.body.classList.remove('hide-cursor');
        if (document.pointerLockElement) document.exitPointerLock();
    }

    onPointerLockChange() {
        const locked = document.pointerLockElement === this.app.backend.canvas;
        this.capture.classList.toggle('hidden', locked || !this.wantsCapture() || !this.runner.playing);
        if (!locked && this.lockRequested && this.runner?.playing && !this.attempt.stopped) {
            // the browser swallowed Esc to release the pointer: treat it as the pause key
            this.lastPointerLock = performance.now();
            this.togglePausedKey();
        }
    }

    // ---------------------------------------------------------------- input (PlayerInputController + Game._Ready)

    onMouseMove(e) {
        const attempt = this.attempt;
        if (!attempt || !this.runner.playing || attempt.isReplay || attempt.modifiers.some((m) => m.name === 'Autoplay')) return;

        const relative = { x: e.movementX ?? 0, y: e.movementY ?? 0 };

        if (attempt.settings.AbsoluteInput.value) {
            const absolutePosition = { x: e.clientX - window.innerWidth / 2, y: e.clientY - window.innerHeight / 2 };
            this.updateCursor({ x: absolutePosition.x * 0.582, y: absolutePosition.y * 0.582 });
        } else {
            if (document.pointerLockElement !== this.app.backend.canvas) return;
            this.updateCursor(relative);
        }
        attempt.distanceMM += Math.hypot(relative.x, relative.y) / attempt.settings.Sensitivity.value / 57.5;
    }

    onMouseDown(e) {
        if (this.wantsCapture() && this.runner.playing && document.pointerLockElement !== this.app.backend.canvas && e.target === this.capture) {
            this.capturePointer();
        }
    }

    onKeyDown(e) {
        if (e.repeat) return;
        const attempt = this.attempt;
        if (!attempt) return;

        switch (e.code) {
            case 'Space':
                e.preventDefault();
                if (attempt.isReplay) this.togglePause();
                else this.runner.skip();
                break;
            case 'Escape':
                if (performance.now() - this.lastPointerLock < 250) break;
                this.togglePausedKey();
                break;
            case 'Backquote':
                this.restart();
                break;
            case 'F2':
                e.preventDefault();
                if (attempt.isReplay) this.showReplayViewer(attempt);
                break;
            case 'F3':
                e.preventDefault();
                if (attempt.isReplay) this.showOrthogonalCamera(attempt);
                break;
            case 'KeyF': {
                let val;
                if (attempt.settings.FadeOut.value > 0) {
                    this.fadeoutToggleValue = attempt.settings.FadeOut.value;
                    val = 0;
                } else {
                    val = this.fadeoutToggleValue === -1 ? 100 : this.fadeoutToggleValue;
                }
                attempt.settings.FadeOut.value = val;
                break;
            }
            case 'KeyP':
                attempt.settings.Pushback.value = !attempt.settings.Pushback.value;
                break;
        }
    }

    togglePausedKey() {
        const attempt = this.attempt;
        if (this.runner.objectIndicesStart.Note > 0 && attempt.progress < attempt.map.notes[attempt.map.notes.length - 1].millisecond) {
            attempt.qualifies = false;
        }
        if (this.app.settingsManager.shown) {
            this.app.settingsMenu.hideMenu();
        } else {
            this.showMenu(!this.menuShown);
        }
    }

    // ---------------------------------------------------------------- PauseMenu

    showMenu(show = true, instant = false) {
        this.menuShown = show;
        this.runner.playing = !show;

        const attempt = this.attempt;
        const song = this.app.sound.song;
        song.pitchScale = attempt.speed;
        song.streamPaused = !this.runner.playing;

        this.app.menuCursor.updateVisible(show && this.app.settingsManager.settings.UseCursorInMenus.value);

        this.menuTween?.kill();
        if (show) {
            this.menu.classList.remove('hidden');
            this.releasePointer();
        } else {
            this.capturePointer();
        }
        const from = Number(this.menu.style.opacity || 0);
        this.menuTween = tween((a) => (this.menu.style.opacity = a), from, show ? 1 : 0, instant ? 0 : 0.25, {
            trans: Trans.QUAD,
            onDone: () => this.menu.classList.toggle('hidden', !this.menuShown),
        });
    }

    hideMenu(instant = false) {
        this.showMenu(false, instant);
    }

    // ---------------------------------------------------------------- Restart / scores / replays

    async restart() {
        const old = this.attempt;
        if (!old || this.restarting) return;
        this.restarting = true;
        this.runner.fail();
        this.runner.stop(false);

        try {
            const map = await this.app.mapManager.decode(old.map.name);
            const attempt = new Attempt({
                map,
                speed: old.speed,
                startFrom: old.startFrom,
                cameraMode: old.cameraMode,
                mods: old.modifiers,
                players: old.players,
                replays: old.replays,
                settings: this.app.settingsManager.settings,
                skin: this.app.skinManager.skin,
                songLength: old.audio?.duration ?? 0,
            });
            attempt.audio = old.audio;
            GameScene.attempt = attempt;
            if (old.isReplay) for (const r of old.replays) r.frameIndex = 0;
            this.app.sceneManager.reloadCurrentScene();
        } finally {
            this.restarting = false;
        }
    }

    async saveReplay(attempt) {
        if (this.mode !== 'RECORD' || !this.recorder) return;
        const bytes = this.recorder.finish(attempt);
        this.recorder = null;
        await Storage.put('replays', attempt.id, bytes);
        attempt.replayPath = attempt.id;
    }

    async saveScore(attempt, speed) {
        const name = attempt.map.name;
        const existing = await Storage.get('pbs', name);
        const leaderboard = new Leaderboard(name, existing ?? Leaderboard.empty());
        const mods = {};
        for (const mod of attempt.modifiers) mods[mod.name] = true;
        leaderboard.add(
            new Score(attempt.id, 'You', attempt.qualifies, attempt.score, attempt.accuracy, Date.now() / 1000, attempt.progress, attempt.map.length, speed, mods),
        );
        await leaderboard.save();
    }

    // ---------------------------------------------------------------- CursorManager

    updateCursor(inputDelta, cursorIndex = 0) {
        const attempt = this.attempt;
        const settings = this.runnerSettings;

        let sensitivity = settings.Sensitivity.value;
        if (settings.AbsoluteInput.value && !attempt.isReplay) sensitivity = settings.AbsoluteSensitivity.value;
        sensitivity *= settings.FoV.value / 70;

        if (settings.AbsoluteInput.value || attempt.isReplay) {
            // repositionAbsolute
            this.camera.rotation.set(0, 0, 0);
            attempt.rawCursorPosition = { x: 0, y: 0 };
            attempt.cursorPosition = { x: 0, y: 0 };
        }

        attempt.cameraMode.process(attempt, this, this.camera, this.cursors[cursorIndex], inputDelta, sensitivity);
    }

    updateAutoplayCursor(position) {
        if (!v2finite(position)) return;
        const attempt = this.attempt;
        position = v2clamp(position, BOUNDS);

        if (attempt.cameraMode instanceof CameraSpin) {
            const target = { x: position.x, y: position.y, z: 0 };
            const parallax = attempt.settings.CameraParallax.value;
            const origin = { x: attempt.cursorPosition.x * parallax, y: attempt.cursorPosition.y * parallax, z: 3.5 };
            const e = lookingAtEuler({ x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z });
            const pitch = e.x - this.camera.rotation.x;
            const yaw = angleDifference(this.camera.rotation.y, e.y);
            const mouseDelta = { x: -yaw * 120 * Math.PI, y: -pitch * 120 * Math.PI };
            attempt.cameraMode.process(attempt, this, this.camera, this.cursors[0], mouseDelta, 1);
            return;
        }

        attempt.rawCursorPosition = { ...position };
        attempt.cursorPosition = { ...position };

        const parallax = this.runnerSettings.CameraParallax.value;
        this.camera.position.set(position.x * parallax, position.y * parallax, 3.76);
        this.camera.rotation.set(0, 0, 0);
        this.cursors[0].position.set(position.x, position.y, 0);
    }

    showCursor(index = 0, instant = true) {
        const c = this.cursors[index];
        if (!c) return;
        if (instant) {
            c.material.opacity = this.runnerSettings.CursorOpacity.value;
        } else {
            const from = c.material.opacity;
            tween((a) => (c.material.opacity = a), from, 0, 0.5);
        }
    }

    hideCursor(index = 0, instant = true) {
        this.showCursor(index, instant);
    }

    // ---------------------------------------------------------------- ReplayManager (playback)

    showReplayViewer(attempt, show = null) {
        this.viewerVisible = show ?? !this.viewerVisible;
        const visible = this.viewerVisible && attempt.isReplay;
        this.viewer.classList.toggle('hidden', !visible);
        if (attempt.isReplay) document.body.classList.toggle('hide-cursor', !visible);
    }

    showOrthogonalCamera(attempt, show = null) {
        this.canShowOrtho = show ?? !this.canShowOrtho;
        this.orthoVisible = this.canShowOrtho && attempt.isReplay;
        this.orthoPanel.classList.toggle('hidden', !this.orthoVisible);
    }

    togglePause() {
        this.runner.pause();
        this.viewerPause.classList.toggle('paused', !this.runner.playing);
    }

    updateSeekLabel(value) {
        this.viewerTime.textContent = `${formatTime((value * this.replayLength) / 1000)} / ${formatTime(this.replayLength / 1000)}`;
    }

    seek(seekedTime) {
        seekedTime *= this.replayLength;
        const att = this.attempt;
        const runner = this.runner;
        att.hits = 0;
        att.misses = 0;
        att.sum = 0;
        att.accuracy = 100;
        att.score = 0;
        att.combo = 0;
        att.comboMultiplier = 1;
        att.comboMultiplierProgress = 0;
        att.health = 100;
        att.healthStep = 15;
        att.alive = true;
        att.qualifies = true;

        for (let i = 0; i < att.map.notes.length; i++) {
            const note = att.map.notes[i];
            note.hittable = false;
            note.lastResult = 0;
            if (note.millisecond > Math.max(att.progress, seekedTime)) break;
            else if (note.millisecond < seekedTime && note.index >= att.firstNote) {
                if (att.replays[0].notes[i] === -1) note.miss(runner, false);
                else note.hit(runner, false);
            }
        }

        if (att.progress > this.replayLength && seekedTime <= this.replayLength && !runner.playing) this.togglePause();

        runner.seek(seekedTime);
        runner.emit('attemptStatsUpdated', att);

        const frames = att.replays[0].frames;
        for (let i = 0; i < frames.length; i++) {
            if (att.progress < frames[i].progress) {
                att.replays[0].frameIndex = Math.max(0, i - 1);
                break;
            }
        }

        this.updateCursors();
    }

    updateCursors() {
        const attempt = this.attempt;
        for (let i = 0; i < attempt.replays.length; i++) {
            const replay = attempt.replays[i];
            if (replay.frameIndex === replay.frames.length - 1) continue;

            while (replay.frameIndex < replay.frames.length - 1 && attempt.progress >= replay.frames[replay.frameIndex + 1].progress) {
                replay.frameIndex++;
                if (replay.frameIndex === replay.frames.length - 1) this.hideCursor(i, false);
            }

            const next = Math.min(replay.frameIndex + 1, replay.frames.length - 1);
            const current = replay.frames[replay.frameIndex];
            const nextFrame = replay.frames[next];
            const inverse = inverseLerp(current.progress, nextFrame.progress, attempt.progress);

            this.cursorPosition = v2lerp(current, nextFrame, clamp(inverse, 0, 1));
            this.updateCursor(this.cursorPosition, i);
            this.showCursor(i);
        }
    }

    // ---------------------------------------------------------------- frame

    update(delta) {
        const attempt = this.attempt;
        if (!attempt || !this.runner) return;

        this.runner.process();

        // ReplayManager._Process
        if (attempt.isReplay && this.runner.playing) {
            if (!this.seekerHovered) {
                this.viewerSeek.value = attempt.progress / attempt.maxReplayLength;
                this.updateSeekLabel(Number(this.viewerSeek.value));
                if (attempt.progress > this.replayLength && this.runner.playing) this.togglePause();
            }
            this.updateCursors();
        }

        // CursorManager._Process: cursor rotation
        if (this.runner.playing) {
            this.hud.cursor.rotation.z += (this.runnerSettings.CursorRotation.value * Math.PI) / 180 * delta;
        }

        // TrailRenderer._Process
        if (attempt.settings.CursorTrail.value && this.runner.playing) this.updateTrail(delta);
        else if (!attempt.settings.CursorTrail.value && this.hud.trail) this.hud.trail.count = 0;

        // HudManager._Process
        if (this.runner.attempt) this.hud.process(delta, attempt);

        this.space?.process(delta);
    }

    updateTrail(delta) {
        const now = performance.now() * 1000;
        const settings = this.app.settingsManager.settings;
        const attempt = this.attempt;

        const trailDetail = clamp(settings.TrailDetail.value, 0, TRAIL_MAX_DETAIL);
        const rate = (trailDetail / TRAIL_MAX_DETAIL) * TRAIL_SPAWN_RATE;
        if (rate > 0) {
            const interval = 1 / rate;
            this.deltaAccumulator += delta;
            const steps = Math.floor(this.deltaAccumulator / interval);
            if (steps > 0) {
                this.trails.push({ time: now, position: { ...attempt.cursorPosition }, rotation: this.hud.cursor.rotation.z });
                this.deltaAccumulator -= interval * steps;
            }
        }

        const maxLifeTime = settings.TrailTime.value * 1000000;
        this.trails = this.trails.filter((t) => now - t.time < maxLifeTime);
        this.hud.updateTrail(this.trails, attempt.cursorPosition, now, settings.TrailTime.value);
    }

    render(backend) {
        const world = {
            scene: this.scene,
            clearColor: this.space?.clearColor,
            background: this.space?.background ? this.space.background.bind(this.space) : null,
        };
        backend.render(world, this.camera);

        if (this.orthoVisible) {
            const r = backend.renderer;
            const rect = this.orthoPanel.getBoundingClientRect();
            const pr = backend.pixelRatio;
            const x = Math.round(rect.left * pr);
            const y = Math.round((window.innerHeight - rect.bottom) * pr);
            const size = Math.round(rect.width * pr);
            r.setRenderTarget(null);
            r.setScissorTest(true);
            r.setScissor(x, y, size, size);
            r.setViewport(x, y, size, size);
            r.outputColorSpace = THREE.SRGBColorSpace;
            const bg = this.scene.background;
            const spaceVisible = this.space?.root.visible;
            if (this.space) this.space.root.visible = false;
            r.render(this.scene, this.orthoCamera);
            if (this.space) this.space.root.visible = spaceVisible;
            this.scene.background = bg;
            r.outputColorSpace = THREE.LinearSRGBColorSpace;
            r.setScissorTest(false);
            r.setViewport(0, 0, backend.width, backend.height);
        }
    }
}

GameScene.attempt = null;
GameScene.startQueued = false;

export { CURSOR_SIZE };
