// Port of scripts/SoundManager.cs on top of the Web Audio API.
// AudioStreamPlayer is emulated by `Player`, which tracks its playback position precisely so the
// runner's de-sync corrector works the same way it does with Godot's GetPlaybackPosition().

import { SettingsManager } from './settings.js';
import { Emitter } from './util.js';

let ctx = null;
export function audioContext() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    return ctx;
}

// Master bus with the SpectrumAnalyzer effect from default_bus_layout.tres
let master = null;
let analyser = null;
export function masterBus() {
    if (!master) {
        const c = audioContext();
        master = c.createGain();
        analyser = c.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0;
        master.connect(analyser);
        master.connect(c.destination);
    }
    return master;
}
export function spectrumAnalyser() {
    masterBus();
    return analyser;
}

export function resumeAudio() {
    const c = audioContext();
    if (c.state === 'suspended') c.resume();
}

const dbToGain = (db) => (db === -Infinity ? 0 : Math.pow(10, db / 20));

export async function decodeAudio(bytes) {
    if (!bytes || bytes.length === 0) return null;
    try {
        const copy = bytes.slice().buffer;
        return await audioContext().decodeAudioData(copy);
    } catch (e) {
        console.error('Could not decode audio', e);
        return null;
    }
}

export class Player extends Emitter {
    constructor(name, maxPolyphony = 1) {
        super();
        this.name = name;
        this.maxPolyphony = maxPolyphony;
        this.stream = null; // AudioBuffer
        this.gain = null;
        this._volumeDb = 0;
        this._pitch = 1;
        this.source = null;
        this.voices = [];
        this.playing = false;
        this._paused = false;
        this.offset = 0; // seconds into the stream at startTime
        this.startTime = 0; // ctx time when offset was valid
    }

    ensureGain() {
        if (!this.gain) {
            const c = audioContext();
            this.gain = c.createGain();
            this.gain.gain.value = dbToGain(this._volumeDb);
            this.gain.connect(masterBus());
        }
        return this.gain;
    }

    get volumeDb() {
        return this._volumeDb;
    }

    set volumeDb(db) {
        this._volumeDb = db;
        if (this.gain) this.gain.gain.value = dbToGain(db);
    }

    getLength() {
        return this.stream ? this.stream.duration : 0;
    }

    getPlaybackPosition() {
        if (!this.playing) return this.offset;
        if (this._paused) return this.offset;
        return this.offset + (audioContext().currentTime - this.startTime) * this._pitch;
    }

    get pitchScale() {
        return this._pitch;
    }

    set pitchScale(p) {
        if (!(p > 0)) return;
        if (this.playing && !this._paused) {
            this.offset = this.getPlaybackPosition();
            this.startTime = audioContext().currentTime;
        }
        this._pitch = p;
        if (this.source) this.source.playbackRate.value = p;
    }

    get streamPaused() {
        return this._paused;
    }

    set streamPaused(paused) {
        if (paused === this._paused) return;
        if (!this.playing) {
            this._paused = paused;
            return;
        }
        if (paused) {
            this.offset = this.getPlaybackPosition();
            this._paused = true;
            this.killSource();
        } else {
            this._paused = false;
            this.startSource(this.offset);
        }
    }

    killSource() {
        if (this.source) {
            this.source.onended = null;
            try {
                this.source.stop();
            } catch {}
            this.source.disconnect();
            this.source = null;
        }
    }

    startSource(from) {
        this.killSource();
        if (!this.stream) return;
        const c = audioContext();
        const src = c.createBufferSource();
        src.buffer = this.stream;
        src.playbackRate.value = this._pitch;
        src.connect(this.ensureGain());
        this.offset = Math.max(0, from);
        this.startTime = c.currentTime;
        src.onended = () => {
            if (this.source !== src) return;
            this.source = null;
            this.playing = false;
            this.offset = 0;
            this.emit('finished');
        };
        if (this.offset < this.stream.duration) src.start(0, this.offset);
        else queueMicrotask(() => src.onended?.());
        this.source = src;
    }

    play(from = 0) {
        if (!this.stream) return;
        if (this.maxPolyphony > 1) {
            // one-shot sound effects
            const c = audioContext();
            this.voices = this.voices.filter((v) => !v.done);
            if (this.voices.length >= this.maxPolyphony) {
                const old = this.voices.shift();
                try {
                    old.src.stop();
                } catch {}
            }
            const src = c.createBufferSource();
            src.buffer = this.stream;
            src.playbackRate.value = this._pitch;
            src.connect(this.ensureGain());
            const voice = { src, done: false };
            src.onended = () => (voice.done = true);
            src.start(0, from);
            this.voices.push(voice);
            return;
        }
        this._paused = false;
        this.playing = true;
        this.startSource(from);
    }

    seek(t) {
        if (!this.playing) {
            this.offset = Math.max(0, t);
            return;
        }
        if (this._paused) {
            this.offset = Math.max(0, t);
            return;
        }
        this.startSource(t);
    }

    stop() {
        this.killSource();
        for (const v of this.voices) {
            try {
                v.src.stop();
            } catch {}
        }
        this.voices = [];
        this.playing = false;
        this._paused = false;
        this.offset = 0;
    }
}

export const PlaybackScope = { Silent: 0, Preview: 1, GameplayResults: 2 };

class SoundManagerClass extends Emitter {
    constructor() {
        super();
        this.hitSound = new Player('Hit', 16);
        this.missSound = new Player('Miss', 16);
        this.failSound = new Player('Fail', 1);
        this.song = new Player('Song');
        this.menuMusic = new Player('Menu');
        this.map = null;
        this.scope = PlaybackScope.Silent;
        this.jukeboxQueue = [];
        this.jukeboxIndex = 0;
        this.menuMusicPausedByUser = false;
        this.songToken = 0;
        // supplied by main.js
        this.getMaps = () => [];
        this.loadMapAudio = async () => null;
        this.isMainMenu = () => false;
        this.sceneName = () => '';
        this.speed = () => 1;

        this.song.on('finished', () => {
            if (this.isScopedPlayback()) {
                this.stopScopedSession();
                return;
            }
            switch (this.sceneName()) {
                case 'SceneMenu':
                    if (SettingsManager.settings.AutoplayJukebox.value) {
                        this.jukeboxIndex++;
                        this.playJukebox(this.jukeboxIndex);
                    }
                    break;
                case 'SceneResults':
                    this.playJukebox(this.jukeboxIndex);
                    break;
            }
        });
    }

    async updateSkin(skin) {
        const [hit, miss, fail, menu] = await Promise.all([
            decodeAudio(skin.hitSoundBuffer),
            decodeAudio(skin.missSoundBuffer),
            decodeAudio(skin.failSoundBuffer),
            decodeAudio(skin.menuMusicBuffer),
        ]);
        this.hitSound.stream = hit;
        this.missSound.stream = miss;
        this.failSound.stream = fail;
        const wasPlaying = this.menuMusic.playing;
        this.menuMusic.stop();
        this.menuMusic.stream = menu;
        if (wasPlaying) this.menuMusic.play();
        this.refreshMenuMusicPlayback();
    }

    static computeVolumeDb(volume, master, range) {
        if (volume <= 0 || master <= 0) return -Infinity;
        return -80 + range * Math.pow(volume / 100, 0.1) * Math.pow(master / 100, 0.1);
    }

    static computeVolumeFromDb(db, master, range) {
        if (db === -Infinity || master <= 0) return 0;
        return Math.min(100, Math.max(0, 100 * Math.pow((db + 80) / (range * Math.pow(master / 100, 0.1)), 10)));
    }

    updateVolume() {
        const s = SettingsManager.settings;
        const v = SoundManagerClass.computeVolumeDb;
        this.song.volumeDb = v(s.VolumeMusic.value, s.VolumeMaster.value, 70);
        this.menuMusic.volumeDb = v(s.VolumeMenuMusic.value, s.VolumeMaster.value, 70);
        this.hitSound.volumeDb = v(s.VolumeHitSound.value, s.VolumeMaster.value, 80);
        this.missSound.volumeDb = v(s.VolumeMissSound.value, s.VolumeMaster.value, 80);
        this.failSound.volumeDb = v(s.VolumeSFX.value, s.VolumeMaster.value, 80);
    }

    playHitSound() {
        if (SettingsManager.settings.EnableHitSound.value && this.hitSound.stream) this.hitSound.play();
    }

    playMissSound() {
        if (SettingsManager.settings.EnableMissSound.value && this.missSound.stream) this.missSound.play();
    }

    isScopedPlayback() {
        return !SettingsManager.settings.AutoplayJukebox.value;
    }

    updateJukeboxQueue() {
        this.jukeboxQueue = this.getMaps().map((m) => m.id);
    }

    async loadSong(map) {
        const token = ++this.songToken;
        const buffer = await this.loadMapAudio(map);
        if (token !== this.songToken) return false;
        this.song.stop();
        this.song.stream = buffer;
        return true;
    }

    async playJukeboxMap(map) {
        if (map == null) return;

        if (this.isScopedPlayback()) {
            await this.startMapSelectionPlayback(map);
            return;
        }

        this.menuMusic.stop();
        this.menuMusicPausedByUser = false;
        this.map = map;

        if (!map.hasAudio) {
            this.jukeboxIndex++;
            if (this.getMaps().some((m) => m.hasAudio)) this.playJukebox(this.jukeboxIndex);
            return;
        }

        this.jukeboxIndex = this.getMaps().findIndex((x) => x.id === map.id);
        if (!(await this.loadSong(map))) return;
        this.song.pitchScale = 1;
        this.song.play();
        this.emit('jukeboxPlayed', map);
    }

    playJukebox(index = -1) {
        if (this.jukeboxQueue.length === 0) return;
        index = index === -1 ? this.jukeboxIndex : index;
        if (index >= this.jukeboxQueue.length) index = 0;
        else if (index < 0) index = this.jukeboxQueue.length - 1;
        const map = this.getMaps().find((m) => m.id === this.jukeboxQueue[index]);
        return this.playJukeboxMap(map);
    }

    async startMapSelectionPlayback(map) {
        if (map == null) return;
        this.song.stop();
        this.menuMusic.stop();
        this.menuMusicPausedByUser = false;
        this.map = map;
        this.scope = PlaybackScope.Preview;
        const idx = this.getMaps().findIndex((x) => x.id === map.id);
        if (idx >= 0) this.jukeboxIndex = idx;
        if (!map.hasAudio) {
            this.song.stream = null;
            this.emit('jukeboxPlayed', map);
            return;
        }
        if (!(await this.loadSong(map))) return;
        this.song.pitchScale = this.speed();
        this.song.play(0);
        this.emit('jukeboxPlayed', map);
    }

    beginGameplayScope(map) {
        if (!this.isScopedPlayback()) return;
        this.map = map;
        this.scope = PlaybackScope.GameplayResults;
        this.menuMusic.stop();
    }

    stopScopedSession() {
        this.song.stop();
        this.map = null;
        this.scope = PlaybackScope.Silent;
        this.emit('jukeboxEmpty');
        this.refreshMenuMusicPlayback();
    }

    isJukeboxPaused() {
        if (this.song.streamPaused) return true;
        return this.menuMusicPausedByUser;
    }

    toggleJukeboxPause() {
        if (this.song.playing || this.song.streamPaused) {
            this.song.streamPaused = !this.song.streamPaused;
            this.emit('jukeboxState');
            return this.song.streamPaused;
        }
        if (!this.menuMusic.stream) return false;
        if (!this.shouldPlayMenuMusic() && !this.menuMusicPausedByUser) return false;

        this.menuMusicPausedByUser = !this.menuMusicPausedByUser;
        if (this.menuMusicPausedByUser) this.menuMusic.streamPaused = true;
        else if (this.menuMusic.streamPaused) this.menuMusic.streamPaused = false;
        else if (!this.menuMusic.playing) this.menuMusic.play();
        this.emit('jukeboxState');
        return this.menuMusicPausedByUser;
    }

    shouldPlayMenuMusic() {
        if (!SettingsManager.settings.EnableMenuMusic.value) return false;
        if (!this.menuMusic.stream) return false;
        if (!this.isMainMenu()) return false;
        if (this.song.playing) return false;
        return true;
    }

    // called every frame like SoundManager._Process does, which is also what makes the menu theme repeat
    refreshMenuMusicPlayback(silent = false) {
        if (!silent) this.emit('jukeboxState');

        if (this.menuMusicPausedByUser) {
            if (this.menuMusic.playing && !this.menuMusic.streamPaused) this.menuMusic.streamPaused = true;
            if (!silent) this.emit('menuTheme');
            return;
        }

        if (this.shouldPlayMenuMusic()) {
            const started = !this.menuMusic.playing || this.menuMusic.streamPaused;
            if (this.menuMusic.streamPaused) this.menuMusic.streamPaused = false;
            else if (!this.menuMusic.playing) this.menuMusic.play();
            if (!silent || started) this.emit('menuTheme');
        } else if (this.menuMusic.playing || this.menuMusic.streamPaused) {
            this.menuMusic.stop();
            if (this.map == null) this.emit('jukeboxEmpty');
        }
    }
}

export const SoundManager = new SoundManagerClass();
export const computeVolumeDb = SoundManagerClass.computeVolumeDb;
export const computeVolumeFromDb = SoundManagerClass.computeVolumeFromDb;
