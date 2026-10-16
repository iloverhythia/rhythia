// Port of scripts/map/MapManager.cs + MapCache.cs (+ MapParser.Encode/BulkImport)
// The "maps folder" lives in IndexedDB: store `maps` holds cache rows, `mapfiles` holds the folder's files.

import { Storage } from '../storage.js';
import { Emitter, baseName, extOf } from '../util.js';
import { Map } from './map.js';
import { MapParseError, decodeFile, folderFiles, isValidExt, phxmFolder } from './parser.js';

const FILES = ['metadata.json', 'objects.phxmo', 'audio.mp3', 'audio.ogg', 'cover.png', 'video.mp4'];

class Bindable extends Emitter {
    constructor(value) {
        super();
        this._value = value;
    }
    get value() {
        return this._value;
    }
    set value(v) {
        const old = this._value;
        this._value = v;
        this.emit('changed', v, old);
    }
}

class MapManagerClass extends Emitter {
    constructor() {
        super();
        this.selected = new Bindable(null);
        this.maps = [];
        this.initialized = false;
        this.coverCache = new globalThis.Map();
        this.notify = () => {};
    }

    async initialize() {
        const rows = await Storage.all('maps');
        const maps = rows.map(([, r]) => Map.fromRecord(r));
        this.orderAndSetMaps(maps);
        this.initialized = true;
        this.emit('initialized', this.maps);
    }

    orderAndSetMaps(maps = this.maps) {
        const byTitle = (a, b) => (a.prettyTitle < b.prettyTitle ? -1 : a.prettyTitle > b.prettyTitle ? 1 : 0);
        const sorted = maps.filter((m) => m.favorite).sort(byTitle);
        sorted.push(...maps.filter((m) => !m.favorite).sort(byTitle));
        this.maps = sorted;
    }

    getMapById(id) {
        return this.maps.find((m) => m.id === id) ?? null;
    }

    getMapByName(name) {
        return this.maps.find((m) => m.name === name) ?? null;
    }

    select(map) {
        this.selected.value = map ? this.getMapById(map.id) : null;
    }

    async update(map) {
        const row = await Storage.get('maps', map.name);
        if (row) {
            row.Favorite = map.favorite;
            row.PlayCount = map.playCount;
            row.Collection = map.collection;
            await Storage.put('maps', map.name, row);
        }
        this.emit('mapUpdated', map);
    }

    // MapParser.Encode: write the folder + insert into the cache
    async encode(map) {
        const files = folderFiles(map);
        for (const name of FILES) {
            if (!files[name]) await Storage.delete('mapfiles', `${map.name}/${name}`);
        }
        for (const [name, data] of Object.entries(files)) {
            await Storage.put('mapfiles', `${map.name}/${name}`, data);
        }

        map.folderPath = map.name;

        const existing = await Storage.get('maps', map.name);
        if (existing) {
            map.id = existing.Id;
            map.favorite = existing.Favorite;
            map.playCount = existing.PlayCount;
        } else {
            const ids = (await Storage.all('maps')).map(([, r]) => r.Id);
            map.id = ids.length ? Math.max(...ids) + 1 : 1;
            map.added = Date.now();
        }

        const record = map.toRecord();
        await Storage.put('maps', map.name, record);

        const cached = Map.fromRecord(record);
        const index = this.maps.findIndex((m) => m.name === map.name);
        if (index >= 0) this.maps[index] = cached;
        else this.maps.push(cached);
        this.coverCache.delete(map.name);
        return cached;
    }

    // MapParser.Decode for a map that's already in the maps folder
    async decode(nameOrMap) {
        const name = typeof nameOrMap === 'string' ? nameOrMap : nameOrMap.name;
        const folder = {};
        for (const file of FILES) {
            const data = await Storage.get('mapfiles', `${name}/${file}`);
            if (data) folder[file] = data;
        }
        const map = phxmFolder(name, folder);
        if (!map) {
            this.notify('Invalid map path', 2);
            throw new MapParseError(`Invalid map path (${name})`);
        }
        const row = await Storage.get('maps', name);
        if (row) {
            map.id = row.Id;
            map.favorite = row.Favorite;
            map.playCount = row.PlayCount;
        }
        map.folderPath = name;
        return map;
    }

    async getNotes(map) {
        const data = await Storage.get('mapfiles', `${map.name}/objects.phxmo`);
        if (!data) return [];
        const { decodePHXMO } = await import('./parser.js');
        return decodePHXMO(data);
    }

    async getAudio(map) {
        return (await Storage.get('mapfiles', `${map.name}/audio.${map.audioExt}`)) ?? null;
    }

    async getCoverUrl(map) {
        if (!map) return null;
        if (this.coverCache.has(map.name)) return this.coverCache.get(map.name);
        const data = await Storage.get('mapfiles', `${map.name}/cover.png`);
        const url = data && data.length ? URL.createObjectURL(new Blob([data])) : null;
        this.coverCache.set(map.name, url);
        return url;
    }

    async delete(map) {
        for (const file of FILES) await Storage.delete('mapfiles', `${map.name}/${file}`);
        await Storage.delete('maps', map.name);
        this.maps = this.maps.filter((m) => m.id !== map.id);
        this.coverCache.delete(map.name);
        this.notify(`Deleted ${map.prettyTitle}!`);
        if (this.selected.value?.id === map.id) this.selected.value = null;
        this.emit('mapDeleted', map);
    }

    // MapParser.BulkImport. files: File[] (txt maps may be paired with an audio file of the same base name)
    async bulkImport(files, notify = false) {
        const mapFiles = files.filter((f) => isValidExt(extOf(f.name)));
        if (mapFiles.length === 0) return [];

        if (notify) this.notify(`Importing ${mapFiles.length} map(s)`);
        this.emit('importStarted');

        const audioFiles = files.filter((f) => ['mp3', 'ogg', 'wav'].includes(extOf(f.name)));
        const start = performance.now();
        const maps = [];
        let corrupted = 0;

        for (const file of mapFiles) {
            try {
                let audio = null;
                if (extOf(file.name) === 'txt') {
                    const pair = audioFiles.find((a) => baseName(a.name) === baseName(file.name)) ?? (audioFiles.length === 1 ? audioFiles[0] : null);
                    if (pair) audio = new Uint8Array(await pair.arrayBuffer());
                }
                const map = await decodeFile(file, audio);
                if (map) {
                    const cached = await this.encode(map);
                    maps.push(cached);
                    this.emit('mapImported', cached);
                }
            } catch (e) {
                corrupted++;
                console.error(e);
                const ext = extOf(file.name).toUpperCase();
                this.notify(ext === 'PHXM' ? `${baseName(file.name)} is not the proper format!` : `${ext === 'TXT' ? 'SSMapV1' : ext} file corrupted`, 2);
            }
        }

        console.log(`BULK IMPORT: ${(performance.now() - start).toFixed(1)}ms; TOTAL: ${mapFiles.length}; CORRUPT: ${corrupted}`);
        this.orderAndSetMaps();
        this.emit('importFinished', maps);
        if (notify) this.notify(`Finished importing ${mapFiles.length} map(s)`);
        return maps;
    }
}

export const MapManager = new MapManagerClass();
