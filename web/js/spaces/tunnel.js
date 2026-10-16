// Port of scripts/spaces/Tunnel.cs + prefabs/spaces/tunnel.tscn
// Alternating textured rings flying toward the camera at approach-rate speed over a neon road, black depth fog.

import * as THREE from 'three';
import { RES, STARTED } from '../constants.js';
import { BaseSpace, godotTransform, godotUnshaded, linearVec4, loadTexture, planeMesh, quadMesh } from './base.js';

const RING_LOOP_END = 52.5;

// fog_light_color (0, 0, 0) * fog_light_energy
const FOG = { color: [0, 0, 0], density: 1, begin: 5, end: 150, curve: 0.8485127 };

// [mesh, z] of Rings/1..14 ("A" = QuadMesh "4" / tunnel_ring_b, "B" = QuadMesh "5" / tunnel_space_a)
const RINGS = [
    ['A', 0],
    ['B', -7.5000014],
    ['A', -15],
    ['B', -22.5],
    ['A', -30],
    ['B', -37.5],
    ['A', -45.000004],
    ['B', -52.5],
    ['B', 7.5],
    ['A', 15],
    ['B', 22.5],
    ['A', 30],
    ['B', 37.5],
    ['A', 45],
];

export class TunnelSpace extends BaseSpace {
    async init() {
        this.fog = FOG;

        const [ringTex, spaceTex, roadTex] = await Promise.all([
            loadTexture(`${RES}/textures/spaces/tunnel/tunnel_ring_b.png`, { repeat: true }),
            loadTexture(`${RES}/textures/spaces/tunnel/tunnel_space_a.png`, { repeat: true }),
            loadTexture(`${RES}/textures/spaces/tunnel/tunnel_neonroad.png`, { repeat: true }),
        ]);
        this.track(ringTex, spaceTex, roadTex);

        // distance_fade_mode pixel alpha makes both ring materials alpha blended; cull_mode disabled
        const ringOpts = { transparent: true, side: THREE.DoubleSide, fog: FOG, distanceFade: [10, 40] };
        this.ringMaterialA = godotUnshaded({ ...ringOpts, map: ringTex });
        this.ringMaterialB = godotUnshaded({ ...ringOpts, map: spaceTex });
        const quad = quadMesh(8, 8);

        this.rings = new THREE.Group();
        this.rings.scale.setScalar(3.5);
        for (const [kind, z] of RINGS) {
            const ring = new THREE.Mesh(quad, kind === 'A' ? this.ringMaterialA : this.ringMaterialB);
            ring.position.z = z;
            this.rings.add(ring);
        }
        this.root.add(this.rings);

        // Road: neon tiles fading out past 150 units (distance_fade_min 150 > max 10)
        this.tileMaterial = godotUnshaded({ map: roadTex, transparent: true, fog: FOG, distanceFade: [150, 10] });
        const road = new THREE.Mesh(planeMesh(120, 120), this.tileMaterial);
        godotTransform(road, [0.2, 0, 0, 0, 1.204, 0, 0, 0, 2.806, 0, -20, 0]);
        this.root.add(road);
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
        for (const m of [this.tileMaterial, this.ringMaterialA, this.ringMaterialB]) linearVec4(this.noteHitColor, m.uniforms.albedo.value);
    }
}
