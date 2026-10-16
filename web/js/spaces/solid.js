// Port of scripts/spaces/Solid.cs + prefabs/spaces/solid.tscn
// Custom colour background (energy 1.2) tinted from the map cover / note hit colour; empty scene otherwise.
// (The environment's glow settings are inert in Godot: glow_enabled is never set.)

import { BaseSpace, averageColor, clearColorFrom, darkened } from './base.js';

const BACKGROUND = { r: 0.011764706, g: 0, b: 0.09019608, a: 1 };
const BACKGROUND_ENERGY = 1.2;

export class SolidSpace extends BaseSpace {
    async init() {
        this.clearColor = clearColorFrom(BACKGROUND, BACKGROUND_ENERGY);
        this.camera.fov = 50;
    }

    process(delta) {
        super.process(delta);

        if (this.playing) {
            this.updateColor(this.noteHitColor);
        } else {
            const offset = this.centerOffset();
            this.camera.position.set(offset.x / 40000, offset.y / 40000, 0);
        }
    }

    async updateMap(map, coverUrl) {
        await super.updateMap(map, coverUrl);

        let color = BACKGROUND;
        if (!this.playing && this.cover) color = averageColor(this.cover) ?? color;

        this.updateColor(color);
    }

    updateColor(color) {
        const dark = darkened(color, 0.9);
        const background = this.playing ? dark : this.cover ? dark : BACKGROUND;
        this.clearColor.copy(clearColorFrom(background, BACKGROUND_ENERGY));
    }
}
