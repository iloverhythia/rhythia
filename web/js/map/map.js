// Port of scripts/map/Map.cs

import { DIFFICULTIES } from '../constants.js';
import { baseName, clamp, sanitizeZalgo, stripEscapes } from '../util.js';

export class Map {
    constructor({
        folderPath = '',
        notes = null,
        id = null,
        artist = '',
        title = '',
        rating = 0,
        mappers = null,
        difficulty = 0,
        difficultyName = null,
        length = null,
        audioBuffer = null,
        coverBuffer = null,
        videoBuffer = null,
        ephemeral = false,
        artistLink = '',
        artistPlatform = '',
    } = {}) {
        this.id = 0; // database id
        this.cacheVersion = 2;
        this.folderPath = folderPath;
        this.ephemeral = ephemeral;
        this.metadataObjectHash = '';
        this.collection = '';
        this.favorite = false;
        this.playCount = 0;
        this.mapID = id;
        this.artist = stripEscapes(artist ?? '');
        this.artistLink = artistLink ?? '';
        this.artistPlatform = artistPlatform ?? '';
        this.title = stripEscapes(title ?? '');
        this.prettyTitle = this.artist !== '' ? `${this.artist} - ${this.title}` : this.title;
        this.rating = rating;
        this.mappers = mappers ?? ['N/A'];
        this.prettyMappers = this.mappers.join(', ');
        this.cachedMappers = this.mappers.join('_');
        this.difficulty = clamp(difficulty | 0, 0, DIFFICULTIES.length - 1);
        this.difficultyName = difficultyName != null ? stripEscapes(difficultyName) : DIFFICULTIES[this.difficulty];
        this.audioBuffer = audioBuffer;
        this.coverBuffer = coverBuffer;
        this.videoBuffer = videoBuffer;
        this.notes = notes ?? [];
        this.length = length ?? (this.notes.length ? this.notes[this.notes.length - 1].millisecond : 0);
        this.name = baseName(folderPath);
        this.audioExt =
            audioBuffer != null && audioBuffer.length >= 4 && String.fromCharCode(...audioBuffer.subarray(0, 4)) === 'OggS' ? 'ogg' : 'mp3';
        this.coverUrl = null;

        Map.sanitize(this);
    }

    static sanitize(map) {
        map.prettyTitle = sanitizeZalgo(map.prettyTitle);
        map.prettyMappers = sanitizeZalgo(map.prettyMappers);
        map.difficultyName = sanitizeZalgo(map.difficultyName);
    }

    encodeMeta(hasAudio = this.audioBuffer != null, hasCover = this.coverBuffer != null, hasVideo = this.videoBuffer != null) {
        return JSON.stringify(
            {
                ID: this.name,
                Artist: this.artist,
                ArtistLink: this.artistLink,
                ArtistPlatform: this.artistPlatform,
                Title: this.title,
                Rating: this.rating,
                Mappers: this.mappers,
                Difficulty: this.difficulty,
                DifficultyName: this.difficultyName,
                Length: this.length,
                HasAudio: hasAudio,
                HasCover: hasCover,
                HasVideo: hasVideo,
                AudioExt: this.audioExt,
            },
            null,
            '\t',
        );
    }

    // lightweight record kept in the map cache (no buffers or notes)
    toRecord() {
        return {
            Id: this.id,
            Name: this.name,
            CacheVersion: this.cacheVersion,
            MetadataObjectHash: this.metadataObjectHash,
            Collection: this.collection,
            FolderPath: this.folderPath,
            Favorite: this.favorite,
            Artist: this.artist,
            ArtistLink: this.artistLink,
            ArtistPlatform: this.artistPlatform,
            Title: this.title,
            PrettyTitle: this.prettyTitle,
            Rating: this.rating,
            CachedMappers: this.cachedMappers,
            PrettyMappers: this.prettyMappers,
            DifficultyName: this.difficultyName,
            Difficulty: this.difficulty,
            Length: this.length,
            AudioExt: this.audioExt,
            PlayCount: this.playCount,
            HasAudio: this.audioBuffer != null,
            HasCover: this.coverBuffer != null,
            HasVideo: this.videoBuffer != null,
            NoteCount: this.notes.length,
            Added: this.added ?? Date.now(),
        };
    }

    static fromRecord(r) {
        const map = Object.create(Map.prototype);
        map.id = r.Id;
        map.name = r.Name;
        map.cacheVersion = r.CacheVersion;
        map.metadataObjectHash = r.MetadataObjectHash;
        map.collection = r.Collection ?? '';
        map.folderPath = r.FolderPath;
        map.favorite = !!r.Favorite;
        map.ephemeral = false;
        map.mapID = r.Name;
        map.artist = r.Artist;
        map.artistLink = r.ArtistLink ?? '';
        map.artistPlatform = r.ArtistPlatform ?? '';
        map.title = r.Title;
        map.prettyTitle = r.PrettyTitle;
        map.rating = r.Rating;
        map.cachedMappers = r.CachedMappers;
        map.mappers = (r.CachedMappers ?? 'N/A').split('_');
        map.prettyMappers = r.PrettyMappers;
        map.difficultyName = r.DifficultyName;
        map.difficulty = r.Difficulty;
        map.length = r.Length;
        map.audioExt = r.AudioExt;
        map.playCount = r.PlayCount ?? 0;
        map.hasAudio = !!r.HasAudio;
        map.hasCover = !!r.HasCover;
        map.hasVideo = !!r.HasVideo;
        map.noteCount = r.NoteCount ?? 0;
        map.added = r.Added ?? 0;
        map.audioBuffer = null;
        map.coverBuffer = null;
        map.videoBuffer = null;
        map.notes = null;
        map.coverUrl = null;
        return map;
    }
}
