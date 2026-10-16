// Port of scripts/map/MapParser.cs
// Decodes .sspm (v1/v2), .phxm, .rhm and Sound Space .txt maps, and encodes .phxm / objects.phxmo

import { BinaryWriter, FileParser, baseName, decodeUtf8, encodeUtf8, extOf, sha256, toHex } from '../util.js';
import { Map } from './map.js';
import { Note } from './note.js';

const JSZip = globalThis.JSZip;

export const isValidExt = (ext) => ext === 'phxm' || ext === 'sspm' || ext === 'txt' || ext === 'rhm';

export class MapParseError extends Error {}

function sortNotes(notes) {
    notes.sort((a, b) => a.millisecond - b.millisecond);
    for (let i = 0; i < notes.length; i++) notes[i].index = i;
}

function splitName(name) {
    const i = name.indexOf(' - ');
    if (i < 0) return { artist: null, song: name.trim() };
    return { artist: name.slice(0, i).trim(), song: name.slice(i + 3).trim() };
}

// ---------------------------------------------------------------- Sound Space .txt

export function ssMapV1(fileName, text, audioBuffer = null) {
    const split = text.split(/\r?\n/)[0].split(',');
    const notes = new Array(split.length - 1);

    for (let i = 1; i < split.length; i++) {
        const sub = split[i].split('|');
        notes[i - 1] = new Note(i - 1, parseInt(sub[2], 10) | 0, -parseFloat(sub[0]) + 1, parseFloat(sub[1]) - 1);
    }

    return new Map({ folderPath: fileName, notes, artist: '', title: baseName(fileName), audioBuffer });
}

// ---------------------------------------------------------------- SSPM

export function sspm(bytes, path = null) {
    const file = new FileParser(bytes);

    if (file.getString(4) !== 'SS+m') throw new MapParseError('Incorrect file signature');

    const version = file.getUInt16();

    if (version === 1) return sspmV1(file, path);
    if (version === 2) return sspmV2(file, path);
    throw new MapParseError('Invalid SSPM version');
}

function sspmV1(file, path) {
    file.skip(2); // reserved
    const id = file.getLine();
    const { artist, song } = splitName(file.getLine());
    const mappers = file.getLine().split(/[&,]/);
    const mapLength = file.getUInt32();
    const noteCount = file.getUInt32();
    const difficulty = file.getUInt8();

    const hasCover = file.getUInt8() === 2;
    let coverBuffer = null;
    if (hasCover) coverBuffer = file.get(file.getUInt64());

    const hasAudio = file.getBool();
    let audioBuffer = null;
    if (hasAudio) audioBuffer = file.get(file.getUInt64());

    const notes = new Array(noteCount);

    for (let i = 0; i < noteCount; i++) {
        const millisecond = file.getUInt32() | 0;
        const isQuantum = file.getBool();
        let x;
        let y;

        if (isQuantum) {
            x = file.getFloat();
            y = file.getFloat();
        } else {
            x = file.getUInt8();
            y = file.getUInt8();
        }

        notes[i] = new Note(i, millisecond, x - 1, -y + 1);
    }

    sortNotes(notes);

    return new Map({
        folderPath: path ?? `${song}_temp.sspm`,
        notes,
        id,
        artist,
        title: song,
        rating: 0,
        mappers,
        difficulty,
        difficultyName: null,
        length: mapLength,
        audioBuffer,
        coverBuffer,
    });
}

function sspmV2(file, path) {
    file.skip(4); // reserved
    file.skip(20); // hash

    const mapLength = file.getUInt32();
    const noteCount = file.getUInt32();

    file.skip(4); // marker count

    const difficulty = file.get(1)[0];

    file.skip(2); // map rating

    const hasAudio = file.getBool();
    const hasCover = file.getBool();

    file.skip(1); // 1mod

    const customDataOffset = file.getUInt64();
    file.getUInt64(); // custom data length

    const audioByteOffset = file.getUInt64();
    const audioByteLength = file.getUInt64();

    const coverByteOffset = file.getUInt64();
    const coverByteLength = file.getUInt64();

    file.skip(16); // marker definitions offset & marker definitions length

    const markerByteOffset = file.getUInt64();

    file.skip(8); // marker byte length

    const id = file.getString(file.getUInt16());
    const { artist, song } = splitName(file.getString(file.getUInt16()));

    file.skip(file.getUInt16()); // song name

    const mapperCount = file.getUInt16();
    const mappers = new Array(mapperCount);
    for (let i = 0; i < mapperCount; i++) mappers[i] = file.getString(file.getUInt16());

    let audioBuffer = null;
    let coverBuffer = null;
    let difficultyName = null;

    file.seek(customDataOffset);
    file.skip(2); // number of fields, only care about diff name

    if (file.getString(file.getUInt16()) === 'difficulty_name') {
        let length = 0;
        switch (file.get(1)[0]) {
            case 9:
                length = file.getUInt16();
                break;
            case 11:
                length = file.getUInt32();
                break;
        }
        difficultyName = file.getString(length);
    }

    if (hasAudio) {
        file.seek(audioByteOffset);
        audioBuffer = file.get(audioByteLength);
    }

    if (hasCover) {
        file.seek(coverByteOffset);
        coverBuffer = file.get(coverByteLength);
    }

    file.seek(markerByteOffset);

    const notes = new Array(noteCount);

    for (let i = 0; i < noteCount; i++) {
        const millisecond = file.getUInt32() | 0;
        file.skip(1); // marker type, always note
        const isQuantum = file.getBool();
        let x;
        let y;

        if (isQuantum) {
            x = file.getFloat();
            y = file.getFloat();
        } else {
            x = file.get(1)[0];
            y = file.get(1)[0];
        }

        notes[i] = new Note(0, millisecond, x - 1, -y + 1);
    }

    sortNotes(notes);

    return new Map({
        folderPath: path,
        notes,
        id,
        artist,
        title: song,
        rating: 0,
        mappers,
        difficulty,
        difficultyName,
        length: mapLength,
        audioBuffer,
        coverBuffer,
    });
}

// ---------------------------------------------------------------- PHXM

export function decodePHXMO(buffer) {
    const objects = new FileParser(buffer);
    objects.getUInt32();
    const noteCount = objects.getUInt32();
    const notes = new Array(noteCount);

    for (let i = 0; i < noteCount; i++) {
        const ms = objects.getUInt32() | 0;
        const quantum = objects.getBool();
        let x;
        let y;

        if (quantum) {
            x = objects.getFloat();
            y = objects.getFloat();
        } else {
            x = objects.get(1)[0] - 1;
            y = objects.get(1)[0] - 1;
        }

        notes[i] = new Note(i, ms, x, y);
    }

    return notes;
}

export function encodePHXMO(notes) {
    const bw = new BinaryWriter(16 + notes.length * 13 + 44);
    bw.u32(12);
    bw.u32(notes.length);

    for (const note of notes) {
        const quantum = Math.trunc(note.x) !== note.x || Math.trunc(note.y) !== note.y || note.x < -1 || note.x > 1 || note.y < -1 || note.y > 1;
        bw.u32(note.millisecond);
        bw.u8(quantum ? 1 : 0);
        if (quantum) {
            bw.f32(note.x);
            bw.f32(note.y);
        } else {
            bw.u8(note.x + 1);
            bw.u8(note.y + 1);
        }
    }

    // timing point, brightness, contrast, saturation, blur, fov, tint, position, rotation, ar factor, text counts
    for (let i = 0; i < 11; i++) bw.i32(0);

    return bw.toUint8Array();
}

// folder = { 'metadata.json': Uint8Array, 'objects.phxmo': Uint8Array, 'audio.mp3': ..., 'cover.png': ..., 'video.mp4': ... }
export function phxmFolder(path, folder) {
    if (!folder['metadata.json'] || !folder['objects.phxmo']) return null;

    const metadata = JSON.parse(decodeUtf8(folder['metadata.json']));
    const objectsBuffer = folder['objects.phxmo'];

    const audioBuffer = metadata.HasAudio ? folder[`audio.${metadata.AudioExt}`] ?? null : null;
    const coverBuffer = metadata.HasCover ? folder['cover.png'] ?? null : null;
    const videoBuffer = metadata.HasVideo ? folder['video.mp4'] ?? null : null;

    if (metadata.HasAudio && !audioBuffer) throw new MapParseError(`Missing audio.${metadata.AudioExt}`);

    const notes = decodePHXMO(objectsBuffer);
    const hashInput = new Uint8Array(folder['metadata.json'].length + objectsBuffer.length);
    hashInput.set(folder['metadata.json']);
    hashInput.set(objectsBuffer, folder['metadata.json'].length);

    const map = new Map({
        folderPath: path,
        notes,
        id: metadata.ID,
        artist: metadata.Artist,
        title: metadata.Title,
        rating: 0,
        mappers: metadata.Mappers,
        difficulty: metadata.Difficulty,
        difficultyName: metadata.DifficultyName,
        length: metadata.Length,
        audioBuffer,
        coverBuffer,
        videoBuffer,
        ephemeral: false,
        artistLink: metadata.ArtistLink ?? '',
        artistPlatform: metadata.ArtistPlatform ?? '',
    });
    map.metadataObjectHash = toHex(sha256(hashInput));
    return map;
}

async function readZip(bytes) {
    const zip = await JSZip.loadAsync(bytes);
    const files = {};
    await Promise.all(
        Object.values(zip.files)
            .filter((f) => !f.dir)
            .map(async (f) => {
                files[f.name] = await f.async('uint8array');
            }),
    );
    return files;
}

export async function phxm(bytes, path) {
    const files = await readZip(bytes);
    return phxmFolder(baseName(path), files);
}

// ---------------------------------------------------------------- RHM

export async function rhm(bytes, path) {
    const files = await readZip(bytes);
    const entry = (name) => {
        if (name == null || files[name] == null) throw new MapParseError(`ZipArchiveEntry ${name} is missing!`);
        return files[name];
    };

    const mapData = JSON.parse(decodeUtf8(entry('map')));
    const notes = mapData.Notes.map((n, i) => new Note(i, n.Time | 0, n.X - 1, 1 - n.Y));

    let artist = null;
    let title = null;
    const split = String(mapData.Title ?? '').split(' - ');

    if (split.length === 1) {
        title = split[0];
    } else if (split.length > 1) {
        artist = split[0];
        title = split.slice(1).join(' - ');
    }

    const audioPath = files.audio ? 'audio' : mapData.AudioFileName;
    const audioBuffer = entry(audioPath);
    const coverBuffer = mapData.ImagePath ? entry(mapData.ImagePath) : null;

    return new Map({
        folderPath: path,
        notes,
        artist: artist ?? '',
        title: title ?? '',
        rating: 0,
        mappers: mapData.Mappers,
        difficulty: mapData.Difficulty,
        difficultyName: mapData.CustomDifficultyName,
        length: notes[notes.length - 1].millisecond,
        audioBuffer,
        coverBuffer,
    });
}

// ---------------------------------------------------------------- entry points

// file: File | { name, data: Uint8Array }. audio: optional audio bytes for .txt maps
export async function decodeFile(file, audio = null) {
    const name = file.name;
    const ext = extOf(name);

    if (!isValidExt(ext)) throw new MapParseError(`Unsupported file format (${ext})`);

    // File/Blob has a native bytes() method in current browsers, so raw data is passed as `data` instead
    const bytes = file.data instanceof Uint8Array ? file.data : new Uint8Array(await file.arrayBuffer());

    switch (ext) {
        case 'phxm':
            return phxm(bytes, name);
        case 'sspm':
            return sspm(bytes, name);
        case 'txt':
            return ssMapV1(name, decodeUtf8(bytes), audio);
        case 'rhm':
            return rhm(bytes, name);
    }
    return new Map();
}

export function folderFiles(map) {
    const files = {
        'metadata.json': encodeUtf8(map.encodeMeta()),
        'objects.phxmo': encodePHXMO(map.notes),
    };
    if (map.audioBuffer) files[`audio.${map.audioExt}`] = map.audioBuffer;
    if (map.coverBuffer) files['cover.png'] = map.coverBuffer;
    if (map.videoBuffer) files['video.mp4'] = map.videoBuffer;
    return files;
}

// same as MapParser.ExportEncode, returns the .phxm zip bytes
export async function exportEncode(map) {
    const zip = new JSZip();
    const files = folderFiles(map);
    for (const [name, data] of Object.entries(files)) zip.file(name, data, { compression: 'STORE' });
    return zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
}
