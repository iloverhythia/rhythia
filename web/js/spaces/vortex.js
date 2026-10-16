// Port of scripts/spaces/Vortex.cs + prefabs/spaces/vortex.tscn
// Six huge translucent squircles receding into black depth fog, slowly rotating; each one takes the colour of a
// recent note hit (the newest hit on the nearest squircle).

import * as THREE from 'three';
import { RES, STARTED } from '../constants.js';
import { colorLerp } from '../util.js';
import { BaseSpace, godotTransform, godotUnshaded, linearVec4, loadTexture, quadMesh } from './base.js';

// fog_light_color (0, 0, 0)
const FOG = { color: [0, 0, 0], density: 1, begin: 0, end: 950, curve: 0.5176324 };

// Squircles/1..6: [transform, GeometryInstance3D.transparency]
const SQUIRCLES = [
    [[600, 0, 0, 0, 600, 0, 0, 0, 1, 0, 0, -180], 0.94],
    [[492.40387, -86.82409, 0, 86.82409, 492.40387, 0, 0, 0, 1, 0, 0, -260], 0.95],
    [[375.877, -136.80804, 0, 136.80804, 375.877, 0, 0, 0, 1, 0, 0, -340], 0.96],
    [[259.80762, -150, 0, 150, 259.80762, 0, 0, 0, 1, 0, 0, -420], 0.97],
    [[153.2089, -128.55751, 0, 128.55751, 153.2089, 0, 0, 0, 1, 0, 0, -500], 0.98],
    [[80.34846, -95.755554, 0, 95.755554, 80.34846, 0, 0, 0, 1, 0, 0, -580], 0.99],
];

const WHITE = { r: 1, g: 1, b: 1, a: 1 };
const sameColor = (a, b) => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

export class VortexSpace extends BaseSpace {
    async init() {
        this.clearColor = new THREE.Color(0, 0, 0);
        this.fog = FOG;

        const tex = await loadTexture(`${RES}/textures/squircle_blank.png`, { repeat: true });
        this.track(tex);
        const quad = quadMesh(1, 1);

        this.squircles = new THREE.Group();
        this.materials = [];
        this.colors = [];
        this.lastHitColors = [];

        // Start as if previous notes had been hit
        const noteColors = [...this.ctx.skin.noteColors].reverse();

        SQUIRCLES.forEach(([t, transparency], i) => {
            // each squircle gets its own duplicated material (cull disabled, alpha blended)
            const material = godotUnshaded({ map: tex, transparent: true, side: THREE.DoubleSide, fog: FOG, opacity: 1 - transparency });
            const squircle = new THREE.Mesh(quad, material);
            godotTransform(squircle, t);
            this.squircles.add(squircle);
            this.materials.push(material);
            this.colors.push({ ...WHITE });
            this.lastHitColors.push({ ...noteColors[i % noteColors.length] });
        });
        this.root.add(this.squircles);
    }

    process(delta) {
        super.process(delta);
        const settings = this.ctx.settings;

        // Godot polls Runner.Attempt.LastHitColour; there is no attempt outside of gameplay
        const attempt = this.ctx.game?.();
        if (attempt?.lastHitColour && !sameColor(attempt.lastHitColour, this.lastHitColors[0])) {
            for (let i = this.lastHitColors.length - 1; i > 0; i--) this.lastHitColors[i] = this.lastHitColors[i - 1];
            this.lastHitColors[0] = { ...attempt.lastHitColour };
        }

        // Rotation: Vector3.Forward * (Time.GetTicksMsec() / 8000f)
        if (settings.SpaceEffects.value) {
            this.squircles.rotation.z = -(performance.now() - STARTED) / 8000;
        }

        // Hit FX
        for (let i = 0; i < this.materials.length; i++) {
            let color = WHITE;
            if (settings.SpaceHitEffects.value) color = colorLerp(this.colors[i], this.lastHitColors[i], Math.min(1, delta * 6));
            this.colors[i] = { ...color };
            linearVec4(color, this.materials[i].uniforms.albedo.value);
        }
    }
}
