// Port of scripts/spaces/Grid.cs + prefabs/spaces/grid.tscn

import * as THREE from 'three';
import { RES } from '../constants.js';
import { BaseSpace, godotTransform, godotUnshaded, linearVec4, loadTexture, planeMesh } from './base.js';

export class GridSpace extends BaseSpace {
    async init() {
        // Environment: clear colour background, depth fog
        this.fog = { color: [0.0470588, 0.0313726, 0.109804], density: 1.0, begin: 10, end: 60, curve: 0.15 };

        const tex = await loadTexture(`${RES}/textures/spaces/grid/grid_tile.png`, { repeat: true });
        this.material = godotUnshaded({ map: tex, uvScale: [34, 34], fog: this.fog, side: THREE.FrontSide });
        const geometry = planeMesh(120, 120);

        const bottom = new THREE.Mesh(geometry, this.material);
        godotTransform(bottom, [-1, 0, -8.74228e-8, 0, 1, 0, 8.74228e-8, 0, -1, 0, -10, 0]);
        const top = new THREE.Mesh(geometry, this.material);
        godotTransform(top, [1, 0, 0, 0, -1, 8.74228e-8, 0, -8.74228e-8, -1, 0, 10, 0]);

        this.root.add(bottom, top);
        this.track(tex);
    }

    process(delta) {
        super.process(delta);
        linearVec4(this.noteHitColor, this.material.uniforms.albedo.value);
        this.material.uniforms.albedo.value.w = 1;
        // tileMaterial.Uv1Offset += Vector3.Up * delta * 3
        this.material.uniforms.uvOffset.value.y += delta * 3;
    }
}
