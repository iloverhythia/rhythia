// Port of scripts/ui/menu/play/MapInfo.cs, MapInfoContainer.cs, Modifiers.cs, CameraModes.cs, SpeedPresetButton.cs,
// ScorePanel.cs and scripts/ui/FlatPreview.cs

import { DIFFICULTY_COLORS } from '../constants.js';
import { CameraLock, CameraSpin } from '../game/camera.js';
import { MODIFIER_NAMES, createModifier } from '../game/modifiers.js';
import { Leaderboard } from '../map/leaderboard.js';
import { exportEncode } from '../map/parser.js';
import { Storage } from '../storage.js';
import { Ease, Emitter, Trans, binarySearch, clamp, downloadBytes, escapeHtml, formatTime, formatUnixTimePretty, lerp, padMagnitude, tween } from '../util.js';
import { button, el, linkPopup } from './common.js';
import { outlineBackground } from './mapList.js';

const MOD_COLORS = { NoFail: '#20e12c', Autoplay: '#ffd166', Ghost: '#ffffff', Strobe: '#ffe854', Chaos: '#ff6198', Vortex: '#9661ff', Earthquake: '#ff4400', HFlip: '#ffffff', VFlip: '#ffffff' };
const PRESETS = [
    [80, 'speedPresetMinusMinusButtonImage'],
    [90, 'speedPresetMinusButtonImage'],
    [100, 'speedPresetMiddleButtonImage'],
    [110, 'speedPresetPlusButtonImage'],
    [120, 'speedPresetPlusPlusButtonImage'],
];

const diffHex = (d) => DIFFICULTY_COLORS[d]?.slice(0, 7) ?? '#ffffff';

function tintedImage(target, url, color, multiply = false) {
    const s = target.style;
    if (multiply) {
        s.backgroundImage = `url("${url}")`;
        s.backgroundSize = '100% 100%';
        s.backgroundColor = color;
        s.backgroundBlendMode = 'multiply';
    } else {
        s.background = color;
    }
    s.webkitMask = `url("${url}") center / 100% 100% no-repeat`;
    s.mask = s.webkitMask;
}

function setSliderFill(slider) {
    const min = Number(slider.min);
    const max = Number(slider.max);
    slider.style.setProperty('--fillk', clamp((Number(slider.value) - min) / (max - min), 0, 1));
}

function ticks(count) {
    // centred tick dots like Godot's HSlider tick_count
    const layers = [];
    for (let i = 0; i < count; i++) {
        const x = `calc(5px + (100% - 10px) * ${i / (count - 1)} - 2px)`;
        layers.push(`radial-gradient(circle 2px, rgba(255,255,255,0.125) 99%, transparent 100%) ${x} 50% / 4px 4px no-repeat`);
    }
    return layers.join(', ');
}

// FlatPreview.cs — a 3x3 grid that flashes as the preview song passes notes
class FlatPreview {
    constructor(parent, app) {
        this.app = app;
        this.root = el('div', 'grid3', parent);
        this.cells = [];
        for (let i = 0; i < 9; i++) this.cells.push({ el: el('div', 'cell', this.root), a: 0 });
        this.notes = [];
        this.times = [];
        this.index = 0;
        this.lastTime = 0;
    }

    setNotes(notes) {
        this.notes = notes;
        this.times = notes.map((n) => n.millisecond);
        this.index = 0;
        this.lastTime = 0;
    }

    seek(ms) {
        this.index = binarySearch(this.times, ms) + 1;
        this.lastTime = ms;
    }

    update(delta, songMs, active) {
        const size = Math.max(0, Math.min(this.root.parentElement.clientWidth, this.root.parentElement.clientHeight));
        this.root.style.width = `${size}px`;
        this.root.style.height = `${size}px`;
        if (active) {
            if (songMs < this.lastTime - 50) this.seek(songMs);
            while (this.index < this.notes.length && this.notes[this.index].millisecond <= songMs) {
                const n = this.notes[this.index];
                const col = clamp(Math.floor(n.x + 1.5), 0, 2);
                const row = clamp(Math.floor(-n.y + 1.5), 0, 2);
                this.cells[row * 3 + col].a = 0.2;
                this.index++;
            }
            this.lastTime = songMs;
        }
        for (const c of this.cells) {
            c.a = lerp(c.a, 0, Math.min(1, 6 * delta));
            c.el.style.background = `rgba(255,255,255,${c.a})`;
        }
    }
}

class MapInfoContainer {
    constructor(info, map) {
        this.info = info;
        this.app = info.app;
        this.map = map;
        this.root = el('div', 'mic');
        this.build();
    }

    skin(key) {
        return this.app.skinManager.url(key);
    }

    outlined(parent) {
        const o = el('div', 'outline', parent);
        this.outlines.push(o);
        return o;
    }

    build() {
        const map = this.map;
        const app = this.app;
        const lobby = app.lobby;
        this.outlines = [];

        // ---- Info
        const info = el('div', 'block info', this.root);
        this.infoBlock = info;
        el('div', 'block-bg', info);
        const infoScroll = el('div', 'scroll-area scroll', info);
        const hbox = el('div', 'hbox', infoScroll);
        const coverFrame = el('div', 'cover-frame', hbox);
        tintedImage(el('div', 'frame', coverFrame), this.skin('mapInfoCoverBackgroundImage'), diffHex(map.difficulty), true);
        const cover = el('div', 'cover', coverFrame);
        app.mapManager.getCoverUrl(map).then((url) => {
            if (url) cover.style.backgroundImage = `url("${url}")`;
        });
        if (map.artistLink) {
            const link = el('button', 'artist-link', coverFrame);
            link.textContent = `Available on ${map.artistPlatform}`;
            link.addEventListener('click', () => linkPopup(map.artistLink).show());
        }
        const sub = el('div', 'subholder', hbox);
        el(
            'div',
            'main',
            sub,
            `${escapeHtml(map.prettyTitle)}<br><span class="diff"><span style="color:${diffHex(map.difficulty)}">${escapeHtml(map.difficultyName)}</span> <span class="by">by ${escapeHtml(map.prettyMappers)}</span></span>`,
        );
        el('div', 'extra', sub, `<span>${formatTime(map.length / 1000)}</span><span>${map.noteCount ?? 0} notes</span><span class="name">${escapeHtml(map.name)}</span>`);
        const buttons = el('div', 'buttons', sub);
        const exportBtn = button('', 'btn', buttons, () => this.export(), this.skin('exportButtonImage'));
        exportBtn.title = 'Exports map into a .phxm file to share easily';
        this.favoriteBtn = button('', 'btn', buttons, () => this.toggleFavorite(), this.skin(map.favorite ? 'unfavoriteButtonImage' : 'favoriteButtonImage'));
        this.favoriteBtn.title = map.favorite ? 'Unfavorite' : 'Favorite';
        const deleteBtn = button('', 'btn', buttons, () => app.mapManager.delete(map), this.skin('deleteButtonImage'));
        deleteBtn.title = 'Delete';
        this.outlined(info);

        // ---- Actions
        const actions = el('div', 'block actions', this.root);
        this.actionsBlock = actions;
        el('div', 'block-bg', actions);
        const actionsScroll = el('div', 'scroll-area scroll', actions);
        const holder = el('div', 'aholder', actionsScroll);
        const vsep = (left, top, bottom) => {
            const s = el('div', 'vsep', holder);
            s.style.left = left;
            s.style.top = top;
            s.style.bottom = bottom;
        };
        vsep('50%', '16px', 'calc(50% + 16px)');
        vsep('75%', '16px', 'calc(50% + 16px)');
        vsep('50%', 'calc(50% + 16px)', '16px');
        el('div', 'hsep', holder);

        const quad = (label, l, t, r, b, tooltip = '') => {
            const q = el('div', 'quad', holder);
            q.style.left = l;
            q.style.top = t;
            q.style.right = r;
            q.style.bottom = b;
            if (tooltip) q.title = tooltip;
            el('div', 'qlabel', q, label);
            return q;
        };

        // Modifiers
        const mods = quad('Modifiers', '16px', '16px', 'calc(50% + 8px)', 'calc(50% + 8px)');
        const modRow = el('div', 'modifiers-row hscroll', mods);
        const modInner = el('div', 'inner', modRow);
        this.modButtons = {};
        for (const name of MODIFIER_NAMES) {
            const b = button('', 'btn mod-button', modInner, () => {
                const active = lobby.modifiers.some((m) => m.name === name);
                lobby.setModifier(createModifier(name), !active);
            });
            // icon multiplied by icon_normal_color (#FFFFFFA4) or the modifier colour when pressed
            const icon = el('span', 'mod-icon', b);
            const url = app.skinManager.modIconUrl(name);
            icon.style.backgroundImage = `url("${url}")`;
            icon.style.webkitMask = `url("${url}") center / contain no-repeat`;
            icon.style.mask = icon.style.webkitMask;
            b.title = name;
            this.modButtons[name] = b;
        }

        // Camera mode
        const modes = quad('Camera Mode', 'calc(50% + 8px)', '16px', 'calc(25% + 8px)', 'calc(50% + 8px)', 'Favorite');
        const modeBox = el('div', 'modes', modes);
        this.modeButtons = {
            Lock: button('Lock', 'btn', modeBox, () => lobby.setCameraMode(new CameraLock())),
            Spin: button('Spin', 'btn', modeBox, () => lobby.setCameraMode(new CameraSpin())),
        };

        // Preview
        const preview = quad('Preview', 'calc(75% + 8px)', '16px', '16px', 'calc(50% + 8px)');
        const previewBox = el('div', 'preview', preview);
        this.flatPreview = new FlatPreview(previewBox, app);
        app.mapManager.getNotes(map).then((notes) => this.flatPreview.setNotes(notes));

        // Speed
        const speed = quad('Speed', '16px', 'calc(50% + 8px)', 'calc(50% + 8px)', '16px');
        const presets = el('div', 'presets hscroll', speed);
        this.presetButtons = PRESETS.map(([value, key]) => {
            const b = button('', 'btn', presets, () => lobby.setSpeed(value / 100), this.skin(key));
            b.title = String(value);
            b.value = value;
            return b;
        });
        this.speedSlider = el('input', 'slider', speed);
        Object.assign(this.speedSlider, { type: 'range', min: 50, max: 150, step: 5 });
        this.speedSlider.style.setProperty('--ticks', ticks(11));
        this.speedEdit = el('input', 'line-edit value', speed);
        this.speedSlider.addEventListener('input', () => {
            this.speedEdit.value = this.speedSlider.value;
            this.applySpeed();
        });
        this.speedEdit.addEventListener('change', () => this.applySpeed());
        this.speedEdit.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') this.speedEdit.blur();
        });

        // Play
        const play = quad('Play', 'calc(50% + 8px)', 'calc(50% + 8px)', '16px', '16px');
        this.startBtn = el('button', 'btn start', play);
        this.startLabel = el('span', '', this.startBtn, 'START');
        const playIcon = el('img', '', this.startBtn);
        playIcon.src = this.skin('playButtonImage');
        this.startBtn.addEventListener('click', () => this.info.emit('play'));
        this.startSlider = el('input', 'slider', play);
        Object.assign(this.startSlider, { type: 'range', min: 0, max: 1, step: 'any' });
        this.startSlider.style.setProperty('--ticks', ticks(11));
        this.startEdit = el('input', 'line-edit value', play);
        this.startEdit.placeholder = '0:00';
        this.startSlider.addEventListener('input', () => {
            this.startEdit.value = (Math.round(Number(this.startSlider.value) * map.length) / 1000).toFixed(2);
            this.applyStartFrom(false);
            setSliderFill(this.startSlider);
        });
        this.startSlider.addEventListener('change', () => this.applyStartFrom(true));
        this.startEdit.addEventListener('change', () => this.applyStartFrom(true));
        this.startEdit.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') this.startEdit.blur();
        });
        this.outlined(actions);

        // ---- Dim + leaderboard
        this.dim = el('div', 'dim', this.root);
        this.leaderboardHide = el('button', 'leaderboard-hide hidden', this.root);
        this.leaderboardHide.addEventListener('mousedown', () => this.toggleLeaderboard(false));
        this.leaderboard = el('div', 'leaderboard hidden', this.root);
        el('div', 'block-bg', this.leaderboard);
        this.lbScroll = el('div', 'lb-scroll scroll', this.leaderboard);
        this.lbList = el('div', '', this.lbScroll);
        this.expand = el('button', 'expand', this.leaderboard);
        el('div', 'hover-panel', this.expand, 'EXPAND');
        this.expand.addEventListener('click', () => this.toggleLeaderboard(true));
        this.outlined(this.leaderboard);
        this.lbScroll.addEventListener(
            'wheel',
            (e) => {
                e.stopPropagation();
            },
            { passive: true },
        );

        // sync with lobby
        const unsubs = [
            lobby.on('modifiersChanged', () => this.syncMods()),
            lobby.on('cameraModeChanged', () => this.syncMode()),
            lobby.on('speedChanged', () => this.syncSpeed()),
            lobby.on('startFromChanged', () => this.syncStartFrom()),
        ];
        this.unsubs = unsubs;
        this.syncMods();
        this.syncMode();
        this.syncSpeed();
        this.syncStartFrom();
        this.loadLeaderboard();
    }

    // ---------------------------------------------------------------- lobby sync

    syncMods() {
        const active = new Set(this.app.lobby.modifiers.map((m) => m.name));
        for (const [name, b] of Object.entries(this.modButtons)) {
            const on = active.has(name);
            b.classList.toggle('pressed', on);
            b.querySelector('.mod-icon').style.backgroundColor = on ? MOD_COLORS[name] : '#ffffff';
        }
    }

    syncMode() {
        const name = this.app.lobby.cameraMode.name;
        for (const [n, b] of Object.entries(this.modeButtons)) b.classList.toggle('pressed', n === name);
    }

    syncSpeed() {
        const speed = this.app.lobby.speed;
        let v = speed * 100;
        const rounded = Math.round(v * 10) / 10;
        if (Math.abs(v - rounded) < 1e-6) v = rounded;
        this.speedSlider.value = v;
        setSliderFill(this.speedSlider);
        this.speedEdit.value = String(v);
        for (const b of this.presetButtons) b.classList.toggle('pressed', b.value / 100 === speed);
    }

    applySpeed() {
        let v = parseFloat(this.speedEdit.value);
        if (Number.isNaN(v)) v = 100;
        const speed = clamp(v, 25, 1000) / 100;
        this.app.lobby.setSpeed(speed);
    }

    syncStartFrom() {
        const ms = this.app.lobby.startFrom;
        const len = this.map.length || 1;
        this.startSlider.value = ms / len;
        setSliderFill(this.startSlider);
        this.startEdit.value = formatTime(ms / 1000);
        this.startLabel.textContent = ms > 0 ? `START (${formatTime(ms / 1000)})` : 'START';
    }

    applyStartFrom(seek) {
        const input = this.startEdit.value === '' ? this.startEdit.placeholder : this.startEdit.value;
        const parts = input.split(':').reverse();
        const lenMs = this.map.length;
        let seconds = 0;
        if (parts.length > 1 && !Number.isNaN(parseFloat(parts[1]))) seconds += 60 * parseFloat(parts[1]);
        let first = parseFloat(parts[0]);
        if (!Number.isNaN(first)) {
            if (first < 1) first *= Math.floor(lenMs / 1000);
            seconds += first;
        }
        const ms = clamp(seconds * 1000, 0, lenMs);
        this.app.lobby.setStartFrom(ms);

        const sound = this.app.sound;
        if (sound.map?.name !== this.map.name) sound.startMapSelectionPlayback(this.map);
        if (seek && sound.song.playing) {
            this.flatPreview.seek(ms);
            sound.song.seek(ms / 1000);
        }
    }

    // ---------------------------------------------------------------- actions

    async export() {
        const app = this.app;
        app.notify(`Exporting to ${this.map.name}.phxm`, 1);
        const decoded = await app.mapManager.decode(this.map);
        const bytes = await exportEncode(decoded);
        downloadBytes(bytes, `${this.map.name}.phxm`);
        app.notify('Done! Opening export...', 0);
    }

    toggleFavorite() {
        const map = this.map;
        map.favorite = !map.favorite;
        this.favoriteBtn.querySelector('img').src = this.skin(map.favorite ? 'unfavoriteButtonImage' : 'favoriteButtonImage');
        this.favoriteBtn.title = map.favorite ? 'Unfavorite' : 'Favorite';
        this.app.mapManager.orderAndSetMaps();
        this.app.mapManager.update(map);
    }

    async loadLeaderboard() {
        const lb = await Leaderboard.load(this.map.name);
        if (!lb || !lb.valid || lb.scoreCount < 1) return;
        this.scores = lb.scores;
        this.leaderboard.classList.remove('hidden');
        const now = Date.now() / 1000;
        for (let i = 0; i < lb.scores.length; i++) {
            const s = lb.scores[i];
            const p = el('div', 'score-panel', this.lbList);
            p.style.background = `rgba(255,255,255,${((i % 2) * 8) / 255})`;
            el('div', 'player', p).textContent = s.player;
            const score = el('div', `score${s.qualifies ? '' : ' unqualified'}`, p);
            score.textContent = s.qualifies ? padMagnitude(s.value) : `${formatTime(s.progress / 1000)} / ${formatTime(s.mapLength / 1000)}`;
            el('div', 'accuracy', p).textContent = `${s.accuracy.toFixed(2)}%`;
            el('div', 'speed', p).textContent = `${s.speed.toFixed(2)}x`;
            const mods = el('div', 'mods', p);
            for (const [name, on] of Object.entries(s.modifiers)) {
                if (!on) continue;
                const img = el('img', '', mods);
                img.src = this.app.skinManager.modIconUrl(name) ?? '';
            }
            el('div', 'time', p).textContent = formatUnixTimePretty(now, s.time);
            const view = el('button', 'view hidden', p);
            const hover = el('div', 'hover-panel', view, 'VIEW');
            Storage.exists('replays', s.attemptID).then((ok) => {
                if (!ok) hover.textContent = 'REPLAY NOT FOUND';
            });
            view.addEventListener('click', () => {
                this.toggleLeaderboard(false);
                this.app.playReplayById(s.attemptID);
            });
        }
    }

    toggleLeaderboard(show) {
        if (!this.scores) return;
        this.leaderboardShown = show;
        this.expand.classList.toggle('hidden', show);
        this.leaderboardHide.classList.toggle('hidden', !show);
        this.leaderboard.classList.toggle('expanded', show);
        for (const v of this.lbList.querySelectorAll('.view')) v.classList.toggle('hidden', !show);
        this.lbTweens?.forEach((t) => t.kill());
        const fromH = this.leaderboard.offsetHeight;
        const toH = show ? 100 * Math.min(4, this.scores.length) : 100;
        const fromDim = this.dimAlpha ?? 0;
        this.lbTweens = [
            tween((h) => (this.leaderboard.style.height = `${h}px`), fromH, toH, 0.25, { trans: Trans.QUART, ease: Ease.OUT }),
            tween(
                (a) => {
                    this.dimAlpha = a;
                    this.dim.style.background = `rgba(0,0,0,${a})`;
                },
                fromDim,
                show ? 0.5 : 0,
                0.25,
                { trans: Trans.QUART, ease: Ease.OUT },
            ),
        ];
        if (!show) {
            const from = this.lbScroll.scrollTop;
            this.lbTweens.push(tween((s) => (this.lbScroll.scrollTop = s), from, 0, 0.15));
        }
    }

    // ---------------------------------------------------------------- transitions

    setup() {
        // slide in: container from x -64 and staggered sub panels
        this.slide = [
            tween((x) => (this.infoBlock.style.transform = `translateX(${x}px)`), -64, 0, 0.5, { trans: Trans.QUINT, ease: Ease.OUT }),
            tween((x) => (this.actionsBlock.style.transform = `translateX(${x}px)`), -80, 0, 0.6, { trans: Trans.QUART, ease: Ease.OUT }),
            tween((x) => (this.leaderboard.style.transform = `translateX(${x}px)`), -96, 0, 0.7, { trans: Trans.CUBIC, ease: Ease.OUT }),
        ];
        this.transition(true);
    }

    transition(show, onDone) {
        const from = show ? { a: 0, x: -64, y: 0, s: 1 } : { a: 1, x: 0, y: 0, s: 1 };
        const to = show ? { a: 1, x: 0, y: 0, s: 1 } : { a: 0, x: 0, y: 24, s: 0.9 };
        this.transitionTween?.kill();
        this.transitionTween = tween(
            (v) => {
                this.root.style.opacity = v.a;
                this.root.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.s})`;
            },
            from,
            to,
            show ? 0.4 : 0.3,
            { trans: Trans.CUBIC, ease: Ease.OUT, onDone },
        );
    }

    update(delta) {
        const cursor = this.app.mouse;
        for (const o of this.outlines) {
            const r = o.getBoundingClientRect();
            o.style.background = outlineBackground(r, 0, cursor, null);
        }
        const sound = this.app.sound;
        const active = sound.map?.name === this.map.name && sound.song.playing;
        this.flatPreview.update(delta, sound.song.getPlaybackPosition() * 1000, active);
    }

    dispose() {
        this.unsubs.forEach((u) => u());
        for (const t of this.slide ?? []) t.kill();
        this.lbTweens?.forEach((t) => t.kill());
    }
}


export class MapInfo extends Emitter {
    constructor(parent, app) {
        super();
        this.app = app;
        this.root = el('div', 'map-info', parent);
        this.holder = el('div', 'holder', this.root);
        this.container = null;
        this.old = [];
    }

    resize() {
        const side = Math.min(850, window.innerHeight - 208);
        this.holder.style.width = `${side}px`;
        this.holder.style.height = `${side}px`;
    }

    select(map) {
        if (this.container?.map.name === map?.name) return;
        const old = this.container;
        if (old) {
            old.transition(false, () => {
                old.dispose();
                old.root.remove();
            });
        }
        if (!map) {
            this.container = null;
            return;
        }
        this.container = new MapInfoContainer(this, map);
        this.holder.appendChild(this.container.root);
        this.container.setup();
    }

    refresh() {
        const map = this.container?.map;
        if (!map) return;
        const c = this.container;
        this.container = null;
        c.dispose();
        c.root.remove();
        this.select(this.app.mapManager.getMapByName(map.name));
    }

    update(delta) {
        this.resize();
        this.container?.update(delta);
    }

    onRightClick() {
        if (this.container?.leaderboardShown) this.container.toggleLeaderboard(false);
    }
}
