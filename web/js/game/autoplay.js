// Port of scripts/game/AutoplayHandler.cs (the on-disk cache is skipped, the path is cheap to rebuild)

import { BOUNDS, HIT_BOX_SIZE } from '../constants.js';
import { clamp, toFloat, v2clamp } from '../util.js';

const MAX_SHIFT_MULTIPLIER = 0.25;

const auto = (x, y, millisecond) => ({ x, y, millisecond });
const posEq = (a, b) => a.x === b.x && a.y === b.y;
const hitboxSize = () => toFloat(0.5 + HIT_BOX_SIZE);
const sigmoid = (v) => 1 / (1 + Math.exp(-v));

function normalized(v) {
    const l = Math.hypot(v.x, v.y);
    return l === 0 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
}

function checkHit(note, cursor, size) {
    return Math.max(Math.abs(note.x - cursor.x), Math.abs(note.y - cursor.y)) < size;
}

function catmullRomRaw(pos0, pos1, pos2, pos3, u, time0, time1, time2, time3) {
    const splineAlpha = 0.4;
    const splineTension = -1;

    const t01 = Math.max(Math.abs(time0 - time1), 1) ** splineAlpha;
    const t12 = Math.max(Math.abs(time1 - time2), 1) ** splineAlpha;
    const t23 = Math.max(Math.abs(time2 - time3), 1) ** splineAlpha;

    let m1 = (1 - splineTension) * (pos2 - pos1 + t12 * ((pos1 - pos0) / t01 - (pos2 - pos0) / (t01 + t12)));
    let m2 = (1 - splineTension) * (pos2 - pos1 + t12 * ((pos3 - pos2) / t23 - (pos3 - pos1) / (t12 + t23)));

    if (!Number.isFinite(m1)) m1 = 0;
    if (!Number.isFinite(m2)) m2 = 0;

    const u2 = u * u;
    return (2 * (pos1 - pos2) + m1 + m2) * u2 * u + (-3 * (pos1 - pos2) - m1 - m1 - m2) * u2 + m1 * u + pos1;
}

function getSplinePosition(n0, n1, n2, n3, time) {
    const segmentDuration = n2.millisecond - n1.millisecond;
    if (segmentDuration <= 0) return { x: n1.x, y: n1.y };
    if (posEq(n1, n2)) return { x: n1.x, y: n1.y };

    const u = clamp((time - n1.millisecond) / segmentDuration, 0, 1);

    return {
        x: catmullRomRaw(n0.x, n1.x, n2.x, n3.x, u, n0.millisecond, n1.millisecond, n2.millisecond, n3.millisecond),
        y: catmullRomRaw(n0.y, n1.y, n2.y, n3.y, u, n0.millisecond, n1.millisecond, n2.millisecond, n3.millisecond),
    };
}

function clampShift(shift, limit) {
    if (shift.x === 0 || shift.y === 0) {
        return { x: clamp(shift.x, -limit, limit), y: clamp(shift.y, -limit, limit) };
    }
    let s = { ...shift };
    let k = clamp(s.x, -limit, limit) / s.x;
    s = { x: s.x * k, y: s.y * k };
    k = clamp(s.y, -limit, limit) / s.y;
    return { x: s.x * k, y: s.y * k };
}

function lowerBound(notes, time) {
    let low = 0;
    let high = notes.length;
    while (low < high) {
        const middle = low + ((high - low) >> 1);
        if (notes[middle].millisecond < time) low = middle + 1;
        else high = middle;
    }
    return low;
}

function mergeSimultaneousNotes(notes) {
    for (let i = 1; i < notes.length; i++) {
        if (notes[i].millisecond < notes[i - 1].millisecond) {
            notes.sort((a, b) => a.millisecond - b.millisecond);
            break;
        }
    }

    const merged = [];
    let noteIndex = 0;
    while (noteIndex < notes.length) {
        const first = notes[noteIndex++];
        let px = first.x;
        let py = first.y;
        let count = 1;
        while (noteIndex < notes.length && notes[noteIndex].millisecond === first.millisecond) {
            px += notes[noteIndex].x;
            py += notes[noteIndex].y;
            noteIndex++;
            count++;
        }
        merged.push(auto(px / count, py / count, first.millisecond));
    }
    return merged;
}

function cursorFromNotes(noteData, elapsed) {
    if (noteData.length === 0) return { x: 0, y: 0 };

    let last = 0;
    while (last + 1 < noteData.length) {
        if (noteData[last + 1].millisecond > elapsed) break;
        last++;
    }

    const n0 = noteData[Math.max(last - 1, 0)];
    const n1 = noteData[last];
    const n2 = noteData[Math.min(last + 1, noteData.length - 1)];
    const n3 = noteData[Math.min(last + 2, noteData.length - 1)];

    return v2clamp(getSplinePosition(n0, n1, n2, n3, elapsed), BOUNDS);
}

export class AutoplayHandler {
    constructor(attempt) {
        this.processedData = [];
        this.lastLoadedNote = 0;

        let notes = attempt.map.notes.map((n) => auto(n.x, n.y, n.millisecond));
        if (notes.length === 0) return;

        notes = mergeSimultaneousNotes(notes);

        const preprocessed = this.initialPreprocess(notes);
        const secondary = this.compressStacks(preprocessed);
        this.shiftPreprocess(notes, preprocessed, secondary);
    }

    reset(progress) {
        const index = lowerBound(this.processedData, progress);
        this.lastLoadedNote =
            index < this.processedData.length && this.processedData[index].millisecond === progress ? index : Math.max(0, index - 1);
    }

    getCursorPosition(progress) {
        const data = this.processedData;
        if (data.length === 0) return { x: 0, y: 0 };

        if (progress < data[this.lastLoadedNote].millisecond) this.reset(progress);

        while (this.lastLoadedNote + 1 < data.length) {
            if (data[this.lastLoadedNote + 1].millisecond > progress) break;
            this.lastLoadedNote++;
        }

        const i = this.lastLoadedNote;
        const n0 = data[Math.max(i - 1, 0)];
        const n1 = data[i];
        const n2 = data[Math.min(i + 1, data.length - 1)];
        const n3 = data[Math.min(i + 2, data.length - 1)];

        return v2clamp(getSplinePosition(n0, n1, n2, n3, progress), BOUNDS);
    }

    initialPreprocess(notes) {
        const pre = [];
        let i = 0;

        while (i < notes.length) {
            const note = notes[i];
            i++;

            const collected = [note];

            while (i < notes.length) {
                const next = notes[i];
                if (Math.abs(next.millisecond - note.millisecond) <= 5 && checkHit(note, next, hitboxSize() * 0.9)) {
                    collected.push(next);
                    i++;
                } else {
                    break;
                }
            }

            let avg = { x: 0, y: 0 };
            for (const c of collected) {
                avg.x += c.x;
                avg.y += c.y;
            }
            avg = { x: avg.x / collected.length, y: avg.y / collected.length };

            if (pre.length > 0) {
                const prev = pre[pre.length - 1];
                const timeElapsed = Math.abs(prev.millisecond - note.millisecond) / 1000;

                if (timeElapsed > 0) {
                    const speed = Math.hypot(prev.x - avg.x, prev.y - avg.y) / (timeElapsed * 100);
                    const k = 0.8 + (sigmoid(speed * 5) - 0.5) * 2 * 0.2;
                    avg = { x: avg.x * k, y: avg.y * k };
                }

                if (i > 2 && pre.length >= 2) {
                    const prevPrev = pre[pre.length - 2];
                    const dir1 = normalized({ x: prev.x - prevPrev.x, y: prev.y - prevPrev.y });
                    const dir2 = normalized({ x: avg.x - prev.x, y: avg.y - prev.y });
                    const k = 1 + Math.max(-(dir1.x * dir2.x + dir1.y * dir2.y) - 0.5, 0) * (1 / (timeElapsed * 20 + 1));
                    avg = { x: avg.x * k, y: avg.y * k };
                }
            }

            let newNote = auto(avg.x, avg.y, note.millisecond);
            const previousNote = notes[Math.max(i - 2, 0)];

            if (collected.length === 1 && note.x === previousNote.x && note.y === previousNote.y && pre.length > 0) {
                newNote = auto(pre[pre.length - 1].x, pre[pre.length - 1].y, newNote.millisecond);
            }

            pre.push(newNote);
        }

        return pre;
    }

    compressStacks(notes) {
        const out = [];
        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            if (i > 0 && i + 1 < notes.length && posEq(notes[i - 1], note) && posEq(notes[i + 1], note)) continue;
            out.push(note);
        }
        return out;
    }

    shiftPreprocess(originalNotes, preprocessed, secondary) {
        const maxRange = hitboxSize() * MAX_SHIFT_MULTIPLIER;
        const out = this.processedData;

        for (let i = 0; i + 1 < secondary.length; i++) {
            const n0 = secondary[Math.max(i - 2, 0)];
            const n1 = secondary[Math.max(i - 1, 0)];
            const n2 = secondary[i];
            const n3 = secondary[i + 1];
            const n4 = secondary[Math.min(i + 2, secondary.length - 1)];

            if (posEq(n1, n2) || posEq(n2, n3)) {
                out.push(n2);
                continue;
            }

            const position = getSplinePosition(n0, n1, n3, n4, n2.millisecond);
            const shift = clampShift({ x: position.x - n2.x, y: position.y - n2.y }, maxRange);
            const shifted = auto(n2.x + shift.x, n2.y + shift.y, n2.millisecond);
            const validation = [...out.slice(-3), shifted, ...secondary.slice(i + 1, i + 4)];

            let valid = true;
            const low = validation[Math.min(2, validation.length - 1)].millisecond;
            const high = validation[Math.max(0, validation.length - 3)].millisecond;

            for (let ni = lowerBound(originalNotes, low); ni < originalNotes.length; ni++) {
                const note = originalNotes[ni];
                if (note.millisecond > high) break;

                const hit =
                    checkHit(note, cursorFromNotes(validation, note.millisecond + 1), hitboxSize() * 0.9) ||
                    checkHit(note, cursorFromNotes(validation, note.millisecond + 5), hitboxSize() * 0.9);
                if (!hit) {
                    valid = false;
                    break;
                }
            }

            out.push(valid ? shifted : n2);
        }

        out.push(preprocessed[preprocessed.length - 1]);
    }
}
