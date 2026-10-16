// Port of scripts/map/objects/Note.cs

import { HIT_BOX_SIZE } from '../constants.js';

export const HitResult = { None: 0, Hit: 1, Miss: 2 };

export class Note {
    constructor(index, millisecond, x, y) {
        this.index = index;
        this.millisecond = millisecond;
        this.x = x;
        this.y = y;
        this.hitWindow = 55;
        this.hittable = false;
        this.lastResult = HitResult.None;
        this.opacity = 1;
        // Transform3D as basis (3x3, column vectors) + origin
        this.basis = [1, 0, 0, 0, 1, 0, 0, 0, 1];
        this.origin = { x: 0, y: 0, z: 0 };
    }

    clone() {
        return new Note(this.index, this.millisecond, this.x, this.y);
    }

    hit(runner, playSound = true) {
        if (this.lastResult !== HitResult.None) return;

        this.lastResult = HitResult.Hit;
        runner.emitHitResult(this.index, this.lastResult);

        if (playSound) runner.sound.playHitSound();
    }

    miss(runner, playSound = true) {
        if (this.lastResult !== HitResult.None) return;

        this.lastResult = HitResult.Miss;
        runner.emitHitResult(this.index, this.lastResult);

        if (playSound) runner.sound.playMissSound();
    }

    doProcess(runner) {
        const attempt = runner.attempt;
        return this.millisecond >= attempt.startFrom && this.millisecond - attempt.progress <= 0 && this.lastResult === HitResult.None;
    }

    process(runner) {
        const attempt = runner.attempt;

        if (!this.hittable) {
            this.hittable = true;

            if (attempt.settings.AlwaysPlayHitSound.value) runner.sound.playHitSound();
        }

        const late = this.isPastWindow(runner, this.hitWindow);
        const replayLateness = attempt.isReplay && attempt.replays.length === 1 ? attempt.replays[0].notes[this.index] : 0;

        if (late && (!attempt.isReplay || replayLateness === -1)) {
            this.miss(runner);
        } else if (
            (!attempt.isReplay && this.checkHitResult(attempt) === HitResult.Hit) ||
            (attempt.isReplay && replayLateness !== -1 && this.isPastWindow(runner, replayLateness))
        ) {
            this.hit(runner);
        }
    }

    checkHitResult(attempt) {
        const c = attempt.cursorPosition;
        if (
            c.x + HIT_BOX_SIZE >= this.x - 0.5 &&
            c.x - HIT_BOX_SIZE <= this.x + 0.5 &&
            c.y + HIT_BOX_SIZE >= this.y - 0.5 &&
            c.y - HIT_BOX_SIZE <= this.y + 0.5
        ) {
            return HitResult.Hit;
        }
        return HitResult.Miss;
    }

    isPastWindow(runner, hitWindow) {
        return this.millisecond < runner.attempt.progress - hitWindow * runner.speed;
    }
}
