// Ports of scripts/util/*.cs plus small engine helpers that Godot provided for free
// (tweens, vector math, colour parsing, hashing).

export const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inverseLerp = (a, b, v) => (a === b ? 0 : (v - a) / (b - a));
export const moveToward = (from, to, delta) => (Math.abs(to - from) <= delta ? to : from + Math.sign(to - from) * delta);
export const degToRad = (d) => (d * Math.PI) / 180;
// Mathf.AngleDifference
export function angleDifference(from, to) {
    const tau = Math.PI * 2;
    const difference = (to - from) % tau;
    return ((2 * difference) % tau) - difference;
}
export const EPSILON = 0.00001;

export const vec2 = (x = 0, y = 0) => ({ x, y });
export const v2clamp = (v, b) => ({ x: clamp(v.x, -b.x, b.x), y: clamp(v.y, -b.y, b.y) });
export const v2lerp = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
export const v2len = (v) => Math.hypot(v.x, v.y);
export const v2dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const v2eq = (a, b) => a.x === b.x && a.y === b.y;
export const v2finite = (v) => Number.isFinite(v.x) && Number.isFinite(v.y);

// float32 rounding, the C# code works on floats in a lot of places
const f32 = new Float32Array(1);
export const toFloat = (v) => {
    f32[0] = v;
    return f32[0];
};

// ---------------------------------------------------------------- Util.String

export function formatTime(seconds, padMinutes = false) {
    const negative = seconds < 0;
    const minutes = Math.floor(Math.abs(seconds) / 60);
    const secs = Math.floor(Math.abs(seconds) % 60);
    return `${negative ? '-' : ''}${padMinutes ? String(minutes).padStart(2, '0') : minutes}:${String(secs).padStart(2, '0')}`;
}

export function padMagnitude(value) {
    return Math.round(Number(value)).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function formatUnixTimePretty(now, time) {
    const difference = now - time;
    const prefix = difference < 0 ? 'in ' : '';
    const suffix = difference > 0 ? ' ago' : '';
    const seconds = Math.floor(difference);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    let formatted;

    if (days > 0) formatted = `${padMagnitude(days)} day` + (days > 1 ? 's' : '');
    else if (hours > 0) formatted = `${padMagnitude(hours)} hour` + (hours > 1 ? 's' : '');
    else if (minutes > 0) formatted = `${padMagnitude(minutes)} minute` + (minutes > 1 ? 's' : '');
    else if (seconds > 0) formatted = `${padMagnitude(seconds)} second` + (seconds > 1 ? 's' : '');
    else formatted = 'just now';

    return `${prefix}${formatted}${suffix}`;
}

export function sanitizeZalgo(input, limit = 3) {
    return (input ?? '').replace(new RegExp(`(\\p{M}){${limit + 1},}`, 'gu'), '$1');
}

export function stripEscapes(s) {
    // Godot String.StripEscapes removes control characters
    return (s ?? '').replace(/[\x00-\x1f]/g, '');
}

export function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------------------------------------------------------------- Util.Misc

export function binarySearch(values, time) {
    let left = 0;
    let right = values.length;

    while (left < right) {
        const middle = (left + right) >> 1;
        if (time < values[middle]) right = middle;
        else left = middle + 1;
    }

    return left - 1;
}

// Godot Color.FromHtml: #rgb, #rgba, #rrggbb, #rrggbbaa
export function parseColor(hex, fallback = { r: 1, g: 1, b: 1, a: 1 }) {
    if (hex == null || String(hex).trim() === '') return fallback;
    let h = String(hex).trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]+$/.test(h)) return fallback;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return fallback;
    const n = (i) => parseInt(h.substr(i, 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
}

export const colorLerp = (a, b, t) => ({ r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t), a: lerp(a.a, b.a, t) });
export const colorCss = (c, alpha = c.a) =>
    `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;

// ---------------------------------------------------------------- FileParser (scripts/util/FileParser.cs)

const utf8 = new TextDecoder('utf-8');
const utf8enc = new TextEncoder();

export class EndOfStreamError extends Error {}

export class FileParser {
    constructor(buffer) {
        this.buffer = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer ?? []);
        this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
        this.pointer = 0;
        this.length = this.buffer.byteLength;
    }

    checkBounds(amount) {
        if (this.pointer + amount > this.length) {
            throw new EndOfStreamError(`Attempted to read ${amount} bytes beyond stream length of ${this.length}.`);
        }
    }

    get(length) {
        this.checkBounds(length);
        this.pointer += length;
        return this.buffer.slice(this.pointer - length, this.pointer);
    }

    skip(length) {
        this.pointer += length;
    }

    seek(pointer) {
        this.pointer = pointer;
    }

    getString(length) {
        this.checkBounds(length);
        this.pointer += length;
        return utf8.decode(this.buffer.subarray(this.pointer - length, this.pointer));
    }

    getLine() {
        const start = this.pointer;
        while (this.pointer < this.length) {
            this.pointer++;
            if (this.buffer[this.pointer - 1] === 0x0a) {
                return utf8.decode(this.buffer.subarray(start, this.pointer - 1));
            }
        }
        return utf8.decode(this.buffer.subarray(start, this.pointer));
    }

    getBool() {
        this.checkBounds(1);
        return this.buffer[this.pointer++] !== 0;
    }

    getFloat() {
        this.checkBounds(4);
        this.pointer += 4;
        return this.view.getFloat32(this.pointer - 4, true);
    }

    getDouble() {
        this.checkBounds(8);
        this.pointer += 8;
        return this.view.getFloat64(this.pointer - 8, true);
    }

    getUInt8() {
        return this.get(1)[0];
    }

    getUInt16() {
        this.checkBounds(2);
        this.pointer += 2;
        return this.view.getUint16(this.pointer - 2, true);
    }

    getUInt32() {
        this.checkBounds(4);
        this.pointer += 4;
        return this.view.getUint32(this.pointer - 4, true);
    }

    getUInt64() {
        this.checkBounds(8);
        this.pointer += 8;
        return Number(this.view.getBigUint64(this.pointer - 8, true));
    }
}

// Little-endian growable writer, mirrors Godot FileAccess / BinaryWriter usage
export class BinaryWriter {
    constructor(capacity = 1024) {
        this.bytes = new Uint8Array(capacity);
        this.view = new DataView(this.bytes.buffer);
        this.position = 0;
        this.length = 0;
    }

    ensure(n) {
        if (this.position + n <= this.bytes.length) return;
        let cap = this.bytes.length * 2;
        while (cap < this.position + n) cap *= 2;
        const next = new Uint8Array(cap);
        next.set(this.bytes);
        this.bytes = next;
        this.view = new DataView(next.buffer);
    }

    advance(n) {
        this.position += n;
        this.length = Math.max(this.length, this.position);
    }

    seek(p) {
        this.position = p;
    }

    u8(v) {
        this.ensure(1);
        this.view.setUint8(this.position, v & 0xff);
        this.advance(1);
    }

    u32(v) {
        this.ensure(4);
        this.view.setUint32(this.position, v >>> 0, true);
        this.advance(4);
    }

    i32(v) {
        this.ensure(4);
        this.view.setInt32(this.position, v | 0, true);
        this.advance(4);
    }

    u64(v) {
        this.ensure(8);
        this.view.setBigUint64(this.position, BigInt(Math.max(0, Math.floor(v))), true);
        this.advance(8);
    }

    f32(v) {
        this.ensure(4);
        this.view.setFloat32(this.position, v, true);
        this.advance(4);
    }

    f64(v) {
        this.ensure(8);
        this.view.setFloat64(this.position, v, true);
        this.advance(8);
    }

    raw(arr) {
        this.ensure(arr.length);
        this.bytes.set(arr, this.position);
        this.advance(arr.length);
    }

    // Godot FileAccess.StoreString writes UTF-8 without a length prefix
    string(s) {
        this.raw(utf8enc.encode(s));
    }

    toUint8Array() {
        return this.bytes.slice(0, this.length);
    }
}

export const encodeUtf8 = (s) => utf8enc.encode(s);
export const decodeUtf8 = (b) => utf8.decode(b);

// ---------------------------------------------------------------- SHA-256 (synchronous, works without a secure context)

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
    0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
    0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
    0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
    0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const bitLen = bytes.length * 8;
    const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const pv = new DataView(padded.buffer);
    pv.setUint32(padded.length - 4, bitLen >>> 0, false);
    pv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);

    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));

    for (let off = 0; off < padded.length; off += 64) {
        for (let i = 0; i < 16; i++) W[i] = pv.getUint32(off + i * 4, false);
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
            const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
            W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
        }
        let [a, b, c, d, e, f, g, h] = H;
        for (let i = 0; i < 64; i++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) | 0;
            h = g;
            g = f;
            f = e;
            e = (d + t1) | 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) | 0;
        }
        H[0] += a;
        H[1] += b;
        H[2] += c;
        H[3] += d;
        H[4] += e;
        H[5] += f;
        H[6] += g;
        H[7] += h;
    }

    const out = new Uint8Array(32);
    const ov = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i], false);
    return out;
}

export const bytesEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
export const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

// ---------------------------------------------------------------- Tweens (Godot Tween equivalents)

export const Trans = { LINEAR: 'linear', SINE: 'sine', QUAD: 'quad', QUART: 'quart', QUINT: 'quint', EXPO: 'expo', CUBIC: 'cubic' };
export const Ease = { IN: 'in', OUT: 'out', IN_OUT: 'in_out' };

const easeIn = {
    linear: (t) => t,
    sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
    quad: (t) => t * t,
    cubic: (t) => t * t * t,
    quart: (t) => t ** 4,
    quint: (t) => t ** 5,
    expo: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
};

export function ease(t, trans = Trans.LINEAR, mode = Ease.IN_OUT) {
    const f = easeIn[trans] ?? easeIn.linear;
    if (mode === Ease.IN) return f(t);
    if (mode === Ease.OUT) return 1 - f(1 - t);
    return t < 0.5 ? f(t * 2) / 2 : 1 - f((1 - t) * 2) / 2;
}

const activeTweens = new Set();

// tween(setter, from, to, seconds, {trans, ease, delay, onDone}) -> handle with kill()
export function tween(setter, from, to, duration, opts = {}) {
    const t = {
        setter,
        from,
        to,
        duration: Math.max(0, duration),
        trans: opts.trans ?? Trans.LINEAR,
        ease: opts.ease ?? Ease.IN_OUT,
        delay: opts.delay ?? 0,
        elapsed: 0,
        onDone: opts.onDone,
        loops: opts.loops ?? 1,
        dead: false,
        kill() {
            this.dead = true;
            activeTweens.delete(this);
        },
    };
    activeTweens.add(t);
    if (t.duration === 0 && t.delay === 0) stepTween(t, 0);
    return t;
}

function interp(from, to, k) {
    if (typeof from === 'number') return lerp(from, to, k);
    const out = {};
    for (const key in from) out[key] = lerp(from[key], to[key], k);
    return out;
}

function stepTween(t, dt) {
    if (t.dead) return;
    if (t.delay > 0) {
        t.delay -= dt;
        if (t.delay > 0) return;
        dt = -t.delay;
        t.delay = 0;
    }
    t.elapsed += dt;
    const k = t.duration === 0 ? 1 : Math.min(1, t.elapsed / t.duration);
    t.setter(interp(t.from, t.to, ease(k, t.trans, t.ease)));
    if (k >= 1) {
        activeTweens.delete(t);
        t.dead = true;
        t.onDone?.();
    }
}

export function updateTweens(dt) {
    for (const t of [...activeTweens]) stepTween(t, dt);
}

// sequence of tween steps, like chained Godot tween calls. steps: functions returning a tween or null, or numbers (wait)
export function sequence(steps, { loops = 1 } = {}) {
    let killed = false;
    let current = null;
    let loop = 0;
    const run = (i) => {
        if (killed) return;
        if (i >= steps.length) {
            loop++;
            if (loops === 0 || loop < loops) run(0);
            return;
        }
        const step = steps[i];
        if (typeof step === 'number') {
            current = tween(() => {}, 0, 1, step, { onDone: () => run(i + 1) });
        } else {
            const res = step();
            if (res && res.onDone === undefined && typeof res.kill === 'function') {
                current = res;
                res.onDone = () => run(i + 1);
            } else {
                run(i + 1);
            }
        }
    };
    run(0);
    return {
        kill() {
            killed = true;
            current?.kill();
        },
    };
}

// ---------------------------------------------------------------- misc

export function downloadBytes(bytes, filename, type = 'application/octet-stream') {
    const blob = new Blob([bytes], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export function pickFiles({ accept = '', multiple = true } = {}) {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.multiple = multiple;
        input.style.display = 'none';
        input.addEventListener('change', () => {
            resolve([...input.files]);
            input.remove();
        });
        input.addEventListener('cancel', () => {
            resolve([]);
            input.remove();
        });
        document.body.appendChild(input);
        input.click();
    });
}

export function extOf(name) {
    const i = name.lastIndexOf('.');
    return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export function baseName(name) {
    const file = name.split(/[\\/]/).pop();
    const i = file.lastIndexOf('.');
    return i <= 0 ? file : file.slice(0, i);
}

export function randomInt(min, maxExclusive) {
    return Math.floor(Math.random() * (maxExclusive - min)) + min;
}

// Simple event emitter used in place of Godot signals / C# events
export class Emitter {
    constructor() {
        this.listeners = new Map();
    }
    on(name, fn) {
        if (!this.listeners.has(name)) this.listeners.set(name, new Set());
        this.listeners.get(name).add(fn);
        return () => this.off(name, fn);
    }
    off(name, fn) {
        this.listeners.get(name)?.delete(fn);
    }
    removeAllListeners() {
        this.listeners.clear();
    }
    emit(name, ...args) {
        for (const fn of [...(this.listeners.get(name) ?? [])]) fn(...args);
    }
}
