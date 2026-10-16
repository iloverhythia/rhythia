// Port of scripts/game/Runner.cs
// Rendering, HUD, cursor and replay hooks are injected by game.js so this file stays a straight logic port.

import { BREAK_TIME, HIT_WINDOW } from '../constants.js';
import { HitResult } from '../map/note.js';
import { Emitter, binarySearch } from '../util.js';
import { AutoplayHandler } from './autoplay.js';

export class Runner extends Emitter {
    constructor({ sound, stats, settingsManager, onStop, onSaveReplay, onLeaderboard }) {
        super();
        this.sound = sound;
        this.stats = stats;
        this.settingsManager = settingsManager;
        this.onStop = onStop;
        this.onSaveReplay = onSaveReplay;
        this.onLeaderboard = onLeaderboard;

        this.attempt = null;
        this.objectIndicesStart = {};
        this.objectIndicesEnd = {};
        this.map = null;
        this.speed = 1;
        this.paused = false;
        this.playing = false;
        this.stopQueued = false;
        this.notesOnly = false;

        this.settings = null;
        this.autoplayHandler = null;
        this.lastFrame = performance.now() * 1000;
        this.firstFrame = true;
        this.autoplayEnabled = false;
        this.hitResultProgressOverride = null;
        this.noteTimestamps = [];

        // injected
        this.hud = null;
        this.renderers = [];
        this.cursorManager = null;
        this.replayManager = null;
        this.tempMode = false;
    }

    emitHitResult(noteIndex, hitResult) {
        this.onHitResultChanged(noteIndex, hitResult);
        this.emit('hitResultChanged', noteIndex, hitResult);
    }

    process() {
        const now = performance.now() * 1000;
        const delta = (now - this.lastFrame) / 1000000;
        this.lastFrame = now;

        if (!this.playing) return;
        if (this.firstFrame) {
            this.firstFrame = false;
            return;
        }

        const attempt = this.attempt;
        const settings = this.settings;
        const song = this.sound.song;

        attempt.progress += delta * 1000 * this.speed;

        // De-sync corrector
        if (attempt.progress > 0 && attempt.progress < attempt.length && !attempt.stopped && song.playing) {
            const audioDelay = attempt.progress - settings.LocalOffset.value - 1000 * song.getPlaybackPosition();

            // if de-sync is over 40 milliseconds, then slightly adjust the speed of the song until under 40 milliseconds
            if (Math.abs(audioDelay / this.speed) > Math.max(40, delta)) {
                song.pitchScale = Math.min(Math.max(this.speed + audioDelay / 1000, Math.max(0.01, this.speed - 0.5)), this.speed + 0.5);
            } else if (Math.abs(song.pitchScale - this.speed) > 0.00001) {
                song.pitchScale = this.speed;
            }
        }

        if (this.autoplayEnabled) {
            this.cursorManager.updateAutoplayCursor(this.autoplayHandler.getCursorPosition(attempt.progress));
            this.processAutoplayHits();
        }

        // Save replay frame (60 per second, only when the cursor moved)
        if (
            !this.autoplayEnabled &&
            !attempt.stopped &&
            settings.RecordReplays.value &&
            !attempt.map.ephemeral &&
            now - attempt.lastReplayFrame >= 1000000 / 60
        ) {
            // the original compares array slices by reference, which is always "different"
            attempt.lastReplayFrame = now;
            attempt.replayFrames.push([attempt.progress, attempt.cursorPosition.x, attempt.cursorPosition.y]);
        }

        // Song state check
        if (attempt.map.audioBuffer != null && song.stream) {
            const offsetProgress = attempt.progress - settings.LocalOffset.value;
            const songEnd = song.getLength() * 1000;

            if (!song.playing && offsetProgress >= 0 && offsetProgress < songEnd) {
                song.play(offsetProgress / 1000);
            } else if (song.playing && offsetProgress >= songEnd) {
                song.stop();
            }
        }

        // Skip check
        const notes = attempt.map.notes;
        const passedNotes = this.objectIndicesStart.Note;
        const nextNoteMillisecond = passedNotes >= notes.length ? 2147483647 : notes[passedNotes].millisecond;

        if (nextNoteMillisecond - attempt.progress >= BREAK_TIME * this.speed) {
            const lastNoteMillisecond = passedNotes > 0 ? notes[passedNotes - 1].millisecond : 0;
            const skipWindow = nextNoteMillisecond - BREAK_TIME - lastNoteMillisecond;

            // only allow skipping if i'm gonna allow it for at least 1 second
            if (skipWindow >= 1000 * this.speed) {
                if (!attempt.canSkip) {
                    attempt.canSkip = true;
                    this.emit('skipAvailable', attempt);
                }
            }
        } else {
            attempt.canSkip = false;
        }

        // Object processing
        this.processObjects();
        this.renderObjects(delta);

        if (this.stopQueued || (attempt.progress >= attempt.length && !attempt.isReplay)) {
            this.stopQueued = false;
            this.stop();
        }
    }

    processObjects() {
        const attempt = this.attempt;
        for (const type in attempt.objects) {
            const objects = attempt.objects[type];
            const startIndex = this.objectIndicesStart[type];

            this.objectIndicesEnd[type] = objects.length;

            for (let i = startIndex; i < objects.length; i++) {
                const obj = objects[i];

                if (obj.doProcess(this)) {
                    obj.process(this);
                } else {
                    // don't waste time iterating over objects past the approach time
                    if (obj.millisecond > attempt.progress + this.settings.ApproachTime.value * 1000 * this.speed) {
                        this.objectIndicesEnd[type] = Math.max(obj.index, this.objectIndicesStart[type]);
                        break;
                    }

                    if (obj.index === this.objectIndicesStart[type] && obj.millisecond < Math.max(attempt.progress, attempt.startFrom)) {
                        this.objectIndicesStart[type]++;
                    }
                }
            }
        }
    }

    renderObjects(delta) {
        for (const renderer of this.renderers) renderer.process(delta, this.attempt);
    }

    processAutoplayHits() {
        const attempt = this.attempt;
        if (!this.autoplayEnabled || attempt.isReplay || !attempt.objects.Note) return;

        const objects = attempt.objects.Note;
        for (let i = this.objectIndicesStart.Note; i < objects.length; i++) {
            const note = objects[i];
            if (note.millisecond > attempt.progress) break;
            if (note.millisecond < attempt.startFrom || note.lastResult !== HitResult.None) continue;

            note.hittable = true;
            try {
                this.hitResultProgressOverride = note.millisecond;
                note.hit(this);
            } finally {
                this.hitResultProgressOverride = null;
            }
        }
    }

    play() {
        const attempt = this.attempt;
        if (attempt == null) return;

        this.map = attempt.map;
        this.speed = attempt.speed;

        this.objectIndicesStart = {};
        this.objectIndicesEnd = {};
        for (const type in attempt.objects) {
            this.objectIndicesStart[type] = attempt.firstNote;
            this.objectIndicesEnd[type] = attempt.objects[type].length;
        }
        this.noteTimestamps = attempt.objects.Note.map((n) => n.millisecond);

        this.settings = attempt.isReplay ? attempt.replays[0].settings : this.settingsManager.settings;

        if (!this.notesOnly) {
            this.hud.init(this);
            attempt.timeStarted = performance.now() * 1000;
            this.emit('attemptStatsUpdated', attempt);
        }

        for (const mod of attempt.modifiers) {
            mod.active = false;
            if (mod.isMapModifier || mod.isRenderModifier) {
                mod.activate(attempt);
                this.hud.displayModifier(mod);
                if (mod.isMapModifier) mod.modifyMap(attempt.map, attempt);
            }
        }

        this.autoplayEnabled = attempt.modifiers.some((m) => m.name === 'Autoplay') && !attempt.isReplay;

        if (this.autoplayEnabled) {
            for (const mod of attempt.modifiers.filter((m) => m.name === 'Autoplay')) {
                mod.activate(attempt);
                if (!this.notesOnly) this.hud.displayModifier(mod);
            }
            this.autoplayHandler = new AutoplayHandler(attempt);
        } else {
            this.autoplayHandler = null;
        }

        for (const renderer of this.renderers) renderer.setup(attempt.settings);

        this.sound.beginGameplayScope(attempt.map);
        this.sound.updateVolume();
        this.sound.song.pitchScale = this.speed;

        if (attempt.isReplay) {
            for (const replay of attempt.replays) replay.frameIndex = 0;
        }

        this.playing = true;
        this.firstFrame = true;
    }

    pause(pause = null) {
        this.playing = pause ?? !this.playing;
        this.sound.song.pitchScale = this.speed;
        this.sound.song.streamPaused = !this.playing;
        if (this.playing) this.syncSongPosition();
    }

    skip() {
        const attempt = this.attempt;
        if (!attempt.canSkip) return;

        attempt.replaySkips.push(attempt.progress);
        const passedNotes = this.objectIndicesStart.Note;

        if (passedNotes >= attempt.map.notes.length) {
            this.stop();
        } else {
            // turn AT to ms and multiply by 1.5x
            this.seek(attempt.map.notes[passedNotes].millisecond - this.settings.ApproachTime.value * 1500 * this.speed);
        }
    }

    seek(ms) {
        const attempt = this.attempt;
        attempt.progress = ms;
        this.autoplayHandler?.reset(attempt.progress);

        for (const type in attempt.objects) {
            this.objectIndicesStart[type] = binarySearch(this.noteTimestamps, ms) + 1;
            this.objectIndicesEnd[type] = attempt.objects[type].length;
        }

        this.processObjects();
        this.renderObjects(0);
        this.syncSongPosition();
    }

    fail() {
        const attempt = this.attempt;
        if (attempt.alive) this.sound.failSound.play();

        if (!attempt.isReplay) {
            attempt.alive = false;
            attempt.qualifies = false;
            if (attempt.deathTime === -1) attempt.deathTime = Math.max(0, attempt.progress);
        }
    }

    giveUp() {
        this.fail();
        this.stop();
    }

    queueStop() {
        if (!this.playing) return;
        this.playing = false;
        this.stopQueued = true;
    }

    stop(results = true) {
        const attempt = this.attempt;
        if (attempt.stopped) return;

        // give objects a last chance
        this.processObjects();

        this.playing = false;
        this.stopQueued = false;
        attempt.stopped = true;

        if (!this.autoplayEnabled && !attempt.isReplay) this.onSaveReplay?.(attempt);

        if (!attempt.isReplay && !this.tempMode) {
            const stats = this.stats;
            stats.GamePlaytime += Math.floor((performance.now() * 1000 - attempt.timeStarted) / 1000000);
            stats.TotalDistance += Math.floor(attempt.distanceMM);

            if (attempt.startFrom === 0 && !this.autoplayEnabled) {
                this.onLeaderboard?.(attempt, this.speed);

                if (attempt.qualifies) {
                    stats.Passes++;
                    stats.TotalScore += attempt.score;
                    if (attempt.accuracy === 100) stats.FullCombos++;
                    if (attempt.score > stats.HighestScore) stats.HighestScore = attempt.score;
                    stats.AverageAccuracy = (stats.AverageAccuracy + attempt.accuracy) / stats.Passes;
                }
            }

            stats.forceUpdate?.();
        }

        this.onStop?.(results);
    }

    onHitResultChanged(noteIndex, hitResult) {
        const attempt = this.attempt;
        const judgmentProgress = this.hitResultProgressOverride ?? attempt.progress;
        const lateness = attempt.isReplay
            ? attempt.hitsInfo[noteIndex]
            : Math.fround((Math.trunc(judgmentProgress) - attempt.map.notes[noteIndex].millisecond) / this.speed);
        const factor = 1 - Math.max(0, lateness - 25) / 150;
        const hitScore = Math.max(0, Math.trunc(100 * attempt.comboMultiplier * attempt.modsMultiplier * factor * ((this.speed - 1) / 2.5 + 1)));

        switch (hitResult) {
            case HitResult.Hit:
                attempt.hits++;
                attempt.sum++;
                attempt.accuracy = Math.floor(Math.fround(Math.fround(attempt.hits / attempt.sum) * 10000)) / 100;
                attempt.combo++;
                attempt.comboMultiplierProgress++;
                attempt.lastHitColour = this.skinColors[noteIndex % this.skinColors.length];
                attempt.score += hitScore;

                if (!attempt.isReplay) {
                    this.stats.NotesHit++;
                    if (attempt.combo > this.stats.HighestCombo) this.stats.HighestCombo = attempt.combo;
                    attempt.hitsInfo[noteIndex] = lateness;
                }

                if (attempt.comboMultiplierProgress === attempt.comboMultiplierIncrement) {
                    if (attempt.comboMultiplier < 8) {
                        attempt.comboMultiplierProgress = attempt.comboMultiplier === 7 ? attempt.comboMultiplierIncrement : 0;
                        attempt.comboMultiplier++;
                    }
                }
                break;
            case HitResult.Miss:
                attempt.misses++;
                attempt.sum++;
                attempt.accuracy = Math.floor(Math.fround(Math.fround(attempt.hits / attempt.sum) * 10000)) / 100;
                attempt.combo = 0;
                attempt.comboMultiplierProgress = 0;
                attempt.comboMultiplier = Math.max(1, attempt.comboMultiplier - 1);

                if (!attempt.isReplay) {
                    this.stats.NotesMissed++;
                    attempt.hitsInfo[noteIndex] = -1;
                }
                break;
        }

        if (hitResult !== HitResult.None) {
            const hit = hitResult === HitResult.Hit;
            this.updateHealth(hit);

            if (!attempt.isReplay && attempt.health <= 0 && attempt.alive) this.fail();

            if (this.checkFail(hit, attempt.health)) this.queueStop();
        }

        this.emit('attemptStatsUpdated', attempt);
    }

    updateHealth(hit) {
        const attempt = this.attempt;
        if (attempt.hasHealthModifier) {
            for (const mod of attempt.modifiers.filter((m) => m.isHealthModifier)) {
                attempt.health = mod.applyHealthResult(hit, attempt.health);
                if (!mod.active) {
                    mod.activate(attempt);
                    this.hud.displayModifier(mod);
                }
            }
        } else if (hit) {
            attempt.healthStep = Math.max(attempt.healthStep / 1.45, 15);
            attempt.health = Math.min(100, attempt.health + attempt.healthStep / 1.75);
        } else {
            attempt.health = Math.max(0, attempt.health - attempt.healthStep);
            attempt.healthStep = Math.min(attempt.healthStep * 1.2, 100);
        }
    }

    checkFail(hit, health) {
        const defaultFail = health <= 0;
        let fail = null;

        for (const mod of this.attempt.modifiers) {
            if (!mod.isFailModifier) continue;
            fail = mod.checkFailCondition(hit, health);
            if (fail !== defaultFail && !mod.active) {
                mod.activate(this.attempt);
                this.hud.displayModifier(mod);
            }
            if (fail === true) break;
        }

        return fail ?? defaultFail;
    }

    syncSongPosition() {
        const attempt = this.attempt;
        const song = this.sound.song;
        if (attempt.map.audioBuffer != null && song.stream) {
            const pos = (attempt.progress - attempt.settings.LocalOffset.value) / 1000;
            if (!song.playing && this.playing) {
                if (pos >= 0 && pos < song.getLength()) song.play(pos);
                return;
            }
            if (pos < 0) {
                song.stop();
                return;
            }
            song.seek(pos);
        }
    }
}

export { HIT_WINDOW };
