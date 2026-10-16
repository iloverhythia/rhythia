// Port of scripts/multiplayer/Lobby.cs (single player state used by the play menu)

import { CameraLock } from './game/camera.js';
import { Emitter } from './util.js';

class LobbyClass extends Emitter {
    constructor() {
        super();
        this.map = null;
        this.speed = 1;
        this.startFrom = 0;
        this.cameraMode = new CameraLock();
        this.modifiers = [];
    }

    setMap(map) {
        this.map = map;
        this.setStartFrom(0);
        this.emit('mapChanged', map);
    }

    setSpeed(speed) {
        this.speed = speed;
        this.emit('speedChanged', speed);
    }

    setStartFrom(startFrom) {
        this.startFrom = startFrom;
        this.emit('startFromChanged', startFrom);
    }

    setCameraMode(mode) {
        if (this.cameraMode.name === mode.name) return;
        this.cameraMode = mode;
        this.emit('cameraModeChanged', mode.name);
    }

    setModifier(mod, active) {
        if (active === this.modifiers.some((m) => m.name === mod.name)) return;
        if (active) this.modifiers.push(mod);
        else this.modifiers = this.modifiers.filter((m) => m.name !== mod.name);
        this.emit(
            'modifiersChanged',
            this.modifiers.map((m) => m.name),
        );
    }
}

export const Lobby = new LobbyClass();
