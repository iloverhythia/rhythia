// Port of scripts/game/Attempt.cs

import { CameraLock } from './camera.js';

function uniqueId() {
    try {
        let id = localStorage.getItem('rhythia.unique_id');
        if (!id) {
            id = Math.random().toString(16).slice(2, 18);
            localStorage.setItem('rhythia.unique_id', id);
        }
        return id;
    } catch {
        return 'browser';
    }
}

function datetimeString(date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

export class Attempt {
    constructor({ map, speed, startFrom, cameraMode, mods, players = null, replays = null, settings, skin, songLength = 0 }) {
        this.timeStarted = 0;
        this.deathTime = -1;
        this.id = `${map.name}_${uniqueId()}_${datetimeString(new Date())}`.replaceAll(':', '_');
        this.settings = settings;
        this.replays = replays;
        this.isReplay = replays != null;
        this.map = map;
        this.speed = speed;
        this.startFrom = startFrom;
        this.length = Math.max(1000 * songLength, map.length + 1000);
        this.players = players ?? [];
        this.progress = speed * -1000 - settings.ApproachTime.value * 1000 + startFrom;
        this.comboMultiplierIncrement = Math.max(2, Math.floor(map.notes.length / 200));
        this.cameraMode = cameraMode ?? new CameraLock();
        this.modifiers = mods ?? [];
        this.hasHealthModifier = this.modifiers.some((m) => m.isHealthModifier);
        this.objects = { Note: [...map.notes] };
        this.hitsInfo = this.isReplay ? this.replays[0].notes : new Float32Array(map.notes.length);

        this.useFadeOut = true;
        this.stopped = false;
        this.paused = false;
        this.alive = true;
        this.canSkip = false;
        this.qualifies = true;

        this.accuracy = 100;
        this.health = 100;
        this.healthStep = 15;

        this.hits = 0;
        this.misses = 0;
        this.sum = 0;
        this.score = 0;
        this.combo = 0;
        this.comboMultiplier = 1;
        this.comboMultiplierProgress = 0;
        this.modsMultiplier = 1;

        this.cameraPosition = { x: 0, y: 0, z: 3.75 };
        this.cursorPosition = { x: 0, y: 0 };
        this.rawCursorPosition = { x: 0, y: 0 };
        this.distanceMM = 0;

        this.firstNote = 0;
        this.replayPath = null;
        this.replayFrames = [];
        this.replaySkips = [];
        this.maxReplayLength = 0;
        this.lastReplayFrame = 0;

        if (this.isReplay) {
            for (const replay of this.replays) {
                if (replay.length > this.maxReplayLength) this.maxReplayLength = replay.length;
            }
        }

        if (startFrom > 0) {
            this.qualifies = false;
            for (const note of map.notes) {
                this.firstNote = note.index;
                if (note.millisecond >= startFrom) break;
            }
        }

        const colors = skin.noteColors;
        const index = (this.firstNote - 1) % colors.length;
        this.lastHitColour = colors[index >= 0 ? index : colors.length - Math.abs(index)];
    }
}
