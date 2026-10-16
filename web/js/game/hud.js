// Port of the HUD in scenes/game.tscn + scripts/game/managers/HudManager.cs and scripts/game/ui/*.cs
// SubViewport panels are drawn with Canvas2D into CanvasTextures, Label3D/Sprite3D become textured quads.

import * as THREE from 'three';
import { CURSOR_SIZE } from '../constants.js';
import { HitResult } from '../map/note.js';
import { applyGodotTransform } from '../render.js';
import { Ease, Trans, clamp, colorLerp, formatTime, lerp, moveToward, padMagnitude, tween } from '../util.js';

const FONT = {
    nunitoBold: '"Nunito Bold"',
    nunitoSemiBold: '"Nunito SemiBold"',
    ubuntuMedium: '"Ubuntu Medium"',
    robotoMedium: '"Roboto Medium"',
    default: '"Open Sans", "Nunito SemiBold", sans-serif',
};

function canvasTexture(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 8;
    return tex;
}

function quad(width, height, material) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.frustumCulled = false;
    return mesh;
}

function basicMaterial(opts = {}) {
    return new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, ...opts });
}

// ---------------------------------------------------------------- Label3D

export class Label3D {
    constructor({
        text = '',
        font = FONT.default,
        fontSize = 32,
        pixelSize = 0.005,
        modulate = [1, 1, 1, 1],
        outlineModulate = [0, 0, 0, 1],
        outlineSize = 12,
        width = 500,
        autowrap = false,
        noDepthTest = false,
        renderOrder = 0,
    }) {
        this.font = font;
        this.fontSize = fontSize;
        this.pixelSize = pixelSize;
        this.modulate = [...modulate];
        this.outlineModulate = outlineModulate;
        this.outlineSize = outlineSize;
        this.width = width;
        this.autowrap = autowrap;
        this.scale = 2; // supersampling
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.texture = canvasTexture(this.canvas);
        this.material = basicMaterial({ map: this.texture, side: THREE.DoubleSide, depthTest: !noDepthTest });
        this.mesh = quad(1, 1, this.material);
        this.mesh.renderOrder = renderOrder;
        this.group = new THREE.Group();
        this.group.add(this.mesh);
        this._text = null;
        this.text = text;
        this.applyModulate();
    }

    get text() {
        return this._text;
    }

    set text(t) {
        t = String(t);
        if (t === this._text) return;
        this._text = t;
        this.redraw();
    }

    setAlpha(a) {
        this.modulate[3] = a;
        this.applyModulate();
    }

    applyModulate() {
        // modulate tints the fill only, the outline keeps outline_modulate (drawn into the texture)
        this.redraw();
    }

    wrapLines(ctx, text) {
        if (!this.autowrap) return text.split('\n');
        const words = text.split(' ');
        const lines = [];
        let line = '';
        for (const w of words) {
            const test = line ? `${line} ${w}` : w;
            if (ctx.measureText(test).width > this.width && line) {
                lines.push(line);
                line = w;
            } else {
                line = test;
            }
        }
        lines.push(line);
        return lines;
    }

    redraw() {
        if (this._text == null) return;
        const s = this.scale;
        const ctx = this.ctx;
        ctx.font = `${this.fontSize}px ${this.font}`;
        const lines = this.wrapLines(ctx, this._text);
        const metrics = ctx.measureText('Hg');
        const ascent = metrics.fontBoundingBoxAscent ?? this.fontSize * 0.9;
        const descent = metrics.fontBoundingBoxDescent ?? this.fontSize * 0.25;
        const lineHeight = ascent + descent;
        const pad = this.outlineSize + 2;
        const textWidth = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
        const w = Math.ceil(textWidth + pad * 2);
        const h = Math.ceil(lineHeight * lines.length + pad * 2);

        this.canvas.width = w * s;
        this.canvas.height = h * s;
        ctx.setTransform(s, 0, 0, s, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.font = `${this.fontSize}px ${this.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.lineJoin = 'round';

        const [r, g, b, a] = this.modulate;
        const [or, og, ob, oa] = this.outlineModulate;

        lines.forEach((line, i) => {
            const y = pad + ascent + i * lineHeight;
            if (this.outlineSize > 0 && oa > 0) {
                ctx.strokeStyle = `rgba(${or * 255}, ${og * 255}, ${ob * 255}, ${oa})`;
                ctx.lineWidth = this.outlineSize;
                ctx.strokeText(line, w / 2, y);
            }
            if (a > 0) {
                ctx.fillStyle = `rgba(${r * 255}, ${g * 255}, ${b * 255}, ${a})`;
                ctx.fillText(line, w / 2, y);
            }
        });

        this.texture.dispose();
        this.texture = canvasTexture(this.canvas);
        this.material.map = this.texture;
        this.material.needsUpdate = true;
        // quad is centred like Label3D's default alignment
        this.mesh.scale.set(w * this.pixelSize, h * this.pixelSize, 1);
    }

    dispose() {
        this.texture.dispose();
        this.material.dispose();
        this.mesh.geometry.dispose();
    }
}

// ---------------------------------------------------------------- canvas panels (SubViewport stand-ins)

class CanvasPanel {
    constructor(width, height, worldW, worldH, renderOrder = 0) {
        this.width = width;
        this.height = height;
        this.canvas = document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;
        this.ctx = this.canvas.getContext('2d');
        this.texture = canvasTexture(this.canvas);
        this.material = basicMaterial({ map: this.texture });
        this.mesh = quad(worldW, worldH, this.material);
        this.mesh.renderOrder = renderOrder;
        this.dirty = true;
    }

    flush() {
        if (!this.dirty) return;
        this.dirty = false;
        this.texture.needsUpdate = true;
    }

    // Label with grow_horizontal/grow_vertical = both, centred on an anchor point
    text(str, x, y, font, size, color = 'white', align = 'center') {
        const ctx = this.ctx;
        ctx.font = `${size}px ${font}`;
        const m = ctx.measureText('Hg');
        const ascent = m.fontBoundingBoxAscent ?? size * 0.9;
        const descent = m.fontBoundingBoxDescent ?? size * 0.25;
        ctx.textAlign = align;
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = color;
        ctx.fillText(str, x, y - (ascent + descent) / 2 + ascent);
    }

    dispose() {
        this.texture.dispose();
        this.material.dispose();
        this.mesh.geometry.dispose();
    }
}

function drawImage(ctx, img, x, y, w, h) {
    if (img && img.complete && img.naturalWidth) ctx.drawImage(img, x, y, w, h);
}

function loadImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

// ---------------------------------------------------------------- HUD

export class Hud {
    constructor({ group, skinManager, sound }) {
        this.group = group;
        this.skinManager = skinManager;
        this.sound = sound;
        this.runner = null;
        this.objects = [];
        this.modifierIcons = [];
        this.popups = new Set();
        this.hitPopups = 0;
        this.missPopups = 0;
        this.images = {};
        this.unsubs = [];
    }

    async loadImages() {
        const skin = this.skinManager.skin;
        const keys = [
            'panelLeftBackgroundImage',
            'panelRightBackgroundImage',
            'healthImage',
            'healthBackgroundImage',
            'progressImage',
            'progressBackgroundImage',
            'hitsImage',
            'missesImage',
        ];
        const imgs = await Promise.all(keys.map((k) => loadImage(skin.urls[k])));
        keys.forEach((k, i) => (this.images[k] = imgs[i]));
    }

    add(obj, matrix = null) {
        if (matrix) applyGodotTransform(obj, matrix);
        this.group.add(obj);
        this.objects.push(obj);
        return obj;
    }

    clear() {
        for (const u of this.unsubs) u();
        this.unsubs = [];
        for (const p of this.popups) p.tween?.kill();
        this.popups.clear();
        this.skipTween?.kill();
        this.skipTween = null;
        for (const o of this.objects) {
            this.group.remove(o);
            o.traverse?.((c) => {
                c.geometry?.dispose?.();
                if (c.material && !c.material.userData?.shared) c.material.dispose?.();
            });
        }
        this.objects = [];
        this.modifierIcons = [];
        this.hitPopups = 0;
        this.missPopups = 0;
    }

    init(runner) {
        this.clear();
        this.runner = runner;
        const attempt = runner.attempt;
        const s = attempt.settings;
        const skin = this.skinManager.skin;
        const tex = skin.textures;

        // ---- Grid (Runner/HUD/Grid)
        this.grid = this.add(quad(4, 4, basicMaterial({ map: tex.gridImage })));
        this.grid.renderOrder = 4;

        // Grid/VisibilityAssist
        this.visibilityAssist = this.add(quad(1, 1, basicMaterial({ map: tex.visibilityAssistImage, opacity: 0.75 })), [300, 0, 0, 0, 300, 0, 0, 0, 300, 0, 0, -140]);
        this.visibilityAssist.visible = s.VisibilityAssist.value;
        this.visibilityAssist.renderOrder = -10;

        // Grid/GridGuides
        this.gridGuides = this.add(quad(4, 4, basicMaterial({ map: tex.gridGuidesImage })), [1.01, 0, 0, 0, 1.01, 0, 0, 0, 1.01, 0, 0, -0.2]);
        this.gridGuides.visible = s.GridGuides.value;
        this.gridGuides.renderOrder = 3;

        // Grid/Cursor
        const cursorAlpha = clamp(s.CursorOpacity.value, 0, 1);
        const cursorSize = CURSOR_SIZE * s.CursorScale.value;
        this.cursorSize = cursorSize;
        this.cursor = this.add(quad(cursorSize, cursorSize, basicMaterial({ map: tex.cursorImage, opacity: cursorAlpha })));
        this.cursor.renderOrder = 6;
        this.cursorAlpha = cursorAlpha;

        // Grid/CursorTrail (MultiMesh of unit quads)
        this.trailCapacity = 0;
        this.trailMaterial = basicMaterial({ map: tex.cursorImage, side: THREE.DoubleSide });
        this.trailMaterial.onBeforeCompile = (shader) => {
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', 'attribute float aAlpha;\nvarying float vAlpha;\n#include <common>')
                .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', 'varying float vAlpha;\n#include <common>')
                .replace('#include <opaque_fragment>', 'diffuseColor.a *= vAlpha;\n#include <opaque_fragment>');
        };
        this.trailMaterial.opacity = cursorAlpha;
        this.ensureTrail(64);

        // ---- Health (Runner/HUD/Health)
        this.health = new CanvasPanel(1088, 80, 10.88, 0.8, 1);
        this.add(this.health.mesh, [1, 0, 0, 0, 0.965926, 0.258819, 0, -0.258819, 0.965926, 0, -6.3, -10]);
        this.healthVisible = !s.SuperSimpleHUD.value;
        this.healthTarget = 1088;
        this.healthCurrent = 1088;
        this.healthDead = false;

        // ---- PanelLeft
        this.panelLeft = new CanvasPanel(250, 625, 4, 10, 1);
        this.add(this.panelLeft.mesh, [0.984808, 0, 0.173648, 0, 1, 0, -0.173648, 0, 0.984808, -7.5, 0, -9]);
        this.panelsVisible = !s.SimpleHUD.value && !s.SuperSimpleHUD.value;
        this.altCombo = s.AltComboCounter.value;
        this.multiplierProgress = 0;
        this.multiplierTarget = 0;
        this.multiplierColor = { r: 1, g: 1, b: 1, a: 1 };
        this.multiplierTargetColor = { r: 1, g: 1, b: 1, a: 1 };
        this.multiplierSides = clamp(attempt.comboMultiplierIncrement, 3, 32);

        // ---- PanelRight
        this.panelRight = new CanvasPanel(250, 625, 4, 10, 1);
        this.add(this.panelRight.mesh, [0.984808, 0, -0.173648, 0, 1, 0, 0.173648, 0, 0.984808, 7.5, 0, -9]);
        this.hitOpacity = 0.62;
        this.missOpacity = 0.62;

        // ---- ProgressBar
        this.progressBar = new CanvasPanel(1088, 80, 10.88, 0.8, 1);
        this.add(this.progressBar.mesh, [1, 0, 0, 0, 0.965926, -0.258819, 0, 0.258819, 0.965926, 0, 6.3, -10]);
        this.lastProgressWidth = -1;

        // ---- Progress label
        this.progressLabel = new Label3D({ text: '0:00 / 0:00', font: FONT.nunitoSemiBold, fontSize: 64, pixelSize: 0.0025, modulate: [1, 1, 1, 0.74509805], outlineModulate: [0, 0, 0, 0], renderOrder: 1 });
        this.add(this.progressLabel.group, [3.5, 0, 0, 0, 3.38074, -0.905867, 0, 0.905867, 3.38074, 0, 7, -10]);
        this.progressLabel.group.visible = !s.SuperSimpleHUD.value;

        // ---- Title
        this.title = new Label3D({ text: attempt.map.prettyTitle, font: FONT.nunitoBold, fontSize: 64, pixelSize: 0.005, outlineModulate: [0, 0, 0, 0], width: 2500, autowrap: true, renderOrder: 1 });
        this.add(this.title.group, [2, 0, 0, 0, 1.93185, -0.517638, 0, 0.517638, 1.93185, 0, 8.25, -10]);
        this.title.group.visible = !s.SuperSimpleHUD.value;

        // ---- Combo
        this.combo = new Label3D({ text: '0', font: FONT.ubuntuMedium, fontSize: 64, pixelSize: 0.0025, modulate: [1, 1, 1, 0], outlineModulate: [1, 1, 1, 0.39215687], outlineSize: 4, renderOrder: 1 });
        this.add(this.combo.group, [7, 0, 0, 0, 6.89365, -1.21554, 0, 1.21554, 6.89365, 0, 3.5, -10]);
        this.combo.group.visible = !s.SuperSimpleHUD.value && !s.AltComboCounter.value;

        // ---- Speed
        this.speedLabel = new Label3D({
            text: `${runner.speed.toFixed(2)}x`,
            font: FONT.nunitoSemiBold,
            fontSize: 32,
            pixelSize: 0.0025,
            modulate: [1, 1, 1, runner.speed === 1 ? 0 : 100 / 255],
            outlineModulate: [0, 0, 0, 0],
            renderOrder: 1,
        });
        this.add(this.speedLabel.group, [7, 0, 0, 0, 6.76148, 1.81173, 0, -1.81173, 6.76148, 0, -7.5, -10]);

        // ---- Skip
        this.skip = new Label3D({ text: 'Press Space to skip', font: FONT.nunitoSemiBold, fontSize: 32, pixelSize: 0.0025, modulate: [1, 1, 1, 0], outlineModulate: [0, 0, 0, 0], renderOrder: 1 });
        this.add(this.skip.group, [7, 0, 0, 0, 6.76148, 1.81173, 0, -1.81173, 6.76148, 0, -5, -10]);
        this.skipTween = null;

        // ---- events
        this.unsubs.push(runner.on('attemptStatsUpdated', (a) => this.onStatsUpdated(a)));
        this.unsubs.push(runner.on('hitResultChanged', (i, r) => this.onHitResultChanged(i, r)));
        this.unsubs.push(runner.on('skipAvailable', (a) => this.onSkipAvailable(a)));

        this.drawHealth();
        this.drawProgress(0);
        this.drawPanels(attempt);
    }

    ensureTrail(capacity) {
        if (capacity <= this.trailCapacity) return;
        if (this.trail) {
            this.group.remove(this.trail);
            this.objects = this.objects.filter((o) => o !== this.trail);
        }
        const geometry = new THREE.PlaneGeometry(1, 1);
        const alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
        alpha.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('aAlpha', alpha);
        this.trailMaterial.userData.shared = true;
        this.trail = new THREE.InstancedMesh(geometry, this.trailMaterial, capacity);
        this.trail.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.trail.frustumCulled = false;
        this.trail.count = 0;
        this.trail.renderOrder = 5;
        this.trailAlpha = alpha;
        this.trailCapacity = capacity;
        this.add(this.trail);
    }

    // TrailRenderer.updateTrailRendering
    updateTrail(trails, cursorPos, now, trailTime) {
        this.ensureTrail(trails.length);
        const m = new THREE.Matrix4();
        const size = this.cursorSize;
        for (let j = 0; j < trails.length; j++) {
            const t = trails[j];
            m.makeRotationZ(t.rotation);
            m.scale(new THREE.Vector3(size, size, size));
            m.setPosition(t.position.x, t.position.y, 0);
            this.trail.setMatrixAt(j, m);
            const skip = t.position.x === cursorPos.x && t.position.y === cursorPos.y;
            const elapsed = (now - t.time) / 1000000;
            const step = clamp(elapsed / trailTime, 0, 1);
            this.trailAlpha.array[j] = skip ? 0 : lerp(1, 0, step);
        }
        this.trail.count = trails.length;
        this.trail.instanceMatrix.needsUpdate = true;
        this.trailAlpha.needsUpdate = true;
    }

    displayModifier(mod) {
        const tex = this.skinManager.skin.textures[`mod${mod.name}Image`];
        const icon = quad(0.64, 0.64, basicMaterial({ map: tex, opacity: 0.376471, depthTest: false }));
        icon.renderOrder = 8;
        this.add(icon, [1, 0, 0, 0, 0.965926, 0.258819, 0, -0.258819, 0.965926, 0, -8.5, -10]);
        this.modifierIcons.push(icon);
        const n = this.modifierIcons.length;
        this.modifierIcons.forEach((ic, i) => {
            ic.matrix.elements[12] = (i - (n - 1) / 2) * 0.75;
            ic.matrixWorldNeedsUpdate = true;
        });
    }

    // ---------------------------------------------------------------- drawing

    drawHealth() {
        const p = this.health;
        const ctx = p.ctx;
        ctx.clearRect(0, 0, p.width, p.height);
        if (this.healthVisible) {
            ctx.globalAlpha = this.healthDead ? 128 / 255 : 1;
            drawImage(ctx, this.images.healthBackgroundImage, 0, 0, 1088, 80);
            const w = Math.max(0, Math.round(this.healthCurrent));
            const img = this.images.healthImage;
            if (img && w > 0) {
                // TextureRect STRETCH_TILE: draw at native size, clipped to width
                for (let x = 0; x < w; x += img.naturalWidth) {
                    const cw = Math.min(img.naturalWidth, w - x);
                    ctx.drawImage(img, 0, 0, cw, img.naturalHeight, x, 0, cw, img.naturalHeight);
                }
            }
            ctx.globalAlpha = 1;
        }
        p.dirty = true;
    }

    drawProgress(width) {
        const p = this.progressBar;
        const ctx = p.ctx;
        ctx.clearRect(0, 0, p.width, p.height);
        drawImage(ctx, this.images.progressBackgroundImage, 0, 0, 1088, 80);
        const img = this.images.progressImage;
        const w = Math.max(0, Math.floor(width));
        if (img && w > 0) {
            for (let x = 0; x < w; x += img.naturalWidth) {
                const cw = Math.min(img.naturalWidth, w - x);
                ctx.drawImage(img, 0, 0, cw, img.naturalHeight, x, 0, cw, img.naturalHeight);
            }
        }
        p.dirty = true;
    }

    drawPanels(attempt) {
        this.drawPanelLeft(attempt);
        this.drawPanelRight(attempt);
    }

    drawPanelLeft(attempt) {
        const p = this.panelLeft;
        const ctx = p.ctx;
        ctx.clearRect(0, 0, 250, 625);
        if (this.panelsVisible) {
            drawImage(ctx, this.images.panelLeftBackgroundImage, 0, 0, 250, 625);
            this.drawMultiplierProgress(ctx, 125, 406.25);
            p.text(padMagnitude(attempt.score), 125, 218.75, FONT.nunitoBold, 50);
            p.text(`${attempt.comboMultiplier}x`, 125, 406.25, FONT.nunitoSemiBold, 50);
            if (this.altCombo) p.text(`${attempt.combo}`, 125, 537.5, FONT.nunitoSemiBold, 50);
        }
        p.dirty = true;
    }

    // scripts/shaders/combo_progress.gdshader on a 256x256 panel: a polygon outline (radius 64px, 3px thickness)
    // whose clockwise-from-top portion up to `progress` takes `colour`
    drawMultiplierProgress(ctx, cx, cy) {
        const sides = this.multiplierSides;
        const radius = 0.25 * 256;
        const points = [];
        for (let i = 0; i < sides; i++) {
            const a = ((Math.PI * 2) / sides) * i;
            points.push([cx + radius * Math.sin(a), cy - radius * Math.cos(a)]);
        }
        const path = new Path2D();
        points.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
        path.closePath();

        ctx.save();
        ctx.lineWidth = 6;
        ctx.lineJoin = 'miter';
        ctx.strokeStyle = 'rgb(40, 40, 40)'; // background_colour 0.155
        ctx.stroke(path);

        const progress = clamp(this.multiplierProgress, 0, 1);
        if (progress > 0) {
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, 200, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            const c = this.multiplierColor;
            ctx.strokeStyle = `rgb(${c.r * 255}, ${c.g * 255}, ${c.b * 255})`;
            ctx.stroke(path);
        }
        ctx.restore();
    }

    drawPanelRight(attempt) {
        const p = this.panelRight;
        const ctx = p.ctx;
        ctx.clearRect(0, 0, 250, 625);
        if (this.panelsVisible) {
            drawImage(ctx, this.images.panelRightBackgroundImage, 0, 0, 250, 625);
            p.text(`${attempt.hits + attempt.misses === 0 ? '100.00' : attempt.accuracy.toFixed(2)}%`, 125, 218.75, FONT.nunitoBold, 50);

            ctx.globalAlpha = this.hitOpacity;
            p.text(`${attempt.hits}`, 100, 388.625, FONT.nunitoSemiBold, 30, 'white', 'right');
            ctx.globalAlpha = this.missOpacity;
            p.text(`${attempt.misses}`, 150, 388.625, FONT.nunitoSemiBold, 30, 'white', 'left');
            ctx.globalAlpha = 1;

            p.text(padMagnitude(attempt.sum), 125, 437.5, FONT.nunitoSemiBold, 50);
            drawImage(ctx, this.images.hitsImage, 104, 378.625, 19, 19);
            drawImage(ctx, this.images.missesImage, 127, 378.625, 19, 19);

            // Line with alpha_gradient shader
            const grad = ctx.createLinearGradient(16, 0, 234, 0);
            grad.addColorStop(0, 'rgba(255,255,255,0)');
            grad.addColorStop(0.5, 'rgba(255,255,255,1)');
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(16, 406.25, 218, 2);
        } else {
            p.text(`${attempt.misses}`, 125, 312.5, FONT.nunitoSemiBold, 50, 'rgba(255,255,255,0.768627)');
        }
        p.dirty = true;
    }

    // ---------------------------------------------------------------- events

    onStatsUpdated(attempt) {
        this.combo.text = String(attempt.combo);

        this.healthTarget = 32 + attempt.health * 10.24;
        if (!attempt.isReplay && attempt.health <= 0) this.healthDead = true;

        this.multiplierTarget = attempt.comboMultiplierProgress / attempt.comboMultiplierIncrement;
        this.multiplierTargetColor = attempt.comboMultiplier === 8 ? { r: 1, g: 140 / 255, b: 0, a: 1 } : { r: 1, g: 1, b: 1, a: 1 };

        this.drawPanels(attempt);
    }

    onHitResultChanged(noteIndex, result) {
        const runner = this.runner;
        const attempt = runner.attempt;

        if (result === HitResult.Miss) this.missOpacity = 1;
        else if (result === HitResult.Hit) this.hitOpacity = 1;

        const lateness = attempt.isReplay ? attempt.hitsInfo[noteIndex] : Math.fround((Math.trunc(attempt.progress) - attempt.map.notes[noteIndex].millisecond) / runner.speed);
        const factor = 1 - Math.max(0, lateness - 25) / 150;
        const hitScore = Math.max(0, Math.trunc(100 * attempt.comboMultiplier * attempt.modsMultiplier * factor * ((runner.speed - 1) / 2.5 + 1)));

        if (result === HitResult.Hit) this.spawnHitIcon(noteIndex, hitScore);
        else if (result === HitResult.Miss) this.spawnMissIcon(noteIndex);
    }

    spawnPopup(object, x, onDone) {
        object.position.set(x, -1.4, 0);
        this.group.add(object);
        const startY = -1.4;
        const popup = { object };
        const material = object.isMesh ? object.material : object.children[0].material;
        const baseOpacity = material.opacity;
        popup.tween = tween(
            (k) => {
                material.opacity = baseOpacity * (1 - k);
            },
            0,
            1,
            0.25,
            { trans: Trans.LINEAR },
        );
        popup.move = tween((y) => (object.position.y = y), startY, startY + 0.25, 0.25, {
            trans: Trans.QUINT,
            ease: Ease.OUT,
            onDone: () => {
                this.group.remove(object);
                this.popups.delete(popup);
                onDone();
            },
        });
        this.popups.add(popup);
    }

    spawnHitIcon(index, hitScore) {
        const attempt = this.runner.attempt;
        if (!attempt.settings.HitPopups.value || this.hitPopups >= 64) return;
        this.hitPopups++;

        const label = new Label3D({ text: String(hitScore), font: FONT.robotoMedium, fontSize: 32, pixelSize: 0.005, modulate: [1, 1, 1, 1], outlineModulate: [0, 0, 0, 0], renderOrder: 7 });
        label.material.opacity = 0.47058824;
        this.spawnPopup(label.group, attempt.map.notes[index].x, () => {
            this.hitPopups--;
            label.dispose();
        });
    }

    spawnMissIcon(index) {
        const attempt = this.runner.attempt;
        if (!attempt.settings.MissPopups.value || this.missPopups >= 64) return;
        this.missPopups++;

        const size = 512 * 0.01 * 0.025;
        const icon = quad(size, size, basicMaterial({ map: this.skinManager.skin.textures.missFeedbackImage, side: THREE.DoubleSide }));
        icon.renderOrder = 7;
        this.spawnPopup(icon, attempt.map.notes[index].x, () => {
            this.missPopups--;
            icon.geometry.dispose();
            icon.material.dispose();
        });
    }

    onSkipAvailable(attempt) {
        if (this.runner.objectIndicesStart.Note >= attempt.map.notes.length) this.skip.text = 'Press Space to complete';
        if (this.skipTween) return;

        // looping sine tween 0.25 <-> 0.75 alpha
        let killed = false;
        let current = null;
        const loop = (from, to) => {
            if (killed) return;
            current = tween((a) => this.skip.setAlpha(a), from, to, 0.75, { trans: Trans.SINE, onDone: () => loop(to, from) });
        };
        loop(this.skip.modulate[3], 0.25);
        current = current ?? null;
        this.skipTween = {
            kill() {
                killed = true;
                current?.kill();
            },
        };
    }

    // HudManager._Process + _PhysicsProcess of the components
    process(delta, attempt) {
        // Progress label
        this.progressLabel.text = `${formatTime(Math.max(0, attempt.progress) / 1000)} / ${formatTime(attempt.length / 1000)}`;

        // ProgressBar
        const width = Math.trunc(32 + (attempt.progress / attempt.length) * 1024);
        if (width !== this.lastProgressWidth) {
            this.lastProgressWidth = width;
            this.drawProgress(width);
        }

        // Skip
        if (this.skipTween && !attempt.canSkip) {
            this.skipTween.kill();
            this.skipTween = null;
            this.skip.setAlpha(0);
        }

        // HealthBar._PhysicsProcess
        const k = delta * clamp(attempt.settings.HPLerpValue.value, 10, 100);
        const nextHealth = lerp(this.healthCurrent, this.healthTarget, Math.min(1, k));
        if (Math.abs(nextHealth - this.healthCurrent) > 0.01 || this.healthDeadDrawn !== this.healthDead) {
            this.healthCurrent = nextHealth;
            this.healthDeadDrawn = this.healthDead;
            this.drawHealth();
        }

        // PanelLeft._PhysicsProcess
        const prevProgress = this.multiplierProgress;
        const prevColor = this.multiplierColor;
        this.multiplierProgress = lerp(this.multiplierProgress, this.multiplierTarget, Math.min(1, delta * 16));
        this.multiplierColor = colorLerp(this.multiplierColor, this.multiplierTargetColor, Math.min(1, delta * 2));
        if (Math.abs(prevProgress - this.multiplierProgress) > 0.0005 || Math.abs(prevColor.g - this.multiplierColor.g) > 0.001) {
            this.drawPanelLeft(attempt);
        }

        // PanelRight._PhysicsProcess
        let redrawRight = false;
        if (this.hitOpacity > 0.62) {
            this.hitOpacity = moveToward(this.hitOpacity, 0.62, delta * 1.5);
            redrawRight = true;
        }
        if (this.missOpacity > 0.62) {
            this.missOpacity = moveToward(this.missOpacity, 0.62, delta * 1.5);
            redrawRight = true;
        }
        if (redrawRight) this.drawPanelRight(attempt);

        this.health.flush();
        this.progressBar.flush();
        this.panelLeft.flush();
        this.panelRight.flush();
    }
}
