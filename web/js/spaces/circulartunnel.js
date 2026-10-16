// Port of scripts/spaces/CircularTunnel.cs + prefabs/spaces/circulartunnel.tscn
// Glowing ring quads flying toward the camera at approach-rate speed, black depth fog.

import * as THREE from 'three';
import { RES, STARTED } from '../constants.js';
import { BaseSpace, godotUnshaded, linearVec4, loadTexture, quadMesh } from './base.js';

const RING_LOOP_END = 52.5;

// fog_light_color (0, 0, 0) * fog_light_energy
const FOG = { color: [0, 0, 0], density: 1, begin: 5, end: 150, curve: 0.8485127 };

// z of Rings/1..14
const RINGS = [0, -7.5000014, -15, -22.5, -30, -37.5, -45.000004, -52.5, 7.5, 15, 22.5, 30, 37.5, 45];

export class CircularTunnelSpace extends BaseSpace {
    async init() {
        this.fog = FOG;

        const tex = await loadTexture(`${RES}/textures/spaces/circulartunnel/ring.png`, { repeat: true });
        this.track(tex);

        this.ringMaterial = godotUnshaded({ map: tex, transparent: true, fog: FOG, distanceFade: [15, 40] });
        const quad = quadMesh(8, 8);

        this.rings = new THREE.Group();
        this.rings.scale.setScalar(3.5);
        for (const z of RINGS) {
            const ring = new THREE.Mesh(quad, this.ringMaterial);
            ring.position.z = z;
            this.rings.add(ring);
        }
        this.root.add(this.rings);
    }

    process(delta) {
        super.process(delta);
        const settings = this.ctx.settings;

        // Ring movement
        if (settings.SpaceEffects.value) {
            const ticks = (performance.now() - STARTED) / 1000;
            this.rings.position.z = ((ticks * settings.ApproachRate.value) / 2) % RING_LOOP_END;
        }

        // Hit FX
        linearVec4(this.noteHitColor, this.ringMaterial.uniforms.albedo.value);
    }
}
