// Port of scripts/spaces/Squircles.cs + prefabs/spaces/squircles.tscn
// Custom colour background (energy 1.2) tinted from the map cover, two CPUParticles3D sheets of blooming squircles.
// (The environment's glow settings are inert in Godot: glow_enabled is never set.)

import * as THREE from 'three';
import { RES } from '../constants.js';
import {
    BaseSpace,
    CpuParticles,
    averageColor,
    clearColorFrom,
    darkened,
    godotTransform,
    lightened,
    loadTexture,
    particleMaterial,
    planeMesh,
} from './base.js';

const BACKGROUND = { r: 0.011764706, g: 0, b: 0.09019608, a: 1 };
const BACKGROUND_ENERGY = 1.2;
const PARTICLE_COLOR = { r: 0.27058825, g: 0.47058824, b: 1, a: 0.4509804 };

const RAMP = [
    { offset: 0, color: [0, 0, 0, 0] },
    { offset: 0.2, color: [1, 1, 1, 1] },
    { offset: 0.8, color: [1, 1, 1, 1] },
    { offset: 1, color: [1, 1, 1, 0] },
];

// shared CPUParticles3D settings of ParticlesNear / ParticlesFar
const PARTICLES = {
    lifetime: 20,
    preprocess: 5,
    emissionShape: 'box',
    emissionBoxExtents: [1, 1, 1],
    rotateY: true,
    direction: [0, 0, 0],
    spread: 180,
    flatness: 1,
    gravity: [0, 0, 0],
    velocityMin: 0.04,
    velocityMax: 0.06,
    angularVelocityMin: -20,
    angularVelocityMax: 20,
    radialAccelMin: 0.01,
    radialAccelMax: 0.01,
    angleMin: -180,
    angleMax: 180,
    colorRamp: RAMP,
    hueVariationMin: -0.04,
    hueVariationMax: 0.04,
};

export class SquirclesSpace extends BaseSpace {
    async init() {
        this.clearColor = clearColorFrom(BACKGROUND, BACKGROUND_ENERGY);
        this.camera.fov = 50;

        const tex = await loadTexture(`${RES}/textures/squircle_bloom.png`);
        this.track(tex);
        const geometry = planeMesh(0.5, 0.5);
        this.material = particleMaterial({ map: tex, side: THREE.FrontSide });
        const color = [PARTICLE_COLOR.r, PARTICLE_COLOR.g, PARTICLE_COLOR.b, PARTICLE_COLOR.a];

        this.particlesNear = new CpuParticles({ ...PARTICLES, geometry, material: this.material, amount: 12, scaleMin: 0.6, color });
        godotTransform(this.particlesNear.mesh, [20, 0, 0, 0, -4.371139e-9, -20, 0, 0.1, -8.742278e-7, 0, 0, -15]);
        this.particlesFar = new CpuParticles({ ...PARTICLES, geometry, material: this.material, amount: 10, scaleMax: 1.4, color });
        godotTransform(this.particlesFar.mesh, [20, 0, 0, 0, -4.371139e-9, -20, 0, 0.1, -8.742278e-7, 0, 0, -30]);
        geometry.dispose();

        for (const p of [this.particlesNear, this.particlesFar]) {
            p.mesh.renderOrder = -1000; // sorting_offset = -1000
            this.root.add(p.mesh);
            this.track(p);
        }
    }

    process(delta) {
        super.process(delta);

        if (this.playing) {
            this.updateColor(this.noteHitColor);
        } else {
            const offset = this.centerOffset();
            this.camera.position.set(offset.x / 40000, offset.y / 40000, 0);
        }

        this.particlesNear.update(delta);
        this.particlesFar.update(delta);
    }

    async updateMap(map, coverUrl) {
        await super.updateMap(map, coverUrl);

        let color = PARTICLE_COLOR;
        if (!this.playing && this.cover) color = averageColor(this.cover) ?? color;

        this.updateColor(color);
    }

    updateColor(color) {
        const dark = darkened(color, 0.9);
        const background = this.playing ? dark : this.cover ? dark : BACKGROUND;
        this.clearColor.copy(clearColorFrom(background, BACKGROUND_ENERGY));
        const particle = lightened(color, 0.1);
        this.particlesNear.color = [particle.r, particle.g, particle.b, particle.a];
        this.particlesFar.color = this.particlesNear.color;
    }
}
