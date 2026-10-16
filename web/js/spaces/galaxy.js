// Port of scripts/spaces/Galaxy.cs + prefabs/spaces/galaxy.tscn
// PanoramaSkyMaterial background (slowly rotating, darkened by fog_sky_affect) and a scrolling rainbow road.
// The hidden "Planet" node (visible = false in the scene, its script code commented out) is not ported.

import * as THREE from 'three';
import { RES } from '../constants.js';
import { BaseSpace, godotTransform, godotUnshaded, loadTexture, planeMesh } from './base.js';
import { SKY_VERTEX, skyUniforms, updateSkyUniforms } from './waves.js';

// Environment fog: depth fog to black (fog_light_color * fog_light_energy). Height fog (fog_height_density) and
// fog_sky_affect are recorded for completeness; the sky part is applied in the panorama pass below.
const FOG = { color: [0, 0, 0], density: 1, begin: 25, end: 141.2, curve: 0.535885, height: 0, heightDensity: -0.3299, skyAffect: 0.25 };

export class GalaxySpace extends BaseSpace {
    async init() {
        this.fog = FOG;
        this.skyRotation = new THREE.Euler(0, 0, 0, 'YXZ');

        const [panorama, rainbow] = await Promise.all([
            loadTexture(`${RES}/textures/spaces/galaxy/galaxy_skybox.png`),
            loadTexture(`${RES}/textures/spaces/galaxy/galaxy_rainbow.png`, { repeat: true }),
        ]);
        this.track(panorama, rainbow);

        this.sky = new THREE.ShaderMaterial({
            uniforms: {
                ...skyUniforms(),
                panorama: { value: panorama },
                fogColor: { value: new THREE.Color(...FOG.color) },
                fogSkyAffect: { value: FOG.skyAffect },
            },
            vertexShader: SKY_VERTEX,
            fragmentShader: /* glsl */ `
                #define PI 3.14159265359
                uniform sampler2D panorama;
                uniform vec3 fogColor;
                uniform float fogSkyAffect;
                varying vec3 vEyeDir;
                void main() {
                    vec3 n = normalize(vEyeDir);
                    // Godot SKY_COORDS
                    vec2 coords = vec2(atan(n.x, -n.z), acos(clamp(n.y, -1.0, 1.0)));
                    if (coords.x < 0.0) coords.x += PI * 2.0;
                    coords /= vec2(PI * 2.0, PI);
                    // continuous derivatives across the u wrap so mip selection has no seam
                    vec2 alt = vec2(fract(coords.x + 0.5), coords.y);
                    vec2 dx = dFdx(coords);
                    vec2 dy = dFdy(coords);
                    vec2 adx = dFdx(alt);
                    vec2 ady = dFdy(alt);
                    if (abs(adx.x) < abs(dx.x)) dx.x = adx.x;
                    if (abs(ady.x) < abs(dy.x)) dy.x = ady.x;
                    vec3 color = textureGrad(panorama, vec2(coords.x, 1.0 - coords.y), vec2(dx.x, -dx.y), vec2(dy.x, -dy.y)).rgb;
                    // fog applied to the sky (fog_sky_affect)
                    color = mix(color, fogColor, fogSkyAffect);
                    gl_FragColor = vec4(color, 1.0);
                }`,
            depthTest: false,
            depthWrite: false,
        });

        // Road: transparent unshaded rainbow tiles, disable_fog
        this.tileMaterial = godotUnshaded({ map: rainbow, transparent: true });
        const road = new THREE.Mesh(planeMesh(120, 120), this.tileMaterial);
        godotTransform(road, [-0.14999996, 0, -4.9880896e-7, 0, 0.882, 0, 2.2649365e-8, 0, -3.3034623, 0, -6.8719172, -107.57056]);
        this.root.add(road);
    }

    background(backend, camera) {
        updateSkyUniforms(this.sky.uniforms, camera);
        // Godot looks the sky up with inverse(Basis.from_euler(sky_rotation)) (YXZ order)
        this.sky.uniforms.skyRotation.value.makeRotationFromEuler(this.skyRotation).invert();
        backend.fullscreen(this.sky);
    }

    process(delta) {
        super.process(delta);

        // sky rotation: (Vector3.Down + Vector3.Right) * delta / 100
        this.skyRotation.x += delta / 100;
        this.skyRotation.y -= delta / 100;

        // tile movement: Uv1Offset += Vector3.Up * delta / 2
        this.tileMaterial.uniforms.uvOffset.value.y += delta / 2;
    }

    dispose() {
        this.sky.dispose();
        super.dispose();
    }
}
