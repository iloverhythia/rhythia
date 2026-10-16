// Port of scripts/spaces/BaseSpace.cs plus helpers shared by the space ports.
//
// A space owns `root` (a THREE.Group). In menus it is rendered with its own `camera`; in game the root is added
// to the game scene and rendered with the runner's camera (Godot's AddSpaceAsChild + Camera.Current = !Playing).
// `environment` mirrors the WorldEnvironment: { clearColor: THREE.Color (linear), fog, background(backend, camera) }

import * as THREE from 'three';
import { FOG_PARS, fogUniforms, srgb } from '../render.js';
import { colorLerp } from '../util.js';

export const DEFAULT_CLEAR = srgb(0.0885599, 0.08855992, 0.08855987);

export class BaseSpace {
    constructor(ctx) {
        this.ctx = ctx; // { settings, skin, mouse: {x, y}, viewport: {w, h}, game: () => attempt|null }
        this.root = new THREE.Group();
        this.camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 4000);
        this.camera.rotation.order = 'YXZ';
        this.playing = false;
        this.noteHitColor = { r: 1, g: 1, b: 1, a: 1 };
        this.cover = null; // THREE.Texture or null
        this.coverUrl = null;
        this.clearColor = DEFAULT_CLEAR.clone();
        this.fog = null;
        this.disposables = [];
    }

    // centre offset of the mouse like viewport.GetMousePosition() - size / 2
    centerOffset() {
        const m = this.ctx.mouse;
        return { x: m.x - window.innerWidth / 2, y: m.y - window.innerHeight / 2 };
    }

    load() {
        const colors = this.ctx.skin.noteColors;
        this.noteHitColor = { ...colors[colors.length - 1] };
    }

    process(delta) {
        if (this.playing && this.ctx.settings.SpaceHitEffects.value) {
            const attempt = this.ctx.game();
            if (attempt) this.noteHitColor = colorLerp(this.noteHitColor, attempt.lastHitColour, Math.min(1, delta * 8));
        }
    }

    onHit(combo) {}

    async updateMap(map, coverUrl) {
        this.coverUrl = coverUrl;
        // spaces that sample the cover from a hint-less sampler2D (raw sRGB values) set rawCover
        this.cover = coverUrl ? await loadTexture(coverUrl, { srgbSpace: !this.rawCover }) : null;
    }

    updateState(playing) {
        this.playing = playing;
    }

    // world description handed to RenderBackend.render
    get world() {
        return { scene: this.root, clearColor: this.clearColor, background: this.background?.bind(this) };
    }

    track(...objs) {
        this.disposables.push(...objs);
        return objs[0];
    }

    dispose() {
        this.root.traverse((o) => {
            o.geometry?.dispose?.();
            if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
            else o.material?.dispose?.();
        });
        for (const d of this.disposables) d.dispose?.();
    }
}

// ---------------------------------------------------------------- helpers
//
// UV convention: geometry built by these helpers (planeMesh, quadMesh, boxMesh) carries Godot UVs (v = 0 at the
// top of the image), and godotUnshaded samples with the v axis flipped back for three's flipY textures. This keeps
// Godot's uv1_scale / uv1_offset semantics (UV * scale + offset) 1:1, including scroll directions.

const textureLoader = new THREE.TextureLoader();

export function loadTexture(url, { repeat = false, srgbSpace = true } = {}) {
    return new Promise((resolve) => {
        textureLoader.load(
            url,
            (tex) => {
                if (srgbSpace) tex.colorSpace = THREE.SRGBColorSpace;
                tex.generateMipmaps = true;
                tex.minFilter = THREE.LinearMipmapLinearFilter;
                tex.magFilter = THREE.LinearFilter;
                tex.anisotropy = 8;
                if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
                resolve(tex);
            },
            undefined,
            () => resolve(null),
        );
    });
}

// StandardMaterial3D, shading_mode unshaded, with optional depth fog + vertex colours + transparency.
//   opacity      GeometryInstance3D.transparency as (1 - transparency)
//   distanceFade [min, max] for distance_fade_mode = pixel alpha (alpha *= smoothstep(min, max, distance))
//   billboard    true: keep-scale billboard of the whole mesh; 'particles': BILLBOARD_PARTICLES for instanced
//                particles (view aligned, keeps each instance's Z rotation and scale)
export function godotUnshaded({
    map = null,
    color = [1, 1, 1, 1],
    transparent = false,
    vertexColors = false,
    fog = null,
    uvScale = [1, 1],
    side = THREE.FrontSide,
    depthWrite = null,
    blending = THREE.NormalBlending,
    billboard = false,
    opacity = 1,
    distanceFade = null,
} = {}) {
    const uniforms = {
        map: { value: map },
        hasMap: { value: !!map },
        albedo: { value: new THREE.Vector4(...color) },
        opacity: { value: opacity },
        uvScale: { value: new THREE.Vector2(...uvScale) },
        uvOffset: { value: new THREE.Vector2(0, 0) },
        distanceFade: { value: new THREE.Vector2(...(distanceFade ?? [0, 10])) },
        hasDistanceFade: { value: !!distanceFade },
        ...fogUniforms(fog),
    };
    let billboardCode = '';
    if (billboard === 'particles') {
        billboardCode = /* glsl */ `
                #ifdef USE_INSTANCING
                vec3 modelScale = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
                mv = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0) + vec4(mat3(instanceMatrix) * position * modelScale, 0.0);
                #endif`;
    } else if (billboard) {
        billboardCode =
            'mv = viewMatrix * vec4((modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, 1.0) + vec4(position.xy * vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz)), 0.0, 0.0);';
    }
    const mat = new THREE.ShaderMaterial({
        uniforms,
        vertexColors,
        transparent,
        side,
        blending,
        depthWrite: depthWrite ?? !transparent,
        vertexShader: /* glsl */ `
            uniform vec2 uvScale;
            uniform vec2 uvOffset;
            varying vec2 vUv;
            varying vec3 vViewPos;
            // three r160 defines USE_COLOR in the fragment shader (only) for instanceColor too, so instance colours
            // travel through vColor
            #ifdef USE_COLOR_ALPHA
            varying vec4 vColor;
            #elif defined(USE_COLOR) || defined(USE_INSTANCING_COLOR)
            varying vec3 vColor;
            #endif
            void main() {
                vUv = uv * uvScale + uvOffset;
                #if defined(USE_COLOR_ALPHA)
                vColor = color;
                #elif defined(USE_COLOR) || defined(USE_INSTANCING_COLOR)
                vColor = vec3(1.0);
                #ifdef USE_COLOR
                vColor *= color;
                #endif
                #endif
                #ifdef USE_INSTANCING_COLOR
                vColor.rgb *= instanceColor;
                #endif
                vec4 p = vec4(position, 1.0);
                #ifdef USE_INSTANCING
                p = instanceMatrix * p;
                #endif
                vec4 mv = modelViewMatrix * p;
                ${billboardCode}
                vViewPos = mv.xyz;
                gl_Position = projectionMatrix * mv;
            }`,
        fragmentShader: /* glsl */ `
            uniform sampler2D map;
            uniform bool hasMap;
            uniform vec4 albedo;
            uniform float opacity;
            uniform vec2 distanceFade;
            uniform bool hasDistanceFade;
            varying vec2 vUv;
            varying vec3 vViewPos;
            #ifdef USE_COLOR_ALPHA
            varying vec4 vColor;
            #elif defined(USE_COLOR)
            varying vec3 vColor;
            #endif
            ${FOG_PARS}
            void main() {
                // per pixel like Godot's length(VERTEX): interpolating a per-vertex distance is wrong on big quads
                float vDist = length(vViewPos);
                vec4 c = albedo;
                // Godot UVs (v down) on flipY textures
                if (hasMap) c *= texture2D(map, vec2(vUv.x, 1.0 - vUv.y));
                #ifdef USE_COLOR_ALPHA
                c *= vColor;
                #elif defined(USE_COLOR)
                c.rgb *= vColor;
                #endif
                if (hasDistanceFade) {
                    // smoothstep written out: Godot allows min > max (fade out with distance)
                    float t = clamp((vDist - distanceFade.x) / (distanceFade.y - distanceFade.x), 0.0, 1.0);
                    c.a *= t * t * (3.0 - 2.0 * t);
                }
                c.a *= opacity;
                c.rgb = applyFog(c.rgb, vDist);
                gl_FragColor = c;
            }`,
    });
    mat.toneMapped = false;
    return mat;
}

// sRGB {r,g,b,a} -> linear vec4 for shader uniforms
export function linearVec4(c, out = new THREE.Vector4()) {
    const col = new THREE.Color().setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);
    return out.set(col.r, col.g, col.b, c.a ?? 1);
}

export function godotTransform(obj, m) {
    const mat = new THREE.Matrix4();
    mat.set(m[0], m[1], m[2], m[9], m[3], m[4], m[5], m[10], m[6], m[7], m[8], m[11], 0, 0, 0, 1);
    mat.decompose(obj.position, obj.quaternion, obj.scale);
}

// Godot PlaneMesh: lies in XZ, facing +Y, Godot UVs (u along +x, v along +z)
export function planeMesh(width, depth, subdivide = 1) {
    const g = new THREE.PlaneGeometry(width, depth, subdivide, subdivide);
    g.rotateX(-Math.PI / 2);
    // after the rotation three's v grows toward -z; Godot's grows toward +z
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    return g;
}

// Godot QuadMesh (PlaneMesh facing +Z): XY plane, Godot UVs (v = 0 at the top edge)
export function quadMesh(width = 1, height = 1) {
    const g = new THREE.PlaneGeometry(width, height);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    return g;
}

// Godot BoxMesh (no subdivision) with its 3x2 UV atlas: front [0,1/3]x[0,1/2], right [1/3,2/3]x[0,1/2],
// back [2/3,1]x[0,1/2], left [0,1/3]x[1/2,1], top [1/3,2/3]x[1/2,1], bottom [2/3,1]x[1/2,1]
export function boxMesh(sx = 1, sy = 1, sz = 1) {
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const pos = [];
    const nrm = [];
    const uvs = [];
    const idx = [];
    // corners listed top-left, top-right, bottom-left, bottom-right as seen from outside the face
    const face = (corners, normal, u0, v0) => {
        const base = pos.length / 3;
        const fuv = [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
        ];
        corners.forEach((c, i) => {
            pos.push(...c);
            nrm.push(...normal);
            uvs.push(u0 + fuv[i][0] / 3, v0 + fuv[i][1] / 2);
        });
        idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    };
    face([[-hx, hy, hz], [hx, hy, hz], [-hx, -hy, hz], [hx, -hy, hz]], [0, 0, 1], 0, 0); // front
    face([[hx, hy, hz], [hx, hy, -hz], [hx, -hy, hz], [hx, -hy, -hz]], [1, 0, 0], 1 / 3, 0); // right
    face([[hx, hy, -hz], [-hx, hy, -hz], [hx, -hy, -hz], [-hx, -hy, -hz]], [0, 0, -1], 2 / 3, 0); // back
    face([[-hx, hy, -hz], [-hx, hy, hz], [-hx, -hy, -hz], [-hx, -hy, hz]], [-1, 0, 0], 0, 0.5); // left
    face([[hx, hy, hz], [-hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]], [0, 1, 0], 1 / 3, 0.5); // top
    face([[-hx, -hy, hz], [hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz]], [0, -1, 0], 2 / 3, 0.5); // bottom
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    return g;
}

// Godot Gradient (linear interpolation, sRGB values) sampled at an offset
export function sampleGradient(offsets, colors, t) {
    if (t <= offsets[0]) return [...colors[0]];
    for (let i = 1; i < offsets.length; i++) {
        if (t <= offsets[i]) {
            const k = (t - offsets[i - 1]) / Math.max(1e-6, offsets[i] - offsets[i - 1]);
            return colors[i - 1].map((v, j) => v + (colors[i][j] - v) * k);
        }
    }
    return [...colors[colors.length - 1]];
}

// GradientTexture2D (fill linear, repeat none): sRGB RGBA8 texture laid out for Godot UVs
export function gradientTexture2D({ offsets = [0, 1], colors, width = 64, height = 64, from = [0, 0], to = [1, 0] }) {
    const data = new Uint8Array(width * height * 4);
    const seg = [to[0] - from[0], to[1] - from[1]];
    const segLen2 = seg[0] * seg[0] + seg[1] * seg[1];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const px = width > 1 ? x / (width - 1) : 0;
            const py = height > 1 ? y / (height - 1) : 0;
            // closest point on the uncapped segment, signed distance along it
            let ofs = segLen2 === 0 ? 0 : ((px - from[0]) * seg[0] + (py - from[1]) * seg[1]) / segLen2;
            ofs = Math.min(1, Math.max(0, ofs));
            const c = sampleGradient(offsets, colors, ofs);
            // Godot row y (v down) is stored flipped so the v-flipped lookup in godotUnshaded finds it
            const o = ((height - 1 - y) * width + x) * 4;
            for (let k = 0; k < 4; k++) data[o + k] = Math.round(Math.min(1, Math.max(0, c[k])) * 255);
        }
    }
    const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
}

// Average sRGB colour of a texture's opaque-ish pixels (alpha != 0), like the Godot GetPixel loops over covers
export function averageColor(texture) {
    const img = texture?.image;
    if (!img || !img.width || !img.height) return null;
    try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const g = canvas.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const data = g.getImageData(0, 0, img.width, img.height).data;
        let r = 0;
        let gr = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] === 0) continue;
            r += data[i];
            gr += data[i + 1];
            b += data[i + 2];
            n++;
        }
        if (n === 0) return null;
        return { r: r / n / 255, g: gr / n / 255, b: b / n / 255, a: 1 };
    } catch {
        return null;
    }
}

// Godot Color.Darkened / Color.Lightened on sRGB {r,g,b,a}
export const darkened = (c, amount) => ({ r: c.r * (1 - amount), g: c.g * (1 - amount), b: c.b * (1 - amount), a: c.a ?? 1 });
export const lightened = (c, amount) => ({
    r: c.r + (1 - c.r) * amount,
    g: c.g + (1 - c.g) * amount,
    b: c.b + (1 - c.b) * amount,
    a: c.a ?? 1,
});

// background_color * background_energy_multiplier as the linear clear colour
export function clearColorFrom(c, energy = 1) {
    return new THREE.Color().setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace).multiplyScalar(energy);
}

// Wavefront OBJ (Godot's wavefront_obj importer) as one non-indexed geometry with positions, normals and uvs
let objLoaderPromise = null;
export async function loadObjGeometry(url) {
    objLoaderPromise ??= import('../../vendor/OBJLoader.js');
    const [{ OBJLoader }, text] = await Promise.all([
        objLoaderPromise,
        fetch(url)
            .then((r) => (r.ok ? r.text() : null))
            .catch(() => null),
    ]);
    if (text == null) return null;
    const geometries = [];
    new OBJLoader().parse(text).traverse((o) => {
        if (o.isMesh) geometries.push(o.geometry);
    });
    if (geometries.length === 0) return null;
    if (geometries.length === 1) return geometries[0];
    const merged = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
        if (!geometries.every((g) => g.attributes[name])) continue;
        const size = geometries[0].attributes[name].itemSize;
        const total = geometries.reduce((n, g) => n + g.attributes[name].array.length, 0);
        const arr = new Float32Array(total);
        let off = 0;
        for (const g of geometries) {
            arr.set(g.attributes[name].array, off);
            off += g.attributes[name].array.length;
        }
        merged.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    geometries.forEach((g) => g.dispose());
    return merged;
}

const rand = (min, max) => min + Math.random() * (max - min);
const lerpN = (a, b, t) => a + (b - a) * t;

// Godot's hue_variation rotation matrix (rows), applied with Basis.xform_inv
function hueMatrix(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const m1 = [0.299, 0.587, 0.114, 0.299, 0.587, 0.114, 0.299, 0.587, 0.114];
    const m2 = [0.701, -0.587, -0.114, -0.299, 0.413, -0.114, -0.3, -0.588, 0.886];
    const m3 = [0.168, 0.33, -0.497, -0.328, 0.035, 0.292, 1.25, -1.05, -0.203];
    return m1.map((v, i) => v + m2[i] * c + m3[i] * s);
}

// CPUParticles3D / GPUParticles3D + ParticleProcessMaterial emulation (process logic follows Godot's
// cpu_particles_3d.cpp): box/sphere/sphere_surface emission (with emission_shape_scale), Godot spread/flatness
// direction, linear velocity, gravity, radial accel, damping, angle + angular velocity, scale range, colour ramp,
// hue variation, lifetime randomness, emission staggering (explosiveness/randomness) and preprocess.
// Particles live in the emitter's local space (emitters here never move, so local_coords is irrelevant).
// Rendered as one InstancedMesh: instance matrix = translation * rotation (Y with rotateY, else Z) * scale,
// instanceColor = linear colour, `instanceAlpha` geometry attribute = alpha (see particleMaterial).
export class CpuParticles {
    constructor({
        geometry,
        material,
        amount = 8,
        lifetime = 1,
        preprocess = 0,
        localCoords = true,
        emissionShape = 'point',
        emissionBoxExtents = [1, 1, 1],
        emissionSphereRadius = 1,
        emissionShapeScale = [1, 1, 1],
        direction = [1, 0, 0],
        spread = 45,
        flatness = 0,
        gravity = [0, -9.8, 0],
        velocityMin = 0,
        velocityMax = 0,
        radialAccelMin = 0,
        radialAccelMax = 0,
        dampingMin = 0,
        dampingMax = 0,
        angleMin = 0,
        angleMax = 0,
        angularVelocityMin = 0,
        angularVelocityMax = 0,
        scaleMin = 1,
        scaleMax = 1,
        color = [1, 1, 1, 1],
        colorRamp = null, // [{offset, color:[r,g,b,a]}] in sRGB
        hueVariationMin = 0,
        hueVariationMax = 0,
        rotateY = false,
        alignY = false,
        explosiveness = 0,
        randomness = 0,
        lifetimeRandomness = 0,
    }) {
        const dir = new THREE.Vector3(...direction);
        this.opts = {
            amount,
            lifetime,
            localCoords,
            emissionShape,
            emissionBoxExtents,
            emissionSphereRadius,
            emissionShapeScale,
            direction: dir.lengthSq() > 0 ? dir.normalize() : new THREE.Vector3(0, 0, 1),
            spread,
            flatness,
            gravity: new THREE.Vector3(...gravity),
            velocityMin,
            velocityMax,
            radialAccelMin,
            radialAccelMax,
            dampingMin,
            dampingMax,
            angleMin,
            angleMax,
            angularVelocityMin,
            angularVelocityMax,
            scaleMin,
            scaleMax,
            hueVariationMin,
            hueVariationMax,
            rotateY,
            alignY,
            explosiveness,
            lifetimeRandomness,
        };
        this.color = [...color];
        this.colorRamp = colorRamp;
        // own copy: the per-instance alpha attribute lives on the geometry
        geometry = geometry.clone();
        this.mesh = new THREE.InstancedMesh(geometry, material, amount);
        this.mesh.frustumCulled = false;
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(amount * 3), 3);
        this.alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(amount).fill(1), 1);
        geometry.setAttribute('instanceAlpha', this.alphaAttr);
        this.particles = [];
        this.time = 0;
        for (let i = 0; i < amount; i++) {
            // stagger spawn like Godot's emission over one lifetime
            let phase = i / amount;
            if (randomness > 0) phase += (randomness * Math.random()) / amount;
            phase *= 1 - explosiveness;
            this.particles.push({ age: -phase * lifetime, alive: false });
        }
        this.emitting = true;
        this.speedScale = 1;
        this.tmp = new THREE.Matrix4();
        this.q = new THREE.Quaternion();
        this.v = new THREE.Vector3();
        this.s = new THREE.Vector3();
        this.axisY = new THREE.Vector3(0, 1, 0);
        this.axisZ = new THREE.Vector3(0, 0, 1);
        if (preprocess > 0) {
            const step = 1 / 30;
            for (let t = 0; t < preprocess; t += step) this.update(step, false);
        }
        this.write();
    }

    spawn(p) {
        const o = this.opts;
        let pos;
        if (o.emissionShape === 'box') {
            const e = o.emissionBoxExtents;
            pos = new THREE.Vector3(rand(-1, 1) * e[0], rand(-1, 1) * e[1], rand(-1, 1) * e[2]);
        } else if (o.emissionShape === 'sphere') {
            const s = rand(-1, 1);
            const t = Math.random() * Math.PI * 2;
            const r = o.emissionSphereRadius * Math.sqrt(1 - s * s);
            pos = new THREE.Vector3(r * Math.cos(t), r * Math.sin(t), o.emissionSphereRadius * s).multiplyScalar(Math.random());
        } else if (o.emissionShape === 'sphere_surface') {
            const s = rand(-1, 1);
            const t = Math.random() * Math.PI * 2;
            const r = o.emissionSphereRadius * Math.sqrt(1 - s * s);
            pos = new THREE.Vector3(r * Math.cos(t), r * Math.sin(t), o.emissionSphereRadius * s);
        } else {
            pos = new THREE.Vector3();
        }
        pos.multiply(this.v.set(...o.emissionShapeScale));

        // Godot spread: angle1 around Y in the XZ plane, angle2 lifted by (1 - flatness), rotated onto direction
        const a1 = THREE.MathUtils.degToRad(rand(-1, 1) * o.spread);
        const a2 = THREE.MathUtils.degToRad(rand(-1, 1) * (1 - o.flatness) * o.spread);
        const yzY = Math.sin(a2);
        let yzZ = Math.cos(a2);
        yzZ /= Math.max(0.0001, Math.sqrt(Math.abs(yzZ)));
        const sx = Math.sin(a1) * yzZ;
        const sy = yzY;
        const sz = Math.cos(a1) * yzZ;
        const d = o.direction;
        const binormal = new THREE.Vector3(0, 1, 0).cross(d);
        if (binormal.lengthSq() < 1e-8) binormal.set(0, 0, 1);
        binormal.normalize();
        const normal = new THREE.Vector3().crossVectors(binormal, d);
        const dir = binormal.multiplyScalar(sx).addScaledVector(normal, sy).addScaledVector(d, sz);

        p.alive = true;
        p.age = 0;
        p.lifetime = o.lifetime * (1 - Math.random() * o.lifetimeRandomness);
        p.pos = pos;
        p.vel = dir.multiplyScalar(rand(o.velocityMin, o.velocityMax));
        p.radialAccel = rand(o.radialAccelMin, o.radialAccelMax);
        p.damping = rand(o.dampingMin, o.dampingMax);
        p.angVel = rand(o.angularVelocityMin, o.angularVelocityMax);
        p.angle = rand(o.angleMin, o.angleMax);
        p.scale = rand(o.scaleMin, o.scaleMax);
        p.hue = o.hueVariationMin || o.hueVariationMax ? hueMatrix(rand(o.hueVariationMin, o.hueVariationMax) * Math.PI * 2) : null;
    }

    rampColor(t) {
        const r = this.colorRamp;
        if (!r) return [1, 1, 1, 1];
        return sampleGradient(
            r.map((s) => s.offset),
            r.map((s) => s.color),
            t,
        );
    }

    update(delta, write = true) {
        delta *= this.speedScale;
        this.time += delta;
        for (const p of this.particles) {
            p.age += delta;
            if (!p.alive) {
                if (p.age >= 0 && this.emitting) {
                    const over = p.age;
                    this.spawn(p);
                    p.age = over;
                } else continue;
            }
            if (p.age >= p.lifetime) {
                if (this.emitting) {
                    const over = p.age - p.lifetime;
                    this.spawn(p);
                    p.age = over;
                } else {
                    p.alive = false;
                    continue;
                }
            }
            const force = this.v.copy(this.opts.gravity);
            if (p.radialAccel !== 0 && p.pos.lengthSq() > 0) force.addScaledVector(this.s.copy(p.pos).normalize(), p.radialAccel);
            p.vel.addScaledVector(force, delta);
            if (p.damping > 0) {
                const speed = p.vel.length();
                const v = speed - p.damping * delta;
                if (v < 0) p.vel.set(0, 0, 0);
                else if (speed > 0) p.vel.multiplyScalar(v / speed);
            }
            p.pos.addScaledVector(p.vel, delta);
        }
        if (write) this.write();
    }

    write() {
        const color = new THREE.Color();
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            if (!p.alive) {
                this.tmp.makeScale(0, 0, 0);
                this.mesh.setMatrixAt(i, this.tmp);
                this.alphaAttr.array[i] = 0;
                continue;
            }
            const t = Math.min(1, p.age / p.lifetime);
            const ramp = this.rampColor(t);
            const angle = THREE.MathUtils.degToRad(p.angle + p.age * p.angVel);
            this.q.setFromAxisAngle(this.opts.rotateY ? this.axisY : this.axisZ, angle);
            const scale = p.scale === 0 ? 1e-6 : p.scale;
            this.tmp.compose(p.pos, this.q, this.s.set(scale, scale, scale));
            this.mesh.setMatrixAt(i, this.tmp);
            let r = this.color[0] * ramp[0];
            let g = this.color[1] * ramp[1];
            let b = this.color[2] * ramp[2];
            if (p.hue) {
                const m = p.hue;
                [r, g, b] = [m[0] * r + m[3] * g + m[6] * b, m[1] * r + m[4] * g + m[7] * b, m[2] * r + m[5] * g + m[8] * b];
            }
            color.setRGB(r, g, b, THREE.SRGBColorSpace);
            this.mesh.setColorAt(i, color);
            this.alphaAttr.array[i] = this.color[3] * ramp[3];
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
        this.alphaAttr.needsUpdate = true;
    }

    dispose() {
        this.mesh.geometry.dispose();
        this.mesh.dispose();
    }
}

// material for CpuParticles: unshaded, texture * instance colour * instance alpha, optional fog
export function particleMaterial({
    map = null,
    fog = null,
    blending = THREE.NormalBlending,
    billboard = false,
    side = THREE.DoubleSide,
    color = [1, 1, 1, 1],
    opacity = 1,
    distanceFade = null,
} = {}) {
    const mat = godotUnshaded({ map, transparent: true, fog, blending, billboard, side, color, opacity, distanceFade });
    mat.vertexShader = mat.vertexShader
        .replace('varying vec3 vViewPos;', 'varying vec3 vViewPos;\nattribute float instanceAlpha;\nvarying float vInstAlpha;')
        .replace('vUv = uv * uvScale + uvOffset;', 'vUv = uv * uvScale + uvOffset;\nvInstAlpha = instanceAlpha;');
    mat.fragmentShader = mat.fragmentShader
        .replace('varying vec3 vViewPos;', 'varying vec3 vViewPos;\nvarying float vInstAlpha;')
        .replace('gl_FragColor = c;', 'c.a *= vInstAlpha;\ngl_FragColor = c;');
    return mat;
}
