// Port of scripts/map/Replay.cs and the recording half of scripts/game/managers/ReplayManager.cs
// Same .phxr binary format, stored in IndexedDB `replays`

import { SettingsProfile } from '../settings.js';
import { BinaryWriter, FileParser, bytesEqual, sha256 } from '../util.js';
import { CameraLock, CameraSpin } from './camera.js';
import { createModifier } from './modifiers.js';

export class Replay {
    // bytes: the full file, mapExists: (mapID) => bool
    constructor(id, bytes, mapExists = () => true, notify = () => {}) {
        this.id = id;
        this.valid = true;
        this.complete = false;
        this.frameIndex = 0;
        this.skipIndex = 0;

        const file = new FileParser(bytes);
        const body = file.get(file.length - 32);
        const hash = file.get(32);

        if (!bytesEqual(sha256(body), hash)) {
            this.valid = false;
            notify('Replay file corrupted', 2);
            console.error('Replay file corrupted; invalid SHA256 hash');
            return;
        }

        file.seek(0);
        const sig = file.getString(4);
        if (sig !== 'phxr') {
            this.valid = false;
            notify('Replay file corrupted', 2);
            console.error(`Replay file corrupted; invalid file sig ${sig}`);
            return;
        }

        if (file.getUInt8() !== 1) {
            this.valid = false;
            return;
        }

        this.speed = file.getDouble();
        this.startFrom = file.getDouble();
        this.approachRate = file.getDouble();
        this.approachDistance = file.getDouble();
        this.approachTime = this.approachDistance / this.approachRate;
        this.fadeIn = file.getDouble();
        this.fadeOut = file.getBool();
        this.pushback = file.getBool();
        this.parallax = file.getDouble();
        this.fov = file.getDouble();
        this.noteSize = file.getDouble();
        this.sensitivity = file.getDouble();

        this.settings = new SettingsProfile({});
        this.settings.ApproachRate.value = this.approachRate;
        this.settings.ApproachDistance.value = this.approachDistance;
        this.settings.ApproachTime.value = this.approachTime;
        this.settings.FadeIn.value = this.fadeIn;
        this.settings.FadeOut.value = this.fadeOut ? 100 : 0;
        this.settings.Pushback.value = this.pushback;
        this.settings.FoV.value = this.fov;
        this.settings.NoteSize.value = this.noteSize;
        this.settings.Sensitivity.value = this.sensitivity;

        const status = file.getUInt8();
        this.status = status === 0 ? 'PASSED' : status === 1 ? 'DISQUALIFIED' : 'FAILED';

        const rawMods = file.getString(file.getUInt32()).split('_');
        this.modifiers = [];
        this.cameraMode = new CameraLock();

        for (const modName of rawMods) {
            // Strobe was never added here in the original client either
            switch (modName) {
                case 'NoFail':
                case 'Autoplay':
                case 'Ghost':
                case 'Chaos':
                case 'Earthquake':
                case 'Vortex':
                case 'VFlip':
                case 'HFlip':
                    this.modifiers.push(createModifier(modName));
                    break;
                case 'Spin':
                    this.cameraMode = new CameraSpin();
                    break;
            }
        }

        this.mapID = file.getString(file.getUInt32()).replace(/\.phxm$/i, '');
        this.mapNoteCount = file.getUInt64();
        this.mapFilePath = this.mapID;

        if (!mapExists(this.mapID)) {
            this.valid = false;
            notify('Replay map not found', 2);
            return;
        }

        this.player = file.getString(file.getUInt32());
        const frameCount = file.getUInt64();
        this.frames = new Array(frameCount);

        if (frameCount <= 1) {
            this.valid = false;
            return;
        }

        for (let i = 0; i < frameCount; i++) {
            this.frames[i] = { progress: file.getFloat(), x: file.getFloat(), y: file.getFloat() };
        }

        this.length = this.frames.length > 0 ? this.frames[this.frames.length - 1].progress : 0;
        this.notes = new Float32Array(this.mapNoteCount);
        this.firstNote = file.getUInt64();
        this.replayNoteCount = file.getUInt64();

        for (let i = 0; i < this.firstNote; i++) this.notes[i] = -1;
        for (let i = this.firstNote; i < this.firstNote + this.replayNoteCount; i++) {
            const note = file.getUInt8();
            // (254 / 55) is integer division in the original
            this.notes[i] = note === 255 ? -1 : Math.floor(note / 4);
        }
        for (let i = this.firstNote + this.replayNoteCount; i < this.mapNoteCount; i++) this.notes[i] = -1;

        const skipCount = file.getUInt64();
        this.skips = new Float32Array(skipCount);
        for (let i = 0; i < skipCount; i++) this.skips[i] = file.getFloat();
    }

    key() {
        return `${this.mapID}${this.valid}${this.speed}${this.startFrom}`;
    }
}

// ReplayManager.NewReplay + SaveReplay
export class ReplayRecorder {
    constructor(attempt) {
        const settings = attempt.settings;
        const w = new BinaryWriter(4096);
        this.writer = w;

        w.string('phxr');
        w.u8(1);
        w.f64(attempt.speed);
        w.f64(attempt.startFrom);
        w.f64(settings.ApproachRate.value);
        w.f64(settings.ApproachDistance.value);
        w.f64(settings.FadeIn.value);
        w.u8(settings.FadeOut.value > 0 ? 1 : 0);
        w.u8(settings.Pushback.value ? 1 : 0);
        w.f64(settings.CameraParallax.value);
        w.f64(settings.FoV.value);
        w.f64(settings.NoteSize.value);
        w.f64(settings.Sensitivity.value);

        this.statusOffset = w.position;
        w.u8(0);

        const mods = attempt.modifiers.map((m) => m.name);
        if (attempt.cameraMode.name === 'Spin') mods.push('Spin');

        const sized = (s) => {
            const before = w.position;
            w.u32(0);
            w.string(s);
            const end = w.position;
            w.seek(before);
            w.u32(end - before - 4);
            w.seek(end);
        };

        sized(mods.join('_'));
        sized(attempt.map.name);
        w.u64(attempt.map.notes.length);
        sized('You');

        this.frameCountOffset = w.position;
        w.u64(0);
    }

    finish(attempt) {
        const w = this.writer;
        w.seek(this.statusOffset);
        w.u8(attempt.alive ? (attempt.qualifies ? 0 : 1) : 2);
        w.seek(this.frameCountOffset);
        w.u64(attempt.replayFrames.length);
        for (const frame of attempt.replayFrames) {
            w.f32(frame[0]);
            w.f32(frame[1]);
            w.f32(frame[2]);
        }
        w.seek(w.length);
        w.u64(attempt.firstNote);
        w.u64(attempt.sum);

        const low = Math.max(0, attempt.firstNote);
        const high = Math.max(low, attempt.firstNote + attempt.sum);
        for (let i = low; i < high; i++) {
            const info = attempt.hitsInfo[i] ?? -1;
            w.u8(info === -1 ? 255 : Math.trunc(Math.min(254, info * 4)));
        }

        w.u64(attempt.replaySkips.length);
        for (const skip of attempt.replaySkips) w.f32(skip);

        const body = w.toUint8Array();
        const out = new Uint8Array(body.length + 32);
        out.set(body);
        out.set(sha256(body), body.length);
        return out;
    }
}
