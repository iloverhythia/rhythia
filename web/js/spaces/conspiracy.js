// Port of scripts/spaces/Conspiracy.cs + prefabs/spaces/conspiracy.tscn
// Bobbing illuminati / money / globe icons, scrolling question-mark strips and lorem-ipsum text sliding along the
// floor. Custom colour background, no fog. (stencil_flags on the icon materials are inactive: no stencil_mode.)

import * as THREE from 'three';
import { RES, STARTED } from '../constants.js';
import { applyGodotTransform, srgb } from '../render.js';
import { BaseSpace, godotUnshaded, loadTexture, planeMesh } from './base.js';

const SCROLLING_TEXT_LOOP_END = 46;
const ICONS_START = new THREE.Vector3(0, 0, -3.954605);
const SCROLLING_TEXT_START = new THREE.Vector3(0, -2.5, -50);

// Icons/*: [texture, transform]; all at GeometryInstance3D.transparency 0.5
const ICONS = [
    ['Illuminati', [5.8470845, -4.6656594, -0.541502, 0.3267105, 1.2665545, -7.3850555, 4.6856003, 5.733887, 1.1906635, 32.59851, -11.157616, -31.747986]],
    ['Money', [2.9223795, -2.7311902, -0.017496193, -0.50015396, -0.5099538, -3.935709, 2.6850605, 2.8775966, -0.7140733, 26.030668, 4.7692785, -20.048704]],
    ['Globe', [3.4610326, -1.969467, 0.37743923, -0.488691, -1.5585567, -3.6513133, 1.9448497, 3.1132152, -1.5891691, 20, 16, -24]],
    ['Illuminati', [5.621934, 4.7847614, -1.3228353, 0.40752319, -2.4366205, -7.081439, -4.947502, 5.236306, -2.0864563, -32, 15, -30]],
    ['Money', [2.8191392, 2.7699506, 0.6163019, 0.4957598, 0.37461472, -3.9514437, -2.7940428, 2.8613024, -0.07928384, -26.6644, -3.938541, -20.045391]],
    ['Globe', [3.384025, 1.9644992, 0.8301336, -0.0761631, 1.6672957, -3.6351528, -2.1313324, 3.0595553, 1.4479486, -19.999998, -16, -23.999996]],
];

// ScrollingQuestionMarks Left / Right (GeometryInstance3D.transparency 0.95)
const QUESTION_MARKS = [
    [7.3954983, 6.7292447, 1.5452654, 0.013135073, 0.21514565, -99.97681, -6.7310066, 7.393984, 1.5027192, -36, 13, -36],
    [7.3962126, -6.7285557, -1.5013845, -0.012785042, 0.20903364, -99.97806, 6.7302165, 7.3947835, 1.4600326, 36, 13, -36],
];

export class ConspiracySpace extends BaseSpace {
    async init() {
        this.clearColor = srgb(0.017732391, 0.01773239, 0.017732402);

        const names = ['Illuminati', 'Money', 'Globe', 'Scroll', 'Front', 'back'];
        const textures = await Promise.all(names.map((n) => loadTexture(`${RES}/textures/spaces/conspiracy/${n}.png`, { repeat: true })));
        const tex = Object.fromEntries(names.map((n, i) => [n, textures[i]]));
        this.track(...textures);

        const plane = planeMesh(2, 2);

        // Icons: render_priority 1, alpha blended, cull disabled, unshaded
        this.icons = new THREE.Group();
        this.icons.position.copy(ICONS_START);
        const iconMaterials = {};
        for (const [name, t] of ICONS) {
            iconMaterials[name] ??= godotUnshaded({ map: tex[name], transparent: true, side: THREE.DoubleSide, opacity: 0.5 });
            const icon = new THREE.Mesh(plane, iconMaterials[name]);
            applyGodotTransform(icon, t);
            icon.renderOrder = 1;
            this.icons.add(icon);
        }
        this.root.add(this.icons);

        // Scrolling question marks: Scroll.png, uv1_scale (1, 10), cull disabled. Both strips share the material
        this.questionMarkMaterial = godotUnshaded({ map: tex.Scroll, transparent: true, side: THREE.DoubleSide, uvScale: [1, 10], opacity: 0.05 });
        const questionMarks = new THREE.Group();
        questionMarks.position.copy(ICONS_START);
        for (const t of QUESTION_MARKS) {
            const strip = new THREE.Mesh(plane, this.questionMarkMaterial);
            applyGodotTransform(strip, t);
            questionMarks.add(strip);
        }
        this.root.add(questionMarks);

        // Scrolling text on the floor: uv1_scale (1, 20), distance fade pixel alpha 30 -> 10 (fades out with distance)
        this.scrollingText = new THREE.Group();
        this.scrollingText.position.copy(SCROLLING_TEXT_START);
        const top = new THREE.Mesh(
            plane,
            godotUnshaded({ map: tex.Front, transparent: true, uvScale: [1, 20], distanceFade: [30, 10], opacity: 1 - 0.9 }),
        );
        applyGodotTransform(top, [5, 0, 0, 0, 5, 0, 0, 0, 80, 0, -3.262, 0]);
        const bottom = new THREE.Mesh(
            plane,
            godotUnshaded({ map: tex.back, transparent: true, uvScale: [1, 20], distanceFade: [30, 10], opacity: 1 - 0.95 }),
        );
        applyGodotTransform(bottom, [5, 0, 0, 0, 5, 0, 0, 0, 80, -0.6745815, -4.4326196, 0]);
        this.scrollingText.add(top, bottom);
        this.root.add(this.scrollingText);
    }

    process(delta) {
        super.process(delta);
        const effects = !!this.ctx.settings.SpaceEffects.value;

        if (effects) {
            // Uv1Offset += Vector3.Up * delta / 10
            this.questionMarkMaterial.uniforms.uvOffset.value.y += delta / 10;

            this.icons.position.copy(ICONS_START);
            this.icons.position.y += Math.sin((performance.now() - STARTED) / 1000);

            if (this.scrollingText.position.z < SCROLLING_TEXT_LOOP_END) {
                this.scrollingText.position.z += delta * 2;
            } else {
                this.scrollingText.position.copy(SCROLLING_TEXT_START);
            }
        }
        this.scrollingText.visible = effects;
    }
}
