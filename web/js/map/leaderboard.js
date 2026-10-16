// Port of scripts/map/Leaderboard.cs — same binary format as user/pbs/<map>, stored in IndexedDB `pbs`

import { Storage } from '../storage.js';
import { BinaryWriter, FileParser, bytesEqual, encodeUtf8, sha256 } from '../util.js';

export class Score {
    constructor(attemptID, player, qualifies, value, accuracy, time, progress, mapLength, speed, modifiers) {
        this.attemptID = attemptID;
        this.player = player;
        this.qualifies = qualifies;
        this.value = value;
        this.accuracy = accuracy;
        this.time = time;
        this.progress = progress;
        this.mapLength = mapLength;
        this.speed = speed;
        this.modifiers = modifiers ?? {};
    }

    static fromBuffer(buffer) {
        const f = new FileParser(buffer);
        const attemptID = f.getString(f.getUInt32());
        const player = f.getString(f.getUInt32());
        const qualifies = f.getBool();
        const value = f.getUInt64();
        const accuracy = f.getDouble();
        const time = f.getDouble();
        const progress = f.getDouble();
        const mapLength = f.getDouble();
        const speed = f.getDouble();
        const modifiers = JSON.parse(f.getString(f.getUInt32()) || '{}');
        return new Score(attemptID, player, qualifies, value, accuracy, time, progress, mapLength, speed, modifiers);
    }
}

export class Leaderboard {
    constructor(mapID, buffer) {
        this.mapID = mapID;
        this.valid = false;
        this.scoreCount = 0;
        this.scores = [];

        try {
            const file = new FileParser(buffer);
            const bytes = file.get(file.length - 32);
            file.seek(0);
            const count = file.getUInt32();
            this.scoreCount = count;
            for (let i = 0; i < count; i++) this.add(Score.fromBuffer(file.get(file.getUInt32())));
            this.valid = true;

            if (!bytesEqual(file.get(32), sha256(bytes))) {
                console.log('Leaderboard file corrupted; invalid leaderboard hash');
                this.reset();
            }
        } catch (e) {
            console.error(e);
            this.reset();
        }
    }

    static empty() {
        const bytes = new Uint8Array(4);
        const out = new Uint8Array(36);
        out.set(bytes);
        out.set(sha256(bytes), 4);
        return out;
    }

    static async load(mapID) {
        const buffer = await Storage.get('pbs', mapID);
        if (!buffer) return null;
        return new Leaderboard(mapID, buffer);
    }

    static async exists(mapID) {
        return Storage.exists('pbs', mapID);
    }

    add(score) {
        this.scores.push(score);
        this.scores.sort((a, b) => b.value - a.value);
        if (this.scores.length > 8) this.scores.length = 8;
        this.scoreCount = this.scores.length;
    }

    encode() {
        const w = new BinaryWriter();
        w.u32(this.scoreCount);
        for (const score of this.scores) {
            const offset = w.position;
            const attemptIdBytes = encodeUtf8(score.attemptID ?? '');
            const playerBytes = encodeUtf8(score.player ?? '');
            w.u32(0); // reserved for length
            w.u32(attemptIdBytes.length);
            w.raw(attemptIdBytes);
            w.u32(playerBytes.length);
            w.raw(playerBytes);
            w.u8(score.qualifies ? 1 : 0);
            w.u64(score.value);
            w.f64(score.accuracy);
            w.f64(score.time);
            w.f64(score.progress);
            w.f64(score.mapLength);
            w.f64(score.speed);
            const modifiersBytes = encodeUtf8(JSON.stringify(score.modifiers ?? {}));
            w.u32(modifiersBytes.length);
            w.raw(modifiersBytes);
            const end = w.position;
            w.seek(offset);
            w.u32(end - offset - 4);
            w.seek(end);
        }
        const body = w.toUint8Array();
        const out = new Uint8Array(body.length + 32);
        out.set(body);
        out.set(sha256(body), body.length);
        return out;
    }

    async save() {
        await Storage.put('pbs', this.mapID, this.encode());
    }

    reset() {
        this.valid = false;
        this.scoreCount = 0;
        this.scores = [];
    }
}
