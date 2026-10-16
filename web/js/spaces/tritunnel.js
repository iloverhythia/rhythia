// Port of scripts/spaces/TriTunnel.cs + prefabs/spaces/tritunnel.tscn
// A translucent white triangular tunnel mesh (meshes/tunnel.obj) sliding toward the camera, tinted by note hits.
// Custom colour background (default black). The material's stencil and proximity fade fields are inactive in Godot
// (stencil_mode and proximity_fade_enabled are not set).

import * as THREE from 'three';
import { RES } from '../constants.js';
import { BaseSpace, godotTransform, godotUnshaded, linearVec4, loadObjGeometry } from './base.js';

const TUNNEL_LOOP_END = 148;
const TUNNEL_COLOR = { r: 1, g: 1, b: 1, a: 1 };

export class TriTunnelSpace extends BaseSpace {
    async init() {
        this.clearColor = new THREE.Color(0, 0, 0);

        // material_override: alpha blended, depth_draw_mode always, unshaded, distance fade (min 65 > max 10: fades
        // out with distance); GeometryInstance3D.transparency 0.75
        this.material = godotUnshaded({ transparent: true, depthWrite: true, distanceFade: [65, 10], opacity: 0.25 });

        const geometry = (await loadObjGeometry(`${RES}/meshes/tunnel.obj`)) ?? new THREE.BufferGeometry();
        this.tunnel = new THREE.Mesh(geometry, this.material);
        godotTransform(this.tunnel, [-8.742278e-9, 0, -0.2, 0, 0.2, 0, 0.2, 0, -8.742278e-9, 0, 0, 0]);
        this.tunnelPosReset = this.tunnel.position.clone();
        this.root.add(this.tunnel);
    }

    process(delta) {
        super.process(delta);
        const settings = this.ctx.settings;

        // Tunnel movement
        if (this.tunnel.position.z < TUNNEL_LOOP_END && settings.SpaceEffects.value) {
            this.tunnel.position.z += (settings.ApproachRate.value * delta) / 6;
        } else {
            this.tunnel.position.copy(this.tunnelPosReset);
        }

        // Hit VFX
        linearVec4(settings.SpaceHitEffects.value ? this.noteHitColor : TUNNEL_COLOR, this.material.uniforms.albedo.value);
    }
}
