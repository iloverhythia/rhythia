// Rendering backend standing in for Godot's Forward+ renderer.
// Scenes are drawn into a linear half-float target (so alpha blending happens in linear space like Godot),
// optionally multisampled for the Anti Aliasing setting, then written to the canvas with an sRGB conversion.

import * as THREE from 'three';

export const TIME = { value: 0 }; // shader TIME, seconds since start

const MSAA = { 'Off (roughest)': 0, '2x (rough)': 2, '4x (smooth)': 4, '8x (smoothest)': 8 };

// Godot depth fog (FOG_MODE_DEPTH) — shared by space materials
export const FOG_PARS = /* glsl */ `
uniform bool fogEnabled;
uniform vec3 fogColor;
uniform float fogDensity;
uniform float fogBegin;
uniform float fogEnd;
uniform float fogCurve;
vec3 applyFog(vec3 color, float dist) {
    if (!fogEnabled) return color;
    float fz = smoothstep(fogBegin, fogEnd, dist);
    float amount = pow(fz, fogCurve) * fogDensity;
    return mix(color, fogColor, clamp(amount, 0.0, 1.0));
}
`;

export function fogUniforms(fog) {
    return {
        fogEnabled: { value: !!fog },
        fogColor: { value: new THREE.Color().setRGB(...(fog?.color ?? [0, 0, 0]), THREE.SRGBColorSpace) },
        fogDensity: { value: fog?.density ?? 1 },
        fogBegin: { value: fog?.begin ?? 10 },
        fogEnd: { value: fog?.end ?? 100 },
        fogCurve: { value: fog?.curve ?? 1 },
    };
}

// sRGB colour (0..1 components) to linear THREE.Color
export function srgb(r, g, b) {
    return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
}

const blitVert = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export class RenderBackend {
    constructor(canvas) {
        this.canvas = canvas;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
        this.renderer.autoClear = false;
        this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
        this.renderer.sortObjects = true;
        this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        this.renderer.setPixelRatio(this.pixelRatio);
        this.samples = 0;
        this.width = 1;
        this.height = 1;

        this.target = null;
        this.backgroundTarget = null;

        this.blitScene = new THREE.Scene();
        this.blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.blitMaterial = new THREE.ShaderMaterial({
            uniforms: { tex: { value: null } },
            vertexShader: blitVert,
            fragmentShader: /* glsl */ `
                uniform sampler2D tex;
                varying vec2 vUv;
                vec3 toSRGB(vec3 c) {
                    c = clamp(c, 0.0, 1.0);
                    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
                }
                void main() {
                    gl_FragColor = vec4(toSRGB(texture2D(tex, vUv).rgb), 1.0);
                }`,
            depthTest: false,
            depthWrite: false,
        });
        this.copyMaterial = new THREE.ShaderMaterial({
            uniforms: { tex: { value: null } },
            vertexShader: blitVert,
            fragmentShader: /* glsl */ `
                uniform sampler2D tex;
                varying vec2 vUv;
                void main() { gl_FragColor = texture2D(tex, vUv); }`,
            depthTest: false,
            depthWrite: false,
        });
        this.blitQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMaterial);
        this.blitQuad.frustumCulled = false;
        this.blitScene.add(this.blitQuad);

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    setAntiAliasing(name) {
        const samples = MSAA[name] ?? 0;
        if (samples === this.samples && this.target) return;
        this.samples = samples;
        this.createTargets();
    }

    createTargets() {
        this.target?.dispose();
        this.backgroundTarget?.dispose();
        const w = Math.max(1, Math.floor(this.width * this.pixelRatio));
        const h = Math.max(1, Math.floor(this.height * this.pixelRatio));
        this.target = new THREE.WebGLRenderTarget(w, h, {
            type: THREE.HalfFloatType,
            samples: this.samples,
            depthBuffer: true,
            colorSpace: THREE.LinearSRGBColorSpace,
        });
        this.backgroundTarget = new THREE.WebGLRenderTarget(w, h, {
            type: THREE.HalfFloatType,
            depthBuffer: false,
            colorSpace: THREE.LinearSRGBColorSpace,
        });
    }

    resize() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.renderer.setSize(this.width, this.height, false);
        this.canvas.style.width = `${this.width}px`;
        this.canvas.style.height = `${this.height}px`;
        this.createTargets();
    }

    get aspect() {
        return this.width / this.height;
    }

    // world: { scene, background?: (backend, camera, target) => void, clearColor?: THREE.Color }
    render(world, camera) {
        const r = this.renderer;
        camera.aspect = this.aspect;
        camera.updateProjectionMatrix();

        let hasBackground = false;
        if (world.background) {
            r.setRenderTarget(this.backgroundTarget);
            r.setClearColor(world.clearColor ?? new THREE.Color(0, 0, 0), 1);
            r.clear(true, false, false);
            hasBackground = world.background(this, camera, this.backgroundTarget) !== false;
        }

        r.setRenderTarget(this.target);
        r.setClearColor(world.clearColor ?? new THREE.Color(0, 0, 0), 1);
        r.clear(true, true, true);

        if (hasBackground) {
            this.blitQuad.material = this.copyMaterial;
            this.copyMaterial.uniforms.tex.value = this.backgroundTarget.texture;
            r.render(this.blitScene, this.blitCamera);
        }

        world.screenTexture = this.backgroundTarget.texture;
        r.render(world.scene, camera);

        r.setRenderTarget(null);
        this.blitQuad.material = this.blitMaterial;
        this.blitMaterial.uniforms.tex.value = this.target.texture;
        r.render(this.blitScene, this.blitCamera);
    }

    // draw a full screen shader into the current target
    fullscreen(material) {
        this.blitQuad.material = material;
        this.renderer.render(this.blitScene, this.blitCamera);
    }
}

// Helpers for Godot-style transforms written in .tscn row-major form
export function godotMatrix(m) {
    const mat = new THREE.Matrix4();
    mat.set(m[0], m[1], m[2], m[9], m[3], m[4], m[5], m[10], m[6], m[7], m[8], m[11], 0, 0, 0, 1);
    return mat;
}

export function applyGodotTransform(object, m) {
    object.matrixAutoUpdate = false;
    object.matrix.copy(godotMatrix(m));
    object.matrixWorldNeedsUpdate = true;
}

// Unshaded textured quad equivalent to a StandardMaterial3D with transparency on and shading_mode unshaded
export function unshadedMaterial({ map = null, color = 0xffffff, opacity = 1, transparent = true, depthTest = true, side = THREE.FrontSide } = {}) {
    const mat = new THREE.MeshBasicMaterial({ map, color, opacity, transparent, depthTest, side, depthWrite: !transparent });
    mat.toneMapped = false;
    return mat;
}
