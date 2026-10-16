// Port of scripts/spaces/Waves.cs + prefabs/spaces/waves.tscn
// sky_noise_waves.gdshader becomes a full screen background pass, water_ripple.gdshader samples it as the
// screen texture.

import * as THREE from 'three';
import { RES } from '../constants.js';
import { TIME } from '../render.js';
import { Ease, Trans, degToRad, tween } from '../util.js';
import { BaseSpace, godotTransform, loadTexture, planeMesh } from './base.js';

export const SNOISE = /* glsl */ `
vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0 / 7.0;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m *= m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

// full screen sky pass: reconstructs EYEDIR from the camera
export const SKY_VERTEX = /* glsl */ `
uniform mat4 invProjection;
uniform mat4 cameraRotation;
uniform mat4 skyRotation;
varying vec3 vEyeDir;
void main() {
    vec4 view = invProjection * vec4(position.xy, 1.0, 1.0);
    vec3 dir = (cameraRotation * vec4(normalize(view.xyz / view.w), 0.0)).xyz;
    vEyeDir = (skyRotation * vec4(dir, 0.0)).xyz;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export function skyUniforms() {
    return {
        invProjection: { value: new THREE.Matrix4() },
        cameraRotation: { value: new THREE.Matrix4() },
        skyRotation: { value: new THREE.Matrix4() },
        TIME,
    };
}

export function updateSkyUniforms(uniforms, camera, skyRotationY = 0) {
    camera.updateMatrixWorld();
    uniforms.invProjection.value.copy(camera.projectionMatrixInverse);
    uniforms.cameraRotation.value.extractRotation(camera.matrixWorld);
    // Godot rotates the sky by sky_rotation; looking up a direction means applying the inverse
    uniforms.skyRotation.value.makeRotationY(-skyRotationY);
}

export class WavesSpace extends BaseSpace {
    async init() {
        this.rawCover = true;
        this.empty = await loadTexture(`${RES}/textures/empty.png`, { srgbSpace: false });
        this.skyRotation = 0;

        this.sky = new THREE.ShaderMaterial({
            uniforms: {
                ...skyUniforms(),
                sine_color_swap: { value: false },
                opacity: { value: 1 },
                coverage: { value: 1 },
                background_color: { value: new THREE.Color(0, 0, 0) },
                image_a: { value: this.empty },
                image_b: { value: this.empty },
                image_lerp: { value: 0 },
                image_lod: { value: 5 },
            },
            vertexShader: SKY_VERTEX,
            fragmentShader: /* glsl */ `
                uniform bool sine_color_swap;
                uniform float opacity;
                uniform float coverage;
                uniform vec3 background_color;
                uniform sampler2D image_a;
                uniform sampler2D image_b;
                uniform float image_lerp;
                uniform float image_lod;
                uniform float TIME;
                varying vec3 vEyeDir;
                ${SNOISE}
                vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
                void main() {
                    vec3 EYEDIR = normalize(vEyeDir);
                    vec3 pos = EYEDIR;
                    pos.y = abs(pos.y);
                    pos.y += TIME / 70.0;

                    float noiseValue = (snoise(pos) + 1.0) / 2.0;
                    noiseValue = clamp(noiseValue, 0.0, 1.0);

                    bool primaryWaves = mod(floor(noiseValue * 96.0), 20.0) == 0.0;
                    bool secondaryWaves = mod(floor(noiseValue * 384.0), 20.0) == 0.0;
                    float t = primaryWaves ? 1.0 : secondaryWaves ? 0.2 : 0.0;
                    float sine = sin(TIME / 70.0) / 2.0 + 0.5;

                    vec2 smp = vec2(noiseValue, sine) * 0.9 + vec2(0.05);
                    vec4 imageColor = mix(textureLod(image_b, smp, image_lod), textureLod(image_a, smp, image_lod), image_lerp);
                    vec3 color = mix(vec3(1.0, 0.1, noiseValue / 4.0), imageColor.rgb * 1.5, imageColor.a);
                    color = mix(background_color, color, (t + (1.0 - pow(noiseValue, 100.0)) / 50.0) * opacity * coverage);

                    if (sine_color_swap) {
                        color = mix(color, color.bgr, sin(TIME / 10.0) / 2.0 + 0.5);
                    }

                    color = mix(vec3(0.0), color, min(1.0, 2.0 * coverage - abs(EYEDIR.y)));
                    // sky shaders output linear colour; the literal colours above are already treated as linear by Godot
                    gl_FragColor = vec4(color, 1.0);
                }`,
            depthTest: false,
            depthWrite: false,
        });

        this.water = new THREE.ShaderMaterial({
            uniforms: {
                water_color: { value: new THREE.Color(0, 0, 0) },
                fresnel_strength: { value: 0.25 },
                fresnel_color: { value: new THREE.Color().setRGB(0.1, 0.05, 0.1, THREE.SRGBColorSpace) },
                echo: { value: 0 },
                echo_color: { value: new THREE.Color().setRGB(1, 0.2, 0.25, THREE.SRGBColorSpace) },
                screen_texture: { value: null },
                resolution: { value: new THREE.Vector2(1, 1) },
                TIME,
            },
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vView;
                void main() {
                    vUv = uv;
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    vNormal = normalize(normalMatrix * normal);
                    vView = normalize(-mv.xyz);
                    gl_Position = projectionMatrix * mv;
                }`,
            fragmentShader: /* glsl */ `
                uniform vec3 water_color;
                uniform float fresnel_strength;
                uniform vec3 fresnel_color;
                uniform float echo;
                uniform vec3 echo_color;
                uniform sampler2D screen_texture;
                uniform vec2 resolution;
                uniform float TIME;
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vView;
                ${SNOISE}
                float fresnel_effect(float amount, vec3 normal, vec3 view) {
                    return pow(1.0 - clamp(dot(normalize(normal), normalize(view)), 0.0, 1.0), amount);
                }
                void main() {
                    float fresnel = fresnel_effect(14.0, vNormal, vView);
                    vec2 uv = gl_FragCoord.xy / resolution;
                    float ripple = snoise(vec3(uv * (50.0 + fresnel * 100.0), TIME)) / (500.0 - fresnel * 500.0);
                    uv.x += ripple;
                    uv.y -= ripple * 2.0;
                    vec3 color = texture2D(screen_texture, uv).rgb / 2.0;
                    color = mix(water_color, color, fresnel);
                    color = mix(color, fresnel_color, fresnel * fresnel_strength);
                    float echo_dist = distance(vUv, vec2(0.5));
                    if (echo_dist < echo * 2.0 && echo_dist > echo - 0.01) {
                        color = mix(echo_color, color, min(1.0, echo * 5.0));
                    }
                    gl_FragColor = vec4(color, 1.0);
                }`,
        });
        this.water.toneMapped = false;

        const water = new THREE.Mesh(planeMesh(4000, 4000), this.water);
        water.position.set(0, -2.01, 0);
        water.renderOrder = -1000;
        water.frustumCulled = false;
        this.root.add(water);
        this.waterMesh = water;

        godotTransform(this.camera, [1, 0, 0, 0, 0.9659259, -0.25881904, 0, 0.25881904, 0.9659259, 0, 0, 0]);
        this.camera.rotation.setFromQuaternion(this.camera.quaternion, 'YXZ');
        this.camera.fov = 70;

        if (!this.playing) {
            this.sky.uniforms.coverage.value = 0;
            this.camera.rotation.set(0, 0, 0);
            this.camera.fov = 90;
            this.tweens = [
                tween((x) => (this.camera.rotation.x = x), 0, degToRad(15), 5, { trans: Trans.QUART, ease: Ease.OUT }),
                tween((f) => (this.camera.fov = f), 90, 70, 5, { trans: Trans.QUART, ease: Ease.OUT }),
                tween((c) => (this.sky.uniforms.coverage.value = c), 0, 1, 8, { trans: Trans.LINEAR }),
            ];
        }
        this.tweens = [...(this.tweens ?? []), tween((e) => (this.water.uniforms.echo.value = e), 0, 0.5, 12, { trans: Trans.LINEAR })];
        this.track(this.empty);
    }

    background(backend, camera) {
        this.water.uniforms.screen_texture.value = backend.backgroundTarget.texture;
        this.water.uniforms.resolution.value.set(backend.backgroundTarget.width, backend.backgroundTarget.height);
        updateSkyUniforms(this.sky.uniforms, camera, this.skyRotation);
        backend.fullscreen(this.sky);
    }

    process(delta) {
        super.process(delta);
        if (!this.playing) {
            const offset = this.centerOffset();
            this.skyRotation += (delta * offset.x) / 50000;
        }
    }

    setImages(texture) {
        const u = this.sky.uniforms;
        u.image_b.value = u.image_a.value;
        u.image_a.value = texture ?? this.empty;
        u.image_lerp.value = 0;
    }

    async updateMap(map, coverUrl) {
        await super.updateMap(map, coverUrl);
        if (!this.playing) {
            this.setImages(this.cover);
            this.imageTween?.kill();
            this.imageTween = tween((a) => (this.sky.uniforms.image_lerp.value = a), 0, 1, 0.2);
        }
    }

    updateState(playing) {
        super.updateState(playing);
        if (playing && !this.ctx.settings.SpaceEffects.value) {
            const u = this.sky.uniforms;
            u.image_a.value = this.empty;
            u.image_b.value = this.empty;
            u.image_lerp.value = 0;
        } else {
            this.setImages(this.cover);
        }
    }

    dispose() {
        for (const t of this.tweens ?? []) t.kill();
        this.imageTween?.kill();
        this.sky.dispose();
        super.dispose();
    }
}
