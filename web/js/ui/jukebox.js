// Port of scripts/ui/menu/JukeboxPanel.cs and scripts/ui/AudioSpectrum.cs

import { spectrumAnalyser } from '../audio.js';
import { clamp, lerp } from '../util.js';
import { el } from './common.js';

// AudioSpectrum: bars over a linear frequency range, normalised to a smoothed ceiling
export class AudioSpectrum {
    constructor(canvas, { minFreq = 0, maxFreq = 6000, barSize = 4, barGap = 4, barMinSize = 1, align = 1, responsiveness = 24, played = '#c90045', rest = 'rgba(255,202,205,0.745)', progressive = true } = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        Object.assign(this, { minFreq, maxFreq, barSize, barGap, barMinSize, align, responsiveness, played, rest, progressive });
        this.magnitudes = [];
        this.ceiling = 0.01;
        this.targetCeiling = 0.01;
        this.data = null;
        this.progress = 0;
    }

    update(delta) {
        const analyser = spectrumAnalyser();
        if (!this.data || this.data.length !== analyser.frequencyBinCount) this.data = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(this.data);
        const binHz = analyser.context.sampleRate / analyser.fftSize;

        const pr = Math.min(window.devicePixelRatio || 1, 2);
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        if (this.canvas.width !== Math.round(w * pr) || this.canvas.height !== Math.round(h * pr)) {
            this.canvas.width = Math.round(w * pr);
            this.canvas.height = Math.round(h * pr);
        }

        const barCount = Math.round((w - this.barSize) / (this.barSize + this.barGap));
        if (this.magnitudes.length !== barCount) this.magnitudes = new Array(barCount).fill(0);
        const freqStep = (this.maxFreq - this.minFreq) / barCount;
        let maxMagnitude = 0;

        for (let i = 0; i < barCount; i++) {
            const lo = this.minFreq + Math.max(0, i * freqStep);
            const hi = lo + freqStep;
            let mag = 0;
            const b0 = Math.max(0, Math.floor(lo / binHz));
            const b1 = Math.min(this.data.length - 1, Math.max(b0, Math.ceil(hi / binHz)));
            for (let b = b0; b <= b1; b++) {
                const v = Math.pow(10, this.data[b] / 20);
                if (v > mag) mag = v;
            }
            if (!Number.isFinite(mag)) mag = 0;
            this.magnitudes[i] = lerp(this.magnitudes[i], mag, Math.min(1, delta * this.responsiveness));
            if (this.magnitudes[i] > maxMagnitude) maxMagnitude = this.magnitudes[i];
        }

        this.targetCeiling = maxMagnitude > 0.0015 ? maxMagnitude : this.targetCeiling;
        this.ceiling = lerp(this.ceiling, this.targetCeiling, Math.min(1, delta * 6));
        this.draw(barCount, w, h, pr);
    }

    draw(barCount, w, h, pr) {
        const ctx = this.ctx;
        ctx.setTransform(pr, 0, 0, pr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        if (barCount <= 1) return;
        const sizeX = w - this.barSize;
        ctx.lineWidth = this.barSize;
        for (let i = 0; i < barCount; i++) {
            const scale = clamp(this.magnitudes[i] / this.ceiling, this.barMinSize / h, 1);
            const x = (i / (barCount - 1)) * sizeX + this.barSize / 2;
            const y0 = this.align * (1 - scale) * h;
            ctx.strokeStyle = this.progressive && x / w < this.progress ? this.played : this.rest;
            ctx.beginPath();
            ctx.moveTo(x, y0);
            ctx.lineTo(x, y0 + scale * h);
            ctx.stroke();
        }
    }
}

export class JukeboxPanel {
    constructor(parent, app) {
        this.app = app;
        this.root = el('div', 'jukebox theme', parent);
        el('div', 'background blur', this.root);
        const canvas = el('canvas', 'spectrum', this.root);
        this.spectrum = new AudioSpectrum(canvas);

        this.titleHolder = el('div', 'title-holder', this.root);
        el('div', 'panel', this.titleHolder);
        this.title = el('button', 'title', this.titleHolder);
        this.title.addEventListener('click', () => {
            const map = this.app.sound.map;
            if (map) this.app.focusMap(map);
        });

        this.rewind = el('button', 'control rewind', this.root);
        this.pause = el('button', 'control pause', this.root);
        this.skip = el('button', 'control skip', this.root);
        this.rewind.addEventListener('click', () => this.onRewind());
        this.pause.addEventListener('click', () => this.app.sound.toggleJukeboxPause());
        this.skip.addEventListener('click', () => this.onSkip());

        const sound = app.sound;
        sound.on('jukeboxPlayed', (map) => this.updateMap(map));
        sound.on('jukeboxEmpty', () => this.clearMap());
        sound.on('menuTheme', () => this.showMenuTheme());
        this.updateSkin();
        this.clearMap();

        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => sound.toggleJukeboxPause());
            navigator.mediaSession.setActionHandler('pause', () => sound.toggleJukeboxPause());
            navigator.mediaSession.setActionHandler('nexttrack', () => this.onSkip());
            navigator.mediaSession.setActionHandler('previoustrack', () => this.onRewind());
        }
    }

    updateSkin() {
        const sm = this.app.skinManager;
        this.rewind.style.backgroundImage = `url("${sm.url('jukeboxSkipImage')}")`;
        this.skip.style.backgroundImage = `url("${sm.url('jukeboxSkipImage')}")`;
    }

    clearMap() {
        this.title.textContent = '';
        this.title.disabled = true;
        this.titleHolder.classList.add('hidden');
    }

    showMenuTheme() {
        this.title.textContent = 'Menu Theme';
        this.title.disabled = true;
        this.titleHolder.classList.remove('hidden');
    }

    updateMap(map) {
        if (!map) return this.clearMap();
        this.title.textContent = map.prettyTitle;
        this.title.disabled = false;
        this.titleHolder.classList.remove('hidden');
    }

    onSkip() {
        const sound = this.app.sound;
        if (sound.isScopedPlayback()) return;
        sound.jukeboxIndex++;
        sound.playJukebox(sound.jukeboxIndex);
    }

    onRewind() {
        const sound = this.app.sound;
        if (sound.isScopedPlayback()) return;
        if (sound.song.getPlaybackPosition() < 2) {
            sound.jukeboxIndex--;
            sound.playJukebox(sound.jukeboxIndex);
        } else {
            sound.song.seek(0);
        }
    }

    update(delta) {
        const sound = this.app.sound;
        const song = sound.song;
        const paused = sound.isJukeboxPaused();
        const url = this.app.skinManager.url(paused ? 'jukeboxPlayImage' : 'jukeboxPauseImage');
        if (this.pauseUrl !== url) {
            this.pauseUrl = url;
            this.pause.style.backgroundImage = `url("${url}")`;
        }
        const length = song.getLength();
        this.spectrum.progress = song.playing && length > 0 ? song.getPlaybackPosition() / length : 0;
        if (sound.map && !song.playing && !song.streamPaused && !sound.menuMusic.playing && !this.title.disabled && this.title.textContent !== sound.map.prettyTitle) {
            this.updateMap(sound.map);
        }
        this.spectrum.update(delta);
    }
}
