// Port of scripts/game/modifiers/*.cs

import FastNoiseLite from '../../vendor/FastNoiseLite.js';

// Vector3.Up.Rotated(Vector3.Back, angle)
const upRotated = (angle) => ({ x: -Math.sin(angle), y: Math.cos(angle) });

export class Modifier {
    constructor() {
        this.active = false;
    }
    get rankable() {
        return false;
    }
    get scoreMultiplier() {
        return 1;
    }
    get incompatibleMods() {
        return [];
    }
    // capability flags in place of the C# interfaces
    get isMapModifier() {
        return typeof this.modifyMap === 'function';
    }
    get isRenderModifier() {
        return typeof this.modifyRenderObject === 'function';
    }
    get isFailModifier() {
        return typeof this.checkFailCondition === 'function';
    }
    get isHealthModifier() {
        return typeof this.applyHealthResult === 'function';
    }
    activate() {
        this.active = true;
    }
}

export class NoFailModifier extends Modifier {
    get name() {
        return 'NoFail';
    }
    get color() {
        return '#20e12c';
    }
    get isFail() {
        return false;
    }
    checkFailCondition() {
        return false;
    }
}

export class AutoplayModifier extends Modifier {
    get name() {
        return 'Autoplay';
    }
    get color() {
        return '#ffd166';
    }
    activate(attempt) {
        super.activate(attempt);
        attempt.qualifies = false;
    }
}

export class GhostModifier extends Modifier {
    get name() {
        return 'Ghost';
    }
    get color() {
        return '#ffffff';
    }
    get rankable() {
        return true;
    }
    get scoreMultiplier() {
        return 1.03;
    }
    activate(attempt) {
        super.activate(attempt);
        attempt.useFadeOut = false;
    }
    modifyRenderObject(note, attempt) {
        const ad = attempt.settings.ApproachDistance.value;
        note.opacity -= Math.min(1, (ad + note.origin.z) / (ad / 2));
    }
}

export class StrobeModifier extends Modifier {
    get name() {
        return 'Strobe';
    }
    get color() {
        return '#ffe854';
    }
    get rankable() {
        return true;
    }
    get scoreMultiplier() {
        return 1.035;
    }
    modifyRenderObject(note, attempt) {
        const at = attempt.settings.ApproachTime.value;
        if (((attempt.progress / 1000 / attempt.speed) % at) >= at / 2) note.opacity = 0;
    }
}

export class ChaosModifier extends Modifier {
    constructor() {
        super();
        // Godot FastNoiseLite defaults
        this.noise = new FastNoiseLite(0);
        this.noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2S);
        this.noise.SetFrequency(0.01);
        this.noise.SetFractalType(FastNoiseLite.FractalType.FBm);
        this.noise.SetFractalOctaves(5);
        this.noise.SetFractalLacunarity(2);
        this.noise.SetFractalGain(0.5);
        this.noise.SetFractalWeightedStrength(0);
    }
    get name() {
        return 'Chaos';
    }
    get color() {
        return '#ff6198';
    }
    get rankable() {
        return true;
    }
    get scoreMultiplier() {
        return 1.015;
    }
    modifyRenderObject(note, attempt) {
        const depth = Math.max(0, -note.origin.z);
        if (depth > 0) {
            const n = this.noise.GetNoise(note.x * 2, note.y * 2, note.index + attempt.progress / attempt.speed / 400);
            const dir = upRotated(n * Math.PI * 4);
            const offset = (depth / attempt.settings.ApproachDistance.value) ** 2;
            note.origin.x += dir.x * offset;
            note.origin.y += dir.y * offset;
        }
    }
}

export class EarthquakeModifier extends Modifier {
    get name() {
        return 'Earthquake';
    }
    get color() {
        return '#ff4400';
    }
    get rankable() {
        return true;
    }
    get scoreMultiplier() {
        return 1.01;
    }
    modifyRenderObject(note, attempt) {
        const depth = Math.max(0, -note.origin.z);
        if (depth > 0) {
            // random.Next(-180, 180)
            const rad = (Math.floor(Math.random() * 360) - 180) * (Math.PI / 180);
            const dir = upRotated(rad);
            const offset = (depth / attempt.settings.ApproachDistance.value) ** 1.5 / 2;
            note.origin.x += dir.x * offset;
            note.origin.y += dir.y * offset;
        }
    }
}

export class VortexModifier extends Modifier {
    get name() {
        return 'Vortex';
    }
    get color() {
        return '#9661ff';
    }
    get rankable() {
        return true;
    }
    get scoreMultiplier() {
        return 1.02;
    }
    modifyRenderObject(note, attempt) {
        let depth = Math.max(0, -note.origin.z);
        if (depth > 0) {
            depth /= attempt.settings.ApproachDistance.value;

            let rotation = (depth * 15) ** 1.5 / 60;
            const sine = Math.sin((attempt.progress / attempt.speed / 1000) * attempt.settings.ApproachTime.value);
            rotation *= Math.sign(sine) * Math.abs(sine) ** 0.75;

            // Transform3D.Rotated(Vector3.Back, rotation): rotates basis and origin about z
            const c = Math.cos(rotation);
            const s = Math.sin(rotation);
            const ox = note.origin.x;
            const oy = note.origin.y;
            note.origin.x = ox * c - oy * s;
            note.origin.y = ox * s + oy * c;
            note.rotZ += rotation;

            const offX = note.origin.x;
            const offY = note.origin.y;
            const pull = (depth * 0.85) ** 3 * Math.hypot(offX, offY);
            note.origin.x -= offX * pull;
            note.origin.y -= offY * pull;
        }
    }
}

export class HorizontalFlipModifier extends Modifier {
    get name() {
        return 'HFlip';
    }
    get color() {
        return '#ffffff';
    }
    get rankable() {
        return true;
    }
    modifyMap(map) {
        for (const note of map.notes) note.x = -note.x;
    }
}

export class VerticalFlipModifier extends Modifier {
    get name() {
        return 'VFlip';
    }
    get color() {
        return '#ffffff';
    }
    get rankable() {
        return true;
    }
    modifyMap(map) {
        for (const note of map.notes) note.y = -note.y;
    }
}

const CLASSES = {
    NoFail: NoFailModifier,
    Autoplay: AutoplayModifier,
    Ghost: GhostModifier,
    Strobe: StrobeModifier,
    Chaos: ChaosModifier,
    Vortex: VortexModifier,
    Earthquake: EarthquakeModifier,
    HFlip: HorizontalFlipModifier,
    VFlip: VerticalFlipModifier,
};

// Rhythia.RegisterModifiers order
export const MODIFIER_NAMES = ['NoFail', 'Autoplay', 'Ghost', 'Strobe', 'Chaos', 'Vortex', 'Earthquake', 'HFlip', 'VFlip'];

export const createModifier = (name) => new CLASSES[name]();
