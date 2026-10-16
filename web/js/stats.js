// Port of scripts/database/Stats.cs (row in IndexedDB `stats` instead of SQLite)

import { Storage } from './storage.js';
import { Emitter } from './util.js';

const FIELDS = [
    'GamePlaytime',
    'TotalPlaytime',
    'GamesOpened',
    'TotalDistance',
    'NotesHit',
    'NotesMissed',
    'HighestCombo',
    'Attempts',
    'Passes',
    'FullCombos',
    'HighestScore',
    'TotalScore',
    'RageQuits',
    'AverageAccuracy',
];

class StatsClass extends Emitter {
    constructor() {
        super();
        for (const f of FIELDS) this[f] = 0;
    }

    async initialize() {
        const row = await Storage.get('stats', '_STATS');
        if (row) for (const f of FIELDS) this[f] = row[f] ?? 0;
        else await this.save();
    }

    forceUpdate() {
        this.emit('updated', this);
    }

    async save() {
        const row = {};
        for (const f of FIELDS) row[f] = this[f];
        await Storage.put('stats', '_STATS', row);
    }
}

export const Stats = new StatsClass();
