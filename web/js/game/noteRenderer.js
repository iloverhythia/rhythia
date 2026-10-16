// Port of scripts/game/renderers/NoteRenderer.cs
// MultiMeshInstance3D -> two InstancedMeshes sharing buffers: an opaque depth pre-pass and an alpha blended pass
// (Godot's TRANSPARENCY_ALPHA_DEPTH_PRE_PASS).

import * as THREE from 'three';
import { HIT_WINDOW } from '../constants.js';
import { HitResult } from '../map/note.js';
import { clamp } from '../util.js';

const vertexShader = /* glsl */ `
attribute vec4 aColor;
varying vec4 vColor;
void main() {
    vColor = aColor;
    vec4 p = vec4(position, 1.0);
    #ifdef USE_INSTANCING
    p = instanceMatrix * p;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * p;
}`;

const colorFragment = /* glsl */ `
varying vec4 vColor;
void main() {
    gl_FragColor = vColor;
}`;

const prepassFragment = /* glsl */ `
varying vec4 vColor;
void main() {
    if (vColor.a < 0.99) discard;
    gl_FragColor = vec4(0.0);
}`;

export class NoteRenderer {
    constructor(runner, parent, skinManager) {
        this.runner = runner;
        this.parent = parent;
        this.skinManager = skinManager;
        this.settings = null;
        this.capacity = 0;
        this.meshes = [];
        this.geometry = null;
        this.matrix = new THREE.Matrix4();
        this.linearColors = [];
        this.tmpColor = new THREE.Color();
    }

    setup(settings) {
        this.settings = settings;
        const skin = this.skinManager.skin;
        this.geometry = skin.noteMesh;
        this.linearColors = skin.noteColors.map((c) => new THREE.Color().setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace));
        this.allocate(Math.max(16, this.capacity));
    }

    allocate(capacity) {
        for (const m of this.meshes) {
            this.parent.remove(m);
            m.dispose();
        }
        this.capacity = capacity;

        const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
        colorAttr.setUsage(THREE.DynamicDrawUsage);

        const geometry = this.geometry.clone();
        geometry.setAttribute('aColor', colorAttr);

        const prepass = new THREE.InstancedMesh(
            geometry,
            new THREE.ShaderMaterial({ vertexShader, fragmentShader: prepassFragment, colorWrite: false, depthWrite: true, transparent: false }),
            capacity,
        );
        const color = new THREE.InstancedMesh(
            geometry,
            new THREE.ShaderMaterial({
                vertexShader,
                fragmentShader: colorFragment,
                transparent: true,
                depthWrite: false,
                depthFunc: THREE.LessEqualDepth,
            }),
            capacity,
        );
        color.instanceMatrix = prepass.instanceMatrix;
        prepass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (const m of [prepass, color]) {
            m.frustumCulled = false;
            m.count = 0;
            this.parent.add(m);
        }
        color.renderOrder = 1;
        this.colorAttr = colorAttr;
        this.meshes = [prepass, color];
    }

    doRender(note, time, approachTime, speed) {
        return note.millisecond - time >= (this.settings.Pushback.value ? -HIT_WINDOW * speed : 0) && note.millisecond - time <= approachTime * 1000 * speed;
    }

    render(time, notes) {
        const attempt = this.runner.attempt;
        const s = this.settings;
        const ar = s.ApproachRate.value;
        const ad = s.ApproachDistance.value;
        const at = s.ApproachTime.value;
        const noteSize = s.NoteSize.value;
        const fadeIn = s.FadeIn.value / 100;
        const fadeOut = s.FadeOut.value / 100;
        const noteOpacity = s.NoteOpacity.value;
        const noteOpacityExponent = Math.max(1.1920929e-7, s.NoteOpacityExponent.value);
        const pushback = s.Pushback.value;
        const hitWindowDepth = pushback ? (HIT_WINDOW * ar) / 1000 : 0;
        const half = noteSize / 2;

        if (notes.length > this.capacity) this.allocate(Math.max(notes.length, this.capacity * 2));

        const colors = this.colorAttr.array;
        const matrices = this.meshes[0].instanceMatrix.array;
        const renderMods = attempt.modifiers.filter((m) => m.isRenderModifier);

        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];

            if (!this.doRender(note, time, at, attempt.speed) || note.lastResult === HitResult.Hit) {
                colors[i * 4 + 3] = 0;
                continue;
            }

            const depth = ((note.millisecond - attempt.progress) / (1000 * at)) * (ad / attempt.speed);
            const progress = 1 - Math.max(0, (depth + hitWindowDepth) / (ad + hitWindowDepth));

            note.opacity = 1;
            note.rotZ = 0;

            if (fadeIn > 0) note.opacity = Math.min(1, progress / fadeIn);
            if (fadeOut > 0 && attempt.useFadeOut) note.opacity -= 1 - Math.min(1, (1 - progress) / fadeOut);

            note.origin.x = note.x;
            note.origin.y = note.y;
            note.origin.z = -depth;

            for (const mod of renderMods) mod.modifyRenderObject(note, attempt);

            const c = this.linearColors[note.index % this.linearColors.length];
            const alpha = clamp(Math.pow(Math.max(0, note.opacity * noteOpacity), noteOpacityExponent), 0, 1);

            colors[i * 4] = c.r;
            colors[i * 4 + 1] = c.g;
            colors[i * 4 + 2] = c.b;
            colors[i * 4 + 3] = alpha;

            const cos = Math.cos(note.rotZ) * half;
            const sin = Math.sin(note.rotZ) * half;
            const o = i * 16;
            matrices[o] = cos;
            matrices[o + 1] = sin;
            matrices[o + 2] = 0;
            matrices[o + 3] = 0;
            matrices[o + 4] = -sin;
            matrices[o + 5] = cos;
            matrices[o + 6] = 0;
            matrices[o + 7] = 0;
            matrices[o + 8] = 0;
            matrices[o + 9] = 0;
            matrices[o + 10] = half;
            matrices[o + 11] = 0;
            matrices[o + 12] = note.origin.x;
            matrices[o + 13] = note.origin.y;
            matrices[o + 14] = note.origin.z;
            matrices[o + 15] = 1;
        }

        for (const m of this.meshes) m.count = notes.length;
        this.colorAttr.needsUpdate = true;
        this.meshes[0].instanceMatrix.needsUpdate = true;
    }

    process(delta, attempt) {
        const notes = attempt.objects.Note;
        if (!notes) return;
        const start = this.runner.objectIndicesStart.Note;
        const end = this.runner.objectIndicesEnd.Note;
        this.render(attempt.progress, notes.slice(start, end));
    }

    dispose() {
        for (const m of this.meshes) {
            this.parent.remove(m);
            m.geometry.dispose();
            m.material.dispose();
        }
        this.meshes = [];
        this.capacity = 0;
    }
}
