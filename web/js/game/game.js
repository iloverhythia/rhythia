import * as THREE from 'three';
import { BOUNDS, CURSOR_SIZE } from '../constants.js';
import { Storage } from '../storage.js';
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
    const yaw = Math.atan2(dir.x, -dir.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, dir.y / l)));
    return { x: -pitch, y: yaw, z: 0 };
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

        this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 1000);
        this.camera.rotation.order = 'YXZ';
        this.camera.position.set(0, 0, 3.75);

        this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
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
        const touchControls = el('div', 'touch-controls', root);
        const pauseButton = el('button', 'touch-control touch-pause', touchControls, 'PAUSE');
        pauseButton.addEventListener('click', () => this.togglePausedKey());
        const skipButton = el('button', 'touch-control touch-skip', touchControls, 'SKIP');
        skipButton.addEventListener('click', () => this.runner?.skip());

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

    static start(map, speed, startFrom, cameraMode, mods, players, replays = []) {
        if (GameScene.startQueued) return;
        GameScene.startQueued = true;
        try {
            const parsed = map.parsed ?? map;
            parsed.ephemeral = map.ephemeral ?? false;
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

    // ---------------------------------------------------------------- lifecycle

    async load() {
        const app = this.app;
        const attempt = GameScene.attempt;
        this.attempt = attempt;
        const settings = attempt.settings;

        this.runner = new Runner({
            sound: app.sound,
            stats: app.stats,
            settingsManager: app.settingsManager,
            onStop: (results) => {
                this.releasePointer();
                app.sceneManager.load('results');
            },
        });
        this.runner.tempMode = false;

        await this.hud.loadImages();
        this.runner.hud = this.hud;

        this.noteRenderer?.dispose();
        this.noteRenderer = new NoteRenderer(this, settings, app.skinManager.skin);
        this.renderersGroup.add(this.noteRenderer.group);
        this.runner.renderers = [this.noteRenderer];
        this.runner.cursorManager = this;
        this.runner.replayManager = this;
        this.runner.attempt = attempt;

        // space
        this.space = app.sceneManager.space;
        if (this.space) {
            this.scene.add(this.space.root);
            this.space.updateState(true);
            this.space.setMap?.(attempt.map);
            this.unsubHit = this.space.on('hit', (hit) => {
                this.runner.hit(hit);
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
        this.camera.aspect = innerWidth / innerHeight;
        this.camera.updateProjectionMatrix();

        this.cursorPosition = { x: 0, y: 0 };
        this.recorder = null;

        this.menuShown = false;
        this.menu.classList.add('hidden');
        this.menu.style.opacity = 0;

        if (attempt.isReplay) this.mode = 'PLAYBACK';
        else if (attempt.replays?.length) {
            this.mode = 'RECORD';
            this.recorder = new ReplayRecorder();
        } else this.mode = 'NONE';

        this.trails = [];
        this.deltaAccumulator = 0;

        this.runner.play();

        this.cursors = [this.hud.cursor];
        if (attempt.isReplay) {
            for (let i = 1; i < attempt.replays.length; i++) {
                const c = this.hud.cursor.clone();
                c.position.copy(this.hud.cursor.position);
                this.hud.add(c);
                this.cursors.push(c);
            }
        }

        this.replayLength = attempt.audio?.duration ?? 0;
        this.updateSeekLabel(0);

        GameScene.startQueued = false;

        if (!attempt.isReplay) {
            app.stats.Attempts++;
            const cached = app.mapManager.maps.find((m) => m.name === attempt.map.name);
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
        this.capture.classList.add('hidden');
    }


    // ---------------------------------------------------------------- pointer handling

    wantsCapture() {
        const a = this.attempt;
        if (matchMedia('(pointer: coarse)').matches) return false;
        return a && !a.isReplay && !a.settings.AbsoluteInput.value && !this.menuShown && this.runner?.playing !== undefined;
    }

    capturePointer() {
        const a = this.attempt;
        const canvas = this.app.backend.canvas;
        if (!a || a.isReplay) {
            document.body.classList.toggle('hide-cursor', a?.isReplay && !this.viewerVisible);
            return;
        }
        if (matchMedia('(pointer: coarse)').matches) {
            document.body.classList.add('hide-cursor');
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
                e.preventDefault();
                this.togglePausedKey();
                break;
            case 'Backquote':
                this.restart();
                break;
            case 'F2':
                e.preventDefault();
                this.showReplayViewer(attempt, !this.viewerVisible);
                break;
            case 'F3':
                e.preventDefault();
                this.showOrthogonalCamera();
                break;
            case 'KeyF': {
                let val;
                if (attempt.settings.FadeOut.value > 0) {
                    val = 0;
                } else {
                    val = 1;
                }
                attempt.settings.FadeOut.value = val;
                break;
            }
            case 'KeyP':
                this.togglePause();
                break;
        }
    }

    togglePausedKey() {
        const attempt = this.attempt;
        if (!attempt) return;
        if (!this.menuShown) {
            attempt.qualifies = false;
        }
        if (this.app.settingsManager.shown) {
            this.app.settingsMenu.hideMenu();
        } else {
            this.showMenu(!this.menuShown);
        }
    }

    showMenu(show = true, instant = false) {
        this.menuShown = show;
        this.runner.playing = !show;
        const attempt = this.attempt;
        const song = this.app.sound.song;
        song.pitchScale = attempt.speed;
        song.streamPaused = !this.runner.playing;

        this.menuTween?.kill();
        if (show) {
            this.menu.classList.remove('hidden');
            this.releasePointer();
        } else {
            this.capturePointer();
        }
        gsap.to(this.menu, {
            opacity: show ? 1 : 0,
            duration: instant ? 0 : 0.2,
            onComplete: () => {
                if (!show) this.menu.classList.add('hidden');
            },
            trans: Trans.QUAD,
        });
    }

    hideMenu(instant = false) {
        this.showMenu(false, instant);
    }


    async restart() {
        const old = this.attempt;
        if (!old || this.restarting) return;
        this.restarting = true;
        this.runner.fail();
        this.runner.stop(false);

        try {
            const map = old.map;
            const attempt = new Attempt({
                map,
                speed: old.speed,
                startFrom: old.startFrom,
                cameraMode: old.cameraMode,
                mods: old.modifiers,
                players: old.players,
                replays: old.replays,
                settings: old.settings,
                skin: this.app.skinManager.skin,
                songLength: old.audio?.duration ?? 0,
            });
            attempt.audio = old.audio;
            GameScene.attempt = attempt;
            this.app.sceneManager.reloadCurrentScene();
        } finally {
            this.restarting = false;
        }
    }

    async saveReplay(attempt) {
        const bytes = this.recorder.finish(attempt);
        this.recorder = null;
        await Storage.put('replays', attempt.replayPath, bytes);
        attempt.replayPath = attempt.id;
    }

    async saveScore(attempt, speed) {
        const name = attempt.map.name;
        const mods = {};
        for (const m of attempt.modifiers) if (m.name) mods[m.name] = true;
        await leaderboard.add(
            name,
            attempt.score,
            attempt.accuracy,
            speed,
            mods,
        );
        await leaderboard.save();
    }


    updateCursor(inputDelta, cursorIndex = 0) {
        const attempt = this.attempt;
        const settings = this.runnerSettings;

        let sensitivity = settings.Sensitivity.value;
        sensitivity *= settings.FoV.value / 70;
        if (attempt.settings.AbsoluteInput.value && !attempt.isReplay) sensitivity = attempt.settings.AbsoluteSensitivity.value;

        if (attempt.settings.AbsoluteInput.value || attempt.isReplay) {
            const scale = 2 / CURSOR_SIZE;
            attempt.rawCursorPosition = { x: inputDelta.x * scale, y: inputDelta.y * scale };
        } else {
            const scale = sensitivity / 100;
            attempt.rawCursorPosition.x += inputDelta.x * scale;
            attempt.rawCursorPosition.y += inputDelta.y * scale;
        }

        attempt.cursorPosition = v2clamp({ ...attempt.rawCursorPosition }, BOUNDS);
        const c = this.cursors[cursorIndex];
        if (c) {
            c.position.set(attempt.cursorPosition.x, attempt.cursorPosition.y, 0);
            c.visible = true;
        }
    }

    updateAutoplayCursor(position) {
        if (!v2finite(position)) return;
        const attempt = this.attempt;
        position = v2clamp(position, BOUNDS);
        if (attempt.cameraMode instanceof CameraSpin) {
            const e = lookingAtEuler({ x: position.x, y: position.y, z: 1 });
            const pitch = e.x - this.camera.rotation.x;
            const yaw = e.y - this.camera.rotation.y;
            this.camera.rotation.x += pitch;
            this.camera.rotation.y += yaw;
        }
        attempt.rawCursorPosition = { ...position };
        attempt.cursorPosition = { ...position };
        this.hud.cursor.position.set(position.x, position.y, 0);
        this.camera.rotation.set(0, 0, 0);
    }

    showCursor(index = 0, instant = true) {
        const c = this.cursors[index];
        if (!c) return;
        if (instant) {
            c.material.opacity = 1;
        } else {
            const from = c.material.opacity;
            gsap.to(c.material, { opacity: 1, duration: 0.2, from });
        }
    }

    hideCursor(index = 0, instant = true) {
        this.showCursor(index, instant);
    }


    showReplayViewer(attempt, show = null) {
        this.viewerVisible = show ?? !this.viewerVisible;
        this.viewer.classList.toggle('hidden', !this.viewerVisible);
        this.canShowOrtho = false;
        this.showOrthogonalCamera(attempt, this.viewerVisible);
        this.updateSeekLabel(this.viewerSeek.value);
    }

    showOrthogonalCamera(attempt, show = null) {
        this.canShowOrtho = show ?? !this.canShowOrtho;
        this.orthoPanel.classList.toggle('hidden', !this.canShowOrtho);
    }

    togglePause() {
        this.runner.pause();
        this.viewerPause.classList.toggle('paused', this.runner.playing);
    }

    updateSeekLabel(value) {
        const sec = Number(value) * this.replayLength;
        const fmt = (n) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
        this.viewerTime.textContent = `${fmt(sec)} / ${fmt(this.replayLength)}`;
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
            if (note.time < seekedTime) {
                if (note.hitResult) note.hitResult = null;
                else note.hit(runner, false);
            }
        }

        runner.seek(seekedTime);
        runner.emit('attemptStatsUpdated', att);

        const frames = att.replays[0].frames;
        for (let i = 0; i < frames.length; i++) {
            if (att.progress < frames[i].progress) {
                att.replays[0].frameIndex = i;
                break;
            }
        }

        this.updateCursors();
    }

    updateCursors() {
        const attempt = this.attempt;
        for (let i = 0; i < attempt.replays.length; i++) {
            const replay = attempt.replays[i];
            const frame = replay.frames[replay.frameIndex];
            while (replay.frameIndex + 1 < replay.frames.length && replay.frames[replay.frameIndex + 1].progress <= attempt.progress) {
                replay.frameIndex++;
            }
            const next = replay.frames[replay.frameIndex];
            if (next) this.updateCursor(next.position, i);
        }
        for (let i = 0; i < this.cursors.length; i++) this.showCursor(i);
    }


    update(delta) {
        const attempt = this.attempt;
        if (!attempt || !this.runner) return;
        this.runner.process();

        // ReplayManager._Process
        if (attempt.isReplay && this.runner.playing) {
            if (!this.seekerHovered) {
                const progress = attempt.progress;
                this.viewerSeek.value = progress;
                this.updateSeekLabel(progress);
            }
            this.updateCursors();
        }

        // CursorManager._Process: cursor rotation
        if (this.runner.playing) {
            const spin = this.app.settingsManager.settings.CursorRotation.value;
            this.camera.rotation.z += spin * delta;
        }

        // TrailRenderer._Process
        this.updateTrail(delta);

        // HudManager._Process
        this.hud?.update(delta);

        this.space?.process(delta);
    }

    updateTrail(delta) {
        const now = performance.now() * 1000;
        const rate = this.app.settingsManager.settings.CursorTrail.value;
        const attempt = this.attempt;
        if (rate > 0) {
            const interval = 1 / rate;
            this.deltaAccumulator += delta;
            const steps = Math.floor(this.deltaAccumulator / interval);
            if (steps > 0) {
                this.deltaAccumulator -= steps * interval;
                for (let i = 0; i < steps; i++) this.spawnTrail(now);
            }
        }
        this.trails = this.trails.filter((t) => {
            t.age += delta;
            t.material.opacity = Math.max(0, 1 - t.age / this.app.settingsManager.settings.TrailTime.value);
            return t.age < this.app.settingsManager.settings.TrailTime.value;
        });
    }

    render(backend) {
        const world = {
            scene: this.scene,
            clearColor: this.space?.clearColor,
        };
        backend.render(world, this.camera);

        if (this.orthoVisible) {
            const r = backend.renderer;
            const rect = this.orthoPanel.getBoundingClientRect();
            const pr = backend.pixelRatio;
            const x = Math.round(rect.left * pr);
            const y = Math.round((innerHeight - rect.bottom) * pr);
            const size = Math.round(rect.width * pr);
            r.setRenderTarget(null);
            r.setScissorTest(true);
            r.setScissor(x, y, size, size);
            r.setViewport(x, y, size, size);
            r.outputColorSpace = THREE.SRGBColorSpace;
            const bg = this.scene.background;
            this.scene.background = null;
            r.render(this.scene, this.orthoCamera);
            this.scene.background = bg;
            r.setScissorTest(false);
        }
    }
}

GameScene.attempt = null;
GameScene.startQueued = false;

export { CURSOR_SIZE };
