// Port of scripts/scenes/Game.cs, scripts/PlayerInputController.cs, scripts/game/managers/CursorManager.cs, scripts/game/renderers/TrailRenderer.cs, scripts/game/ui/PauseMenu.cs and the playback half of ReplayManager.cs

import * as THREE from 'three';
import { BOUNDS, CURSOR_SIZE } from '../constants.js';
import { Leaderboard, Score } from '../map/leaderboard.js';
import { Storage } from '../storage.js';
import { Trans, angleDifference, clamp, formatTime, inverseLerp, tween, v2clamp, v2finite, v2lerp } from '../util.js';
import { Attempt } from './attempt.js';
import { CameraSpin, basisZ } from './camera.js';
import { Hud } from './hud.js';
import { NoteRenderer } from './noteRenderer.js';
import { Replay } from './replay.js';
import { ResultsScene } from '../ui/results.js';
import { el } from '../ui/common.js';

// Godot Basis.LookingAt(dir, up).GetEuler() (YXZ)
function lookingAtEuler(dir) {
    const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const d = { x: dir.x / l, y: dir.y / l, z: dir.z / l };
    return { x: Math.asin(clamp(d.y, -1, 1)), y: Math.atan2(-d.x, -d.z), z: 0 };
}

export class GameScene {
    static startQueued = false;
    static attempt = null;

    constructor(app) {
        this.app = app;
        this.element = el('div', 'scene game-scene');
        this.element.style.display = 'none';
        this.renderersGroup = new THREE.Group();
        this.gameGroup = new THREE.Group();
        this.gameGroup.add(this.renderersGroup);
        this.camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 4000);
        this.camera.rotation.order = 'YXZ';
        this.camera.position.set(0, 0, 3.75);
        this.orthoCamera = new THREE.OrthographicCamera(-2.25, 2.25, 2.25, -2.25, 0.05, 139);
        this.orthoCamera.position.set(0, 0, 0.60892284);
        this.attempt = null;
        this.runner = null;
        this.capture = null;
        this.menuShown = false;
        this.viewerVisible = false;
        this.lockRequested = false;
        this.lastPointerLock = 0;
        this.space = null;
        this.hud = null;
        this.noteRenderer = null;
        this.seekerHovered = false;
    }

    buildDom() {
        const root = this.element;
        this.capture = el('div', 'capture-hint hidden', root, 'Click to capture the cursor');
        this.viewer = el('div', 'replay-viewer', root);
    }

    static async play(app, map, speed, startFrom, cameraMode, mods, players = null, replays = null) {
        if (GameScene.startQueued) return;
        GameScene.startQueued = true;
        try {
            const parsed = await app.mapManager.decode(map);
            parsed.ephemeral = map.ephemeral ?? false;
            const audio = parsed.audioBuffer ? await app.decodeMapAudio(parsed) : null;
            const attempt = new Attempt({ map: parsed, speed, startFrom, cameraMode, mods, players, replays, audio });
            GameScene.attempt = attempt;
            await app.sceneManager.change('game');
        } finally {
            GameScene.startQueued = false;
        }
    }

    async show() {
        this.element.style.display = '';
        this.buildDom();
        const attempt = GameScene.attempt;
        this.attempt = attempt;
        this.runner = attempt?.runner;
        this.hud = new Hud(this.app, this);
        this.noteRenderer = new NoteRenderer(this.app, this);
        this.capturePointer();
    }

    hide() {
        this.element.style.display = 'none';
    }

    dispose() {
        this.hud?.clear();
        this.noteRenderer?.dispose();
        this.noteRenderer = null;
        if (this.space) this.scene.remove(this.space.root);
        this.capture.classList.add('hidden');
    }

    // ---------------------------------------------------------------- pointer handling

    wantsCapture() {
        if (matchMedia('(pointer: coarse)').matches) return false;
        const a = this.attempt;
        return a && !a.isReplay && !a.settings.AbsoluteInput.value && !this.menuShown && this.runner?.playing !== undefined;
    }

    capturePointer() {
        if (matchMedia('(pointer: coarse)').matches) {
            document.body.classList.add('hide-cursor');
            return;
        }
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
                p.catch(() => {});
            }
        } catch {}
    }

    updateCaptureHint() {
        const locked = document.pointerLockElement === this.app.backend.canvas;
        this.capture.classList.toggle('hidden', locked || !this.wantsCapture() || !this.runner.playing);
    }

    onPointerLockChange() {
        const locked = document.pointerLockElement === this.app.backend.canvas;
        if (locked) {
            this.lockRequested = false;
            document.body.classList.add('hide-cursor');
        } else {
            document.body.classList.remove('hide-cursor');
            if (this.lockRequested) {
                this.lockRequested = false;
                return;
            }
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
            default:
                break;
        }
    }

    togglePausedKey() {
        if (this.runner?.playing) this.runner.pause();
        else this.runner?.resume();
    }
}
