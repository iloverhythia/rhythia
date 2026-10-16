// Port of scripts/ui/menu/play/MapList.cs, MapButton.cs, MapButtonWide.cs, MapButtonSquare.cs

import { DIFFICULTY_COLORS } from '../constants.js';
import { Emitter, Trans, clamp, escapeHtml, formatTime, inverseLerp, lerp, tween } from '../util.js';
import { el } from './common.js';

const SPACING = 10;
const WIDE = { min: 90, hover: 10, select: 20 };
const SQUARE = { min: 140, hover: 10, select: 10 };
const SCROLL_STEP = 1500;
const SCROLL_FRICTION = 20;
const SCROLL_ELASTICITY = 0.02;

const diffHex = (d) => DIFFICULTY_COLORS[d]?.slice(0, 7) ?? '#ffffff';

function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1, 7), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// outline.gdshader as layered CSS backgrounds (top layer first)
function outlineBackground(rect, fill, cursor, light, base = '#0d0d0d', cursorColor = 'rgba(38,38,38,1)') {
    const layers = [];
    if (light) {
        const lx = light.x - rect.left;
        const ly = light.y - rect.top;
        // pow(clamp((350 - d) / 350, 0, 1), 2)
        const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => `rgba(201,0,69,${(1 - t) ** 2}) ${t * 350}px`).join(', ');
        layers.push(`radial-gradient(circle 350px at ${lx}px ${ly}px, ${stops})`);
    }
    if (fill > 0) {
        const stops = [];
        for (let i = 0; i <= 10; i++) {
            const x = i / 10;
            stops.push(`rgba(201,0,69,${clamp(1 - x + 2 * (fill - 0.5), 0, 1)}) ${x * 100}%`);
        }
        layers.push(`linear-gradient(to right, ${stops.join(', ')})`);
    }
    if (cursor) {
        const cx = cursor.x - rect.left;
        const cy = cursor.y - rect.top;
        layers.push(`radial-gradient(circle 350px at ${cx}px ${cy}px, ${cursorColor} 0, rgba(38,38,38,0) 350px)`);
    }
    layers.push(`linear-gradient(${base}, ${base})`);
    return layers.join(', ');
}

export { outlineBackground };

class MapButtonWide {
    constructor(list) {
        this.list = list;
        this.root = el('div', 'map-button-wide');
        this.holder = el('div', 'holder', this.root);
        this.outline = el('div', 'outline', this.holder);
        this.cover = el('div', 'cover', this.holder);
        this.favorited = el('div', 'favorited', this.holder);
        this.title = el('div', 'title', this.holder);
        el('div', 'separator', this.holder);
        this.extra = el('div', 'extra', this.holder);
        this.hit = el('button', 'hit', this.holder);
        this.outlineFill = 0;
        this.outlineTarget = 0;
        this.stickout = 0;
        this.minH = WIDE.min;
        this.hovered = false;
        this.selected = false;
        this.bind();
    }

    bind() {
        this.hit.addEventListener('mouseenter', () => this.list.buttonHovered(this, true));
        this.hit.addEventListener('mouseleave', () => this.list.buttonHovered(this, false));
        this.hit.addEventListener('click', (e) => {
            if (e.button === 0) this.list.buttonClicked(this);
        });
    }

    async setMap(map, index) {
        this.map = map;
        this.index = index;
        this.title.innerHTML = `<span>${escapeHtml(map.prettyTitle)}</span>`;
        this.extra.innerHTML =
            `<span>${formatTime(map.length / 1000)} — <span style="color:${diffHex(map.difficulty)}">${escapeHtml(map.difficultyName)}</span> ` +
            `by <span style="color:#b0b0b0">${escapeHtml(map.prettyMappers)}</span></span>`;
        this.favorited.style.display = map.favorite ? 'block' : 'none';
        const tint = diffHex(map.difficulty);
        this.favorited.style.background = tint;
        this.favorited.style.webkitMask = `url("${this.list.skinUrl('favoriteImage')}") center / contain no-repeat`;
        this.favorited.style.mask = this.favorited.style.webkitMask;
        this.cover.style.backgroundImage = '';
        const url = await this.list.mapManager.getCoverUrl(map);
        if (this.map === map && url) this.cover.style.backgroundImage = `url("${url}")`;
    }

    setSelected(selected) {
        this.selected = selected;
        this.outlineTarget = selected ? 1 : this.hovered ? 0.5 : 0;
        this.root.classList.toggle('selected', selected);
    }

    setHovered(h) {
        this.hovered = h;
        this.root.classList.toggle('hovered', h);
        if (!this.selected) this.outlineTarget = h ? 0.5 : 0;
    }

    targetHeight() {
        return WIDE.min + (this.hovered ? WIDE.hover : 0) + (this.selected ? WIDE.select : 0);
    }

    update(delta, centreY, listH, width, now, cursor, light) {
        this.outlineFill = lerp(this.outlineFill, this.outlineTarget, Math.min(1, 10 * delta));
        this.stickout = lerp(this.stickout, this.selected ? 0.05 : 0, Math.min(1, 16 * delta));
        this.minH = lerp(this.minH, this.targetHeight(), Math.min(1, 16 * delta));
        const d = Math.abs(centreY - listH / 2) / (listH / 2 + WIDE.min / 2);
        const c = Math.cos((Math.PI * Math.min(d, 1)) / 2);
        const anchorLeft = 0.1 - c / 20 - this.stickout;
        this.holderLeft = anchorLeft * width;
        this.holder.style.left = `${this.holderLeft}px`;

        if (this.map?.favorite) {
            const ms = now;
            const rot = this.index * -10 + ms / 20;
            const alpha = (225 + 30 * Math.sin((Math.PI * ms) / 2000 + this.index)) / 255;
            this.favorited.style.transform = `rotate(${rot}deg)`;
            this.favorited.style.opacity = alpha;
        }

        const rect = { left: this.listRectLeft + this.holderLeft, top: this.absTop };
        this.outline.style.background = outlineBackground(rect, this.outlineFill, cursor, light);
    }
}

class MapButtonSquare {
    constructor(list) {
        this.list = list;
        this.root = el('div', 'map-button-square');
        this.holder = el('div', 'holder', this.root);
        this.coverBg = el('div', 'cover-bg', this.holder);
        this.cover = el('div', 'cover', this.holder);
        this.favorited = el('div', 'favorited', this.holder);
        this.title = el('div', 'title', this.holder);
        el('div', 'sep2', this.holder);
        this.length = el('div', 'length', this.holder);
        this.difficulty = el('div', 'difficulty', this.holder);
        el('div', 'sep1', this.holder);
        this.author = el('div', 'author', this.holder);
        el('div', 'sq-outline', this.holder);
        this.hit = el('button', 'hit', this.holder);
        this.size = 0;
        this.minH = SQUARE.min;
        this.hovered = false;
        this.selected = false;
        MapButtonWide.prototype.bind.call(this);
    }

    async setMap(map, index) {
        this.map = map;
        this.index = index;
        const tint = diffHex(map.difficulty);
        this.title.textContent = map.prettyTitle;
        this.length.textContent = formatTime(map.length / 1000);
        this.difficulty.textContent = map.difficultyName;
        this.difficulty.style.color = tint;
        this.author.textContent = map.prettyMappers;
        this.favorited.style.display = map.favorite ? 'block' : 'none';
        this.favorited.style.background = tint;
        const favMask = `url("${this.list.skinUrl('favoriteImage')}") center / contain no-repeat`;
        this.favorited.style.webkitMask = favMask;
        this.favorited.style.mask = favMask;
        this.coverBg.style.backgroundImage = `url("${this.list.skinUrl('mapListGridCoverBackgroundImage')}")`;
        this.coverBg.style.backgroundColor = tint;
        this.coverBg.style.backgroundBlendMode = 'multiply';
        const bgMask = `url("${this.list.skinUrl('mapListGridCoverBackgroundImage')}") center / 100% 100% no-repeat`;
        this.coverBg.style.webkitMask = bgMask;
        this.coverBg.style.mask = bgMask;
        this.cover.style.backgroundImage = '';
        const url = await this.list.mapManager.getCoverUrl(map);
        if (this.map === map && url) this.cover.style.backgroundImage = `url("${url}")`;
    }

    setSelected(s) {
        this.selected = s;
        this.root.classList.toggle('selected', s);
    }

    setHovered(h) {
        this.hovered = h;
        this.root.classList.toggle('hovered', h);
    }

    update(delta, centreY, listH, width, now) {
        const target = (this.hovered ? SQUARE.hover : 0) + (this.selected ? SQUARE.select : 0);
        this.size = lerp(this.size, target, Math.min(1, 16 * delta));
        this.minH = SQUARE.min;
        const o = this.size / 2;
        this.holder.style.inset = `${-o}px`;
        if (this.map?.favorite) {
            this.favorited.style.transform = `rotate(${this.index * -10 + now / 20}deg)`;
            this.favorited.style.opacity = (225 + 30 * Math.sin((Math.PI * now) / 2000 + this.index)) / 255;
        }
    }
}

export class MapList extends Emitter {
    constructor(parent, app) {
        super();
        this.app = app;
        this.mapManager = app.mapManager;
        this.root = el('div', 'map-list theme', parent);

        this.scrollBar = el('div', 'scrollbar', this.root);
        this.track = this.threePiece(el('div', 'track', this.scrollBar), 'mapListScrollBarBackground');
        this.thumbHolder = el('div', 'thumb', this.scrollBar);
        this.thumb = this.threePiece(this.thumbHolder, 'mapListScrollBar');

        this.mask = el('div', 'mask', this.root);
        this.selectionCursor = el('div', 'selection-cursor', this.root);
        this.empty = el('div', 'empty-hint hidden', this.mask, 'No maps yet.<br>Drop .sspm / .phxm / .rhm / .txt files here or use Import.');

        this.layout = 'list';
        this.sorting = 'Alphabetical';
        this.ascending = true;
        this.search = '';
        this.author = '';
        this.maps = [];
        this.selectedMapID = null;
        this.scroll = 0;
        this.targetScroll = 0;
        this.momentum = 0;
        this.scrollLength = 0;
        this.dragScroll = false;
        this.mouseScroll = false;
        this.dragDistance = 0;
        this.lastMouseY = 0;
        this.mouse = { x: 0, y: 0 };
        this.rows = new Map(); // row index -> { el, buttons }
        this.pool = { list: [], grid: [] };
        this.hovered = null;
        this.cursorShown = false;
        this.cursorAlpha = 0;
        this.cursorPos = { x: -40, y: 0 };
        this.lightPosition = null;
        this.mapButtons = new Map();

        this.bindInput();
        this.updateSkin();
    }

    skinUrl(key) {
        return this.app.skinManager.url(key);
    }

    threePiece(parent, prefix) {
        const tp = el('div', 'three-piece', parent);
        tp.top = el('div', 'top', tp);
        tp.middle = el('div', 'middle', tp);
        tp.bottom = el('div', 'bottom', tp);
        tp.skinPrefix = prefix;
        return tp;
    }

    updateSkin() {
        for (const tp of [this.track, this.thumb]) {
            tp.top.style.backgroundImage = `url("${this.skinUrl(`${tp.skinPrefix}TopImage`)}")`;
            tp.middle.style.backgroundImage = `url("${this.skinUrl(`${tp.skinPrefix}MiddleImage`)}")`;
            tp.bottom.style.backgroundImage = `url("${this.skinUrl(`${tp.skinPrefix}BottomImage`)}")`;
        }
        const s = this.selectionCursor.style;
        s.background = '#ca0046';
        s.webkitMask = `url("${this.skinUrl('mapListSelectionCursorImage')}") center / contain no-repeat`;
        s.mask = s.webkitMask;
    }

    get cfg() {
        return this.layout === 'list' ? WIDE : SQUARE;
    }

    get perRow() {
        return this.layout === 'list' ? 1 : Math.max(1, Math.floor(this.root.clientWidth / (SQUARE.min + SPACING)));
    }

    // ---------------------------------------------------------------- input

    bindInput() {
        this.root.addEventListener(
            'wheel',
            (e) => {
                if (e.ctrlKey || e.altKey || e.shiftKey) return;
                e.preventDefault();
                e.stopPropagation();
                this.momentum += Math.sign(e.deltaY) * SCROLL_STEP;
            },
            { passive: false },
        );
        this.root.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                this.dragScroll = true;
                this.dragDistance = 0;
                this.lastMouseY = e.screenY;
            } else if (e.button === 2) {
                this.mouseScroll = true;
            }
        });
        this.root.addEventListener('contextmenu', (e) => e.preventDefault());
        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) this.dragScroll = false;
            if (e.button === 2) this.mouseScroll = false;
        });
        window.addEventListener('mousemove', (e) => {
            this.mouse = { x: e.clientX, y: e.clientY };
            if (this.dragScroll) {
                const d = (this.lastMouseY - e.screenY) * 30;
                this.momentum += d;
                this.dragDistance += Math.abs(d);
                this.lastMouseY = e.screenY;
            }
        });
        this.root.addEventListener('mouseleave', () => this.toggleSelectionCursor(false));
    }

    buttonHovered(button, hovered) {
        button.setHovered(hovered);
        if (hovered) {
            this.hovered = button;
            if (this.layout === 'list') this.toggleSelectionCursor(true);
        } else if (this.hovered === button) {
            this.hovered = null;
        }
    }

    buttonClicked(button) {
        if (this.dragDistance >= 500) return;
        this.select(button.map);
    }

    toggleSelectionCursor(show) {
        if (this.cursorShown === show) return;
        this.cursorShown = show;
        this.cursorTween?.kill();
        this.cursorTween = tween((a) => (this.cursorAlpha = a), this.cursorAlpha, show ? 1 : 0, 0.1, { trans: Trans.QUAD });
    }

    // ---------------------------------------------------------------- maps

    updateMaps() {
        const search = this.search.toLowerCase();
        const author = this.author.toLowerCase();
        let maps = this.mapManager.maps.filter(
            (m) => (m.prettyTitle ?? '').toLowerCase().includes(search) && (m.prettyMappers ?? '').toLowerCase().includes(author),
        );
        maps = this.sortMaps(maps);
        this.maps = maps;
        this.clear();
        this.empty.classList.toggle('hidden', this.mapManager.maps.length > 0);
    }

    sortMaps(maps) {
        const key =
            this.sorting === 'Difficulty'
                ? (m) => m.difficulty
                : this.sorting === 'Mappers'
                  ? (m) => [...(m.mappers ?? [m.prettyMappers])].sort()[0] ?? ''
                  : (m) => m.prettyTitle;
        const cmp = (a, b) => {
            const ka = key(a);
            const kb = key(b);
            return ka < kb ? -1 : ka > kb ? 1 : 0;
        };
        const group = (list) => {
            const sorted = [...list].sort(cmp);
            if (!this.ascending) sorted.reverse();
            return sorted;
        };
        return [...group(maps.filter((m) => m.favorite)), ...group(maps.filter((m) => !m.favorite))];
    }

    shuffle() {
        const maps = [...this.maps];
        for (let i = maps.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [maps[i], maps[j]] = [maps[j], maps[i]];
        }
        this.maps = maps;
        this.clear();
    }

    setLayout(layout) {
        this.layout = layout;
        this.clear();
    }

    clear() {
        for (const row of this.rows.values()) {
            for (const b of row.buttons) this.pool[b instanceof MapButtonWide ? 'list' : 'grid'].push(b);
            row.el.remove();
        }
        this.rows.clear();
        this.mapButtons.clear();
        this.hovered = null;
    }

    select(map, playIfPreSelected = true) {
        if (!map) return false;
        const changed = this.selectedMapID == null || this.selectedMapID !== map.name;

        if (changed) {
            this.emit('select', map);
        }

        if (!changed && playIfPreSelected) this.emit('play');

        this.selectedMapID = map.name;
        for (const b of this.mapButtons.values()) b.setSelected(b.map.name === map.name);
        this.focus(map);
        return changed;
    }

    focus(map) {
        const H = this.root.clientHeight;
        const index = this.maps.findIndex((m) => m.name === map.name);
        this.targetScroll = Math.floor(index / this.perRow) * (this.cfg.min + SPACING) + this.cfg.min / 2 - H / 2;
        this.emit('focus');
    }

    pickRandom() {
        if (this.maps.length === 0) return;
        this.select(this.maps[Math.floor(Math.random() * this.maps.length)], false);
    }

    acquire(kind) {
        const b = this.pool[kind].pop();
        if (b) return b;
        return kind === 'list' ? new MapButtonWide(this) : new MapButtonSquare(this);
    }

    // ---------------------------------------------------------------- _Process

    update(delta, now) {
        const H = this.root.clientHeight;
        const W = this.mask.clientWidth;
        if (H === 0) return;
        const cfg = this.cfg;
        const perRow = this.perRow;
        const rowCount = Math.ceil(this.maps.length / perRow);

        let elastic = 0;
        if ((this.targetScroll <= 0 && this.momentum < 0) || (this.targetScroll >= this.scrollLength && this.momentum > 0)) {
            elastic = this.momentum * SCROLL_ELASTICITY;
        }

        this.scrollLength = Math.max(0, Math.floor(this.maps.length / perRow) * (cfg.min + SPACING) - SPACING - H) + cfg.hover + cfg.select;
        if (this.layout === 'grid') this.scrollLength += cfg.min + cfg.hover + cfg.select;

        this.momentum = lerp(this.momentum, 0, Math.min(1, SCROLL_FRICTION * delta));

        const rect = this.root.getBoundingClientRect();
        if (this.mouseScroll) {
            const thumbH = this.thumbHolder.clientHeight;
            const t = inverseLerp(rect.top + thumbH / 2, rect.top + H - thumbH / 2, this.mouse.y);
            this.targetScroll = lerp(this.targetScroll, this.scrollLength * clamp(t, 0, 1), Math.min(1, 24 * delta));
        } else {
            this.targetScroll = clamp(this.targetScroll + this.momentum * delta, 0, this.scrollLength) + elastic;
        }

        this.scroll = lerp(this.scroll, this.targetScroll, Math.min(1, 12 * delta));

        const anchorTop = Math.max(0, (this.targetScroll - elastic) / (this.scrollLength + H));
        const anchorBottom = Math.min(1, anchorTop + H / (this.scrollLength + H));
        this.thumbHolder.style.top = `${anchorTop * 100}%`;
        this.thumbHolder.style.bottom = `${(1 - anchorBottom) * 100}%`;

        // visible rows
        const step = cfg.min + SPACING;
        const half = (cfg.min + cfg.hover + cfg.select) / 2;
        const first = Math.max(0, Math.floor((this.scroll - half - step) / step));
        const last = Math.min(rowCount - 1, Math.ceil((this.scroll + H + step) / step));
        const visible = new Set();
        for (let i = first; i <= last; i++) {
            const base = i * step - this.scroll + half;
            if (base + step < 0 || base - step > H) continue;
            visible.add(i);
        }

        // recycle rows that left the view
        for (const [i, row] of this.rows) {
            if (visible.has(i)) continue;
            for (const b of row.buttons) {
                this.mapButtons.delete(b.map.name);
                if (this.hovered === b) this.hovered = null;
                b.setHovered(false);
                this.pool[this.layout].push(b);
            }
            row.el.remove();
            this.rows.delete(i);
        }

        const kind = this.layout;
        for (const i of visible) {
            if (this.rows.has(i)) continue;
            const rowEl = el('div', 'row', this.mask);
            rowEl.style.gap = `${SPACING}px`;
            const buttons = [];
            for (let j = 0; j < perRow; j++) {
                const index = i * perRow + j;
                const map = this.maps[index];
                if (!map) break;
                const b = this.acquire(kind);
                b.setHovered(false);
                b.setMap(map, index);
                b.setSelected(map.name === this.selectedMapID);
                b.minH = cfg.min + (b.selected ? cfg.select : 0);
                if (kind === 'list') b.outlineFill = b.outlineTarget;
                rowEl.appendChild(b.root);
                buttons.push(b);
                this.mapButtons.set(map.name, b);
            }
            this.rows.set(i, { el: rowEl, buttons });
        }

        // layout: rows grow symmetrically around their centre
        const sorted = [...this.rows.keys()].sort((a, b) => a - b);
        const extra = sorted.map((i) => {
            const row = this.rows.get(i);
            return Math.max(0, ...row.buttons.map((b) => (kind === 'list' ? b.minH : SQUARE.min + b.size) - cfg.min));
        });
        const total = extra.reduce((a, b) => a + b, 0);
        let above = 0;
        const light = this.layout === 'list' ? { x: rect.left + this.cursorPos.x + 20, y: rect.top + this.cursorPos.y + 20 } : null;
        sorted.forEach((i, k) => {
            const row = this.rows.get(i);
            const below = total - above - extra[k];
            const base = i * step - this.scroll + half;
            const centre = base + (above - below) / 2;
            const h = kind === 'list' ? cfg.min + extra[k] : cfg.min;
            row.el.style.top = `${centre - h / 2}px`;
            row.el.style.height = `${h}px`;
            row.el.style.zIndex = i === 0 || i === rowCount - 1 ? 1 : 0;
            row.centre = centre;
            for (const b of row.buttons) {
                if (kind === 'list') {
                    b.root.style.height = `${b.minH}px`;
                    b.listRectLeft = rect.left;
                    b.absTop = rect.top + centre - b.minH / 2;
                }
                b.update(delta, centre, H, W, now, this.mouse, light);
            }
            above += extra[k];
        });

        // selection cursor
        let tx = -80;
        let ty = this.cursorPos.y;
        if (this.cursorShown && this.hovered && kind === 'list') {
            const row = [...this.rows.values()].find((r) => r.buttons.includes(this.hovered));
            if (row) {
                tx = this.hovered.holderLeft - 60;
                ty = clamp(row.centre - 20, 0, H);
            }
        } else if (this.cursorShown) {
            tx = this.cursorPos.x;
        }
        this.cursorPos.x = lerp(this.cursorPos.x, tx, Math.min(1, 8 * delta));
        this.cursorPos.y = lerp(this.cursorPos.y, ty, Math.min(1, 8 * delta));
        const cs = this.selectionCursor.style;
        cs.left = `${this.cursorPos.x}px`;
        cs.top = `${this.cursorPos.y}px`;
        cs.transform = `rotate(${-this.cursorPos.y / 60}rad)`;
        cs.opacity = this.cursorAlpha;
    }
}

export { hexToRgba };
