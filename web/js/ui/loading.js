// Port of scripts/scenes/Loading.cs + scenes/loading.tscn (uv_split splash, progress bar, spectrum)

import { Ease, Trans, tween } from '../util.js';
import { el } from './common.js';
import { AudioSpectrum } from './jukebox.js';

export class LoadingScene {
    constructor(app) {
        this.app = app;
        this.name = 'SceneLoading';
        this.element = el('div', 'scene scene-loading');
        this.background = el('div', 'background', this.element);
        const splash = el('div', 'splash', this.element);
        this.canvas = el('canvas', '', splash);
        this.label = el('div', 'progress-label', this.element, 'Initializing maps');
        this.bar = el('div', 'progress-bar', this.element);
        this.fill = el('div', 'fill', this.bar);
        const spectrumCanvas = el('canvas', '', this.element);
        spectrumCanvas.style.cssText = 'position:absolute;left:8px;right:8px;top:calc(80% + 8px);bottom:8px;width:calc(100% - 16px);height:calc(20% - 16px)';
        this.spectrum = new AudioSpectrum(spectrumCanvas, {
            maxFreq: 10500,
            barSize: 6,
            barGap: 4,
            rest: 'rgba(255,202,205,0.093)',
            played: 'rgba(201,0,69,0.125)',
        });
        this.shift = 0;
        this.image = new Image();
        this.image.src = '../textures/boot_splash.png';
    }

    async load() {
        this.shift = 0;
        // no updater in the browser build: go straight to the map initialisation step
        await this.app.mapManager.initializedPromise;
        this.label.textContent = 'Done!';
        this.fill.style.width = '100%';

        const bg = { r: 0, g: 0, b: 0 };
        tween(
            (c) => (this.background.style.background = `rgb(${c.r}, ${c.g}, ${c.b})`),
            bg,
            { r: 6, g: 5, b: 9 },
            1,
            { trans: Trans.QUAD },
        );
        tween((a) => (this.label.style.opacity = a), 0, 1, 0.5, { trans: Trans.QUAD });
        tween((a) => (this.bar.style.opacity = a), 0, 1, 0.5, { trans: Trans.QUAD });
        tween((s) => (this.shift = s), 0.2, 1.0, 1.5, {
            trans: Trans.QUINT,
            ease: Ease.OUT,
            onDone: () => {
                tween((c) => (this.background.style.background = `rgb(${c.r}, ${c.g}, ${c.b})`), { r: 6, g: 5, b: 9 }, bg, 0.25, {
                    trans: Trans.QUAD,
                    onDone: () => this.app.sceneManager.load('menu'),
                });
            },
        });
    }

    unload() {}

    // uv_split.gdshader: pixels left of `split` sample further left, the rest further right, clamped at the edges
    drawSplash() {
        const img = this.image;
        const c = this.canvas;
        const w = c.clientWidth;
        const h = c.clientHeight;
        if (!img.complete || !img.naturalWidth || w === 0) return;
        const pr = Math.min(window.devicePixelRatio || 1, 2);
        if (c.width !== Math.round(w * pr)) {
            c.width = Math.round(w * pr);
            c.height = Math.round(h * pr);
        }
        const ctx = c.getContext('2d');
        ctx.setTransform(pr, 0, 0, pr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        // keep aspect centred
        const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        const dx = (w - dw) / 2;
        const dy = (h - dh) / 2;
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        const split = 0.4;
        const d = (1 - this.shift) / 2;

        const drawPart = (u0, u1, offset) => {
            // destination uv range [u0, u1] samples uv + offset
            let s0 = u0 + offset;
            let s1 = u1 + offset;
            let x0 = u0;
            let x1 = u1;
            if (s0 < 0) {
                // clamp-to-edge: stretch the first column over the out of range part
                const cut = Math.min(x1, x0 - s0);
                ctx.drawImage(img, 0, 0, 1, ih, dx + x0 * dw, dy, (cut - x0) * dw, dh);
                x0 = cut;
                s0 = 0;
            }
            if (s1 > 1) {
                const cut = Math.max(x0, x1 - (s1 - 1));
                ctx.drawImage(img, iw - 1, 0, 1, ih, dx + cut * dw, dy, (x1 - cut) * dw, dh);
                x1 = cut;
                s1 = 1;
            }
            if (x1 > x0 && s1 > s0) ctx.drawImage(img, s0 * iw, 0, (s1 - s0) * iw, ih, dx + x0 * dw, dy, (x1 - x0) * dw, dh);
        };
        drawPart(0, split, -d);
        drawPart(split, 1, d);
    }

    update(delta) {
        this.drawSplash();
        this.spectrum.update(delta);
    }

    render(backend) {
        backend.renderer.setRenderTarget(null);
        backend.renderer.setClearColor(0x000000, 1);
        backend.renderer.clear();
    }
}
