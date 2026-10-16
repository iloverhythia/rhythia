// Ports of scripts/ui/ToastNotification.cs, OptionPopup.cs, LinkPopupButton.cs, MenuCursor.cs, FPSCounter.cs
// and the Volume / Offset overlays driven by SoundManager.cs

import { Ease, Trans, escapeHtml, tween } from '../util.js';

export function el(tag, cls = '', parent = null, html = null) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    parent?.appendChild(e);
    return e;
}

export function button(text, cls = 'btn', parent = null, onClick = null, icon = null) {
    const b = el('button', cls, parent);
    if (icon) {
        const img = el('img', '', b);
        img.src = icon;
        img.draggable = false;
    }
    if (text) b.append(document.createTextNode(text));
    if (onClick) b.addEventListener('click', onClick);
    return b;
}

// ---------------------------------------------------------------- ToastNotification

const toasts = [];
let toastChain = Promise.resolve();
const measureCanvas = document.createElement('canvas').getContext('2d');

function wrapToast(message) {
    measureCanvas.font = '14px "Ubuntu Regular"';
    const words = String(message).split(' ');
    let out = '';
    let line = '';
    for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (measureCanvas.measureText(test).width > 500 && line) {
            out += `${line}\n`;
            line = w;
        } else {
            line = test;
        }
    }
    return out + line;
}

const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
const tweenP = (setter, from, to, d, opts = {}) => new Promise((resolve) => tween(setter, from, to, d, { ...opts, onDone: resolve }));

export function notify(message, severity = 0) {
    const toast = el('div', 'toast');
    const strip = el('div', 'severity', toast);
    strip.style.background = severity === 0 ? '#00ff00' : severity === 1 ? '#ffff00' : '#ff0000';
    el('div', 'label', toast).textContent = wrapToast(message);
    toast.style.left = `${window.innerWidth}px`;
    toast.style.top = `${window.innerHeight}px`;
    document.body.appendChild(toast);

    const rect = toast.getBoundingClientRect();
    const h = rect.height;
    const w = rect.width;
    const state = { x: window.innerWidth, y: window.innerHeight - (h + 8), el: toast };
    toast.style.top = `${state.y}px`;

    // tweens are queued one after another like the original
    toastChain = toastChain.then(async () => {
        await Promise.all(
            toasts.map((t) =>
                tweenP(
                    (y) => {
                        t.y = y;
                        t.el.style.top = `${y}px`;
                    },
                    t.y,
                    t.y - (h + 8),
                    0.15,
                    { trans: Trans.QUAD },
                ),
            ),
        );
        toasts.push(state);
        await tweenP((x) => (toast.style.left = `${x}px`), state.x, state.x - (w + 8), 0.8, { trans: Trans.QUAD, ease: Ease.OUT });
        state.x -= w + 8;
    });

    (async () => {
        await toastChain;
        await wait(4);
        await tweenP((x) => (toast.style.left = `${x}px`), state.x, state.x + w + 8, 0.8, { trans: Trans.QUAD, ease: Ease.IN });
        toast.remove();
        const i = toasts.indexOf(state);
        if (i >= 0) toasts.splice(i, 1);
    })();
}

// ---------------------------------------------------------------- OptionPopup

export class OptionPopup {
    constructor(header, infoHtml) {
        this.shown = false;
        this.root = el('div', 'popup hidden');
        el('div', 'bg', this.root);
        const hide = el('button', 'hide', this.root);
        hide.addEventListener('mousedown', () => this.hide());
        hide.addEventListener('contextmenu', (e) => e.preventDefault());
        const holder = el('div', 'holder', this.root);
        el('div', 'header', holder).textContent = header;
        this.info = el('div', 'info', holder);
        this.info.innerHTML = infoHtml;
        this.buttons = el('div', 'buttons', holder);
        this.onCanceled = null;
        document.body.appendChild(this.root);
        OptionPopup.all.add(this);
    }

    addOption(text, callback, tooltip = '') {
        const b = button(text, 'btn', this.buttons, () => {
            this.hide(false);
            callback?.();
        });
        if (tooltip) b.title = tooltip;
        b.dataset.activation = '';
        return b;
    }

    show(show = true) {
        this.shown = show;
        this.tween?.kill();
        if (show) this.root.classList.remove('hidden');
        const from = Number(this.root.style.opacity || 0);
        this.tween = tween((a) => (this.root.style.opacity = a), from, show ? 1 : 0, 0.1, {
            trans: Trans.QUAD,
            onDone: () => {
                if (!this.shown) this.root.classList.add('hidden');
            },
        });
    }

    hide(cancel = true) {
        if (!this.shown) return;
        this.show(false);
        if (cancel) this.onCanceled?.();
    }

    static anyShown() {
        return [...OptionPopup.all].some((p) => p.shown);
    }

    static hideTop() {
        const shown = [...OptionPopup.all].filter((p) => p.shown);
        if (shown.length) {
            shown[shown.length - 1].hide();
            return true;
        }
        return false;
    }
}
OptionPopup.all = new Set();

export const LINK_TEMPLATE = (url) =>
    `<span style="color:#dddddd">This will open the following link:</span>\n<span class="link">${escapeHtml(url)}</span>\n\n<span style="color:#dddddd">Are you sure?</span>`;

export function linkPopup(url) {
    const popup = new OptionPopup('Open Link', LINK_TEMPLATE(url));
    popup.addOption('Open', () => window.open(url, '_blank', 'noopener'), url);
    popup.addOption('Cancel', () => {});
    return popup;
}

export function linkPopupButton(target, url) {
    let popup = null;
    target.addEventListener('click', () => {
        popup ??= linkPopup(url);
        popup.show();
    });
}

// ---------------------------------------------------------------- Volume / Offset overlays

export class Overlays {
    constructor(app) {
        this.app = app;

        this.volume = el('div', 'volume-panel', document.body);
        el('div', 'bg', this.volume);
        this.volumeMain = el('div', 'main', this.volume);
        this.volumeLabel = el('div', 'label', this.volume, '50');
        this.labelBottom = 1;
        this.positionVolumeLabel();

        this.offset = el('div', 'volume-panel offset-panel', document.body);
        this.offsetLabel = el('div', 'label', this.offset, 'Local Offset: 0ms');

        this.volumeShown = false;
        this.offsetShown = false;
        this.lastVolumeChange = 0;
        this.lastOffsetChange = 0;

        this.fps = el('div', 'fps-counter', document.body, '0 FPS');
        this.frames = 0;
        this.fpsTime = 0;

        this.cursor = el('img', 'menu-cursor', document.body);
        this.cursorVisible = false;
        document.addEventListener('mousemove', (e) => this.moveCursor(e.clientX, e.clientY));
    }

    // Label anchor_bottom 2 (hidden: over the bar) <-> 0 (shown: above the bar)
    positionVolumeLabel() {
        // rect top = offset_top (-14), bottom = anchor_bottom * 6px; grow_vertical begin keeps the bottom fixed
        const bottom = 6 * this.labelBottom;
        const top = Math.min(-14, bottom - 25);
        this.volumeLabel.style.top = `${top}px`;
        this.volumeLabel.style.height = `${bottom - top}px`;
        this.volumeLabel.style.lineHeight = `${bottom - top}px`;
    }

    // SoundManager._UnhandledInput
    onWheel(e) {
        const settings = this.app.settingsManager.settings;
        const up = e.deltaY < 0;

        if (e.ctrlKey || e.altKey) {
            e.preventDefault();
            const master = Math.round(settings.VolumeMaster.value);
            settings.VolumeMaster.value = up ? Math.min(100, master + 5) : Math.max(0, master - 5);
            this.volumeLabel.textContent = String(settings.VolumeMaster.value);
            this.volumeTweens?.forEach((t) => t.kill());
            const fromBar = parseFloat(this.volumeMain.style.width) / 100 || 0;
            this.volumeTweens = [
                tween((a) => (this.volume.style.opacity = a), Number(this.volume.style.opacity || 0), 1, 0.25, { trans: Trans.QUAD }),
                tween((w) => (this.volumeMain.style.width = `${w * 100}%`), fromBar, settings.VolumeMaster.value / 100, 0.15, { trans: Trans.QUAD }),
                tween(
                    (b) => {
                        this.labelBottom = b;
                        this.positionVolumeLabel();
                    },
                    this.labelBottom,
                    0,
                    0.15,
                    { trans: Trans.QUAD },
                ),
            ];
            this.volumeShown = true;
            this.lastVolumeChange = performance.now();
            this.app.sound.updateVolume();
            return true;
        }

        if (e.shiftKey) {
            e.preventDefault();
            const offset = Math.round(settings.LocalOffset.value);
            settings.LocalOffset.value = up ? offset + 1 : offset - 1;
            this.offsetLabel.textContent = `Local Offset: ${settings.LocalOffset.value}ms`;
            this.offsetTween?.kill();
            this.offsetTween = tween((a) => (this.offset.style.opacity = a), Number(this.offset.style.opacity || 0), 1, 0.25, { trans: Trans.QUAD });
            this.offsetShown = true;
            this.lastOffsetChange = performance.now();
            return true;
        }
        return false;
    }

    update(delta) {
        const now = performance.now();
        if (this.volumeShown && now - this.lastVolumeChange >= 1000) {
            this.volumeShown = false;
            this.volumeTweens?.forEach((t) => t.kill());
            this.volumeTweens = [
                tween((a) => (this.volume.style.opacity = a), Number(this.volume.style.opacity || 0), 0, 0.25, { trans: Trans.QUAD }),
                tween(
                    (b) => {
                        this.labelBottom = b;
                        this.positionVolumeLabel();
                    },
                    this.labelBottom,
                    1,
                    0.35,
                    { trans: Trans.QUAD },
                ),
            ];
        }
        if (this.offsetShown && now - this.lastOffsetChange >= 1000) {
            this.offsetShown = false;
            this.offsetTween?.kill();
            this.offsetTween = tween((a) => (this.offset.style.opacity = a), Number(this.offset.style.opacity || 0), 0, 0.25, { trans: Trans.QUAD });
        }

        // FPSCounter
        this.frames++;
        this.fpsTime += delta;
        if (this.fpsTime >= 1) {
            this.fps.textContent = `${this.frames} FPS`;
            this.frames = 0;
            this.fpsTime -= 1;
        }
        this.fps.classList.toggle('hidden', !this.app.settingsManager.settings.DisplayFPS.value);
    }

    // MenuCursor
    updateCursorSkin(url, scale) {
        this.cursor.src = url;
        const size = 32 * scale;
        this.cursor.style.width = `${size}px`;
        this.cursor.style.height = `${size}px`;
        this.cursorSize = size;
    }

    updateVisible(visible) {
        this.cursorVisible = visible;
        this.cursor.style.display = visible ? 'block' : 'none';
        document.body.classList.toggle('menu-cursor-on', visible);
        document.documentElement.style.cursor = visible ? 'none' : '';
    }

    moveCursor(x, y) {
        if (!this.cursorVisible) return;
        const s = this.cursorSize ?? 32;
        this.cursor.style.transform = `translate(${x - s / 2}px, ${y - s / 2}px)`;
    }
}
