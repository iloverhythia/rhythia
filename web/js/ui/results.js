// Port of scripts/scenes/Results.cs, scenes/results.tscn and scripts/ui/results/Graph.cs

import { GameScene } from '../game/game.js';
import { Replay } from '../game/replay.js';
import { Storage } from '../storage.js';
import { lerp, padMagnitude } from '../util.js';
import { button, el } from './common.js';
import { topBar } from './mainMenu.js';

export class ResultsScene {
    constructor(app) {
        this.app = app;
        this.name = 'SceneResults';
        this.element = el('div', 'scene scene-results');
        this.holderPos = { x: 0, y: 0 };
    }

    async load() {
        const app = this.app;
        const attempt = GameScene.attempt;
        this.attempt = attempt;
        const root = this.element;
        root.innerHTML = '';

        app.sound.menuMusic.stop();
        document.body.classList.remove('hide-cursor');
        app.menuCursor.updateVisible(app.settingsManager.settings.UseCursorInMenus.value);

        const coverBg = el('div', 'cover-bg', root);
        const cover = el('div', 'cover', root);
        const holder = el('div', 'holder', root);
        this.holder = holder;

        el('div', 'graph-blur blur-125', holder);
        const label = (cls, text) => {
            const l = el('div', `r-label ${cls}`, holder);
            l.textContent = text;
            return l;
        };
        label('r-title', (attempt.isReplay ? '[REPLAY] ' : '') + attempt.map.prettyTitle);
        label('r-difficulty', attempt.map.difficultyName);
        label('r-mappers', `by ${attempt.map.prettyMappers}`);
        label('r-speed', `${attempt.speed.toFixed(2)}x`);
        const mods = el('div', 'r-mods', holder);
        for (const mod of attempt.modifiers) {
            const img = el('img', '', mods);
            img.src = app.skinManager.modIconUrl(mod.name);
        }
        el('div', 'r-separator', holder);
        label('r-accuracy', `${attempt.accuracy.toFixed(2)}%`);
        label('r-hits', `${padMagnitude(attempt.hits)} / ${padMagnitude(attempt.sum)}`);
        label('r-score', padMagnitude(attempt.score));
        label('r-status', attempt.isReplay ? attempt.replays[0].status : attempt.alive ? (attempt.qualifies ? 'PASSED' : 'DISQUALIFIED') : 'FAILED');

        const graph = el('div', 'graph', holder);
        this.graphCanvas = el('canvas', '', graph);
        el('div', 'offset top', graph, '0ms');
        el('div', 'offset bottom', graph, '55ms');
        el('div', 'dropoff', graph);

        topBar(root, app, { version: false, results: true });

        const footer = el('div', 'footer theme', root);
        el('div', 'blur', footer).style.cssText = 'position:absolute;inset:0';
        button('Back', 'btn flat back', footer, () => this.stop());
        button('Play', 'btn flat play', footer, () => this.replay());
        this.replayBtn = button('Watch Replay', 'btn flat replay', footer, () => this.watchReplay());
        this.replayBtn.classList.add('hidden');

        await attempt.savePromise;
        const replayId = attempt.isReplay ? attempt.replays[0].id : attempt.replayPath;
        if (!attempt.map.ephemeral && replayId && (await Storage.exists('replays', replayId))) {
            this.replayBtn.classList.remove('hidden');
        }

        const url = await app.mapManager.getCoverUrl(attempt.map);
        if (url) {
            coverBg.style.backgroundImage = `url("${url}")`;
            // alpha_gradient shader: triangle alpha across the image, texture alpha replaced
            cover.style.backgroundImage = `url("${url}")`;
            const img = new Image();
            img.onload = () => {
                const ratio = img.naturalWidth / img.naturalHeight;
                const w = Math.min(window.innerWidth, window.innerHeight * ratio);
                const left = (window.innerWidth - w) / 2;
                const mask = `linear-gradient(to right, transparent ${left}px, #000 ${left + w / 2}px, transparent ${left + w}px)`;
                cover.style.webkitMaskImage = mask;
                cover.style.maskImage = mask;
            };
            img.src = url;
        }

        const song = app.sound.song;
        if (attempt.map.audioBuffer != null && song.stream && !song.playing) song.play();
        song.pitchScale = attempt.speed;

        this.drawGraph();
    }

    unload() {}

    drawGraph() {
        const attempt = this.attempt;
        const canvas = this.graphCanvas;
        const W = canvas.clientWidth || 736;
        const H = canvas.clientHeight || 160;
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, W, H);

        const hits = attempt.isReplay ? attempt.replays[0].notes : attempt.hitsInfo;
        const death = attempt.isReplay ? attempt.maxReplayLength : attempt.deathTime;
        const notes = attempt.map.notes;
        const length = attempt.map.length;

        for (let i = attempt.firstNote; i < hits.length; i++) {
            const ms = notes[i].millisecond;
            const p = ms / length;
            if (ms > death && death !== -1) break;
            if (hits[i] < 0) {
                ctx.fillStyle = 'rgba(255,0,0,0.267)';
                ctx.fillRect(Math.floor(W * p), 0, 1, H);
            } else {
                ctx.fillStyle = '#00ff00';
                ctx.fillRect(W * p, (H * hits[i]) / 55, 1, 1);
            }
        }

        if (death >= 0) {
            const x = Math.floor((W * death) / length);
            if (x < W) {
                ctx.fillStyle = '#ffff00';
                ctx.fillRect(x - 1, 0, 3, H);
            }
        }
    }

    async replay() {
        const attempt = this.attempt;
        this.app.sound.song.stop();
        await GameScene.play(this.app, attempt.map, attempt.speed, attempt.startFrom, attempt.cameraMode, attempt.modifiers);
    }

    async watchReplay() {
        const attempt = this.attempt;
        const id = attempt.isReplay ? attempt.replays[0].id : attempt.replayPath;
        const bytes = await Storage.get('replays', id);
        if (!bytes) return;
        const replay = new Replay(id, bytes, (name) => !!this.app.mapManager.getMapByName(name), this.app.notify);
        if (!replay.valid) return;
        this.app.sound.song.stop();
        await GameScene.play(this.app, this.app.mapManager.getMapByName(replay.mapID), replay.speed, replay.startFrom, replay.cameraMode, replay.modifiers, null, [replay]);
    }

    stop() {
        this.app.sceneManager.load('menu');
    }

    onKeyDown(e) {
        if (e.code === 'Escape') this.stop();
        else if (e.code === 'Backquote') this.replay();
    }

    onMouseDown(e) {
        if (e.button === 3) this.stop();
    }

    update(delta) {
        // Results.MousePosition is never assigned in the original, so the holder settles at a fixed offset
        const target = { x: (window.innerWidth / 2) * (8 / window.innerHeight), y: (window.innerHeight / 2) * (8 / window.innerHeight) };
        const k = Math.min(1, delta * 16);
        this.holderPos = { x: lerp(this.holderPos.x, target.x, k), y: lerp(this.holderPos.y, target.y, k) };
        if (this.holder) this.holder.style.transform = `translate(${this.holderPos.x}px, ${this.holderPos.y}px)`;
    }

    render(backend) {
        backend.renderer.setRenderTarget(null);
        backend.renderer.setClearColor(0x0d0d0d, 1);
        backend.renderer.clear();
    }
}
