// Port of scripts/game/camera/*.cs
// camera: { position: {x,y,z}, rotation: {x,y,z} } using Godot's YXZ euler convention

import { BOUNDS } from '../constants.js';
import { clamp, degToRad, v2clamp, v2finite } from '../util.js';

// Godot Basis.Z for a YXZ euler rotation
export function basisZ(rot) {
    const cx = Math.cos(rot.x);
    return { x: Math.sin(rot.y) * cx, y: -Math.sin(rot.x), z: Math.cos(rot.y) * cx };
}

export class CameraLock {
    get name() {
        return 'Lock';
    }

    get rankable() {
        return true;
    }

    process(attempt, replayManager, camera, cursor, mouseDelta, sensitivity) {
        const settings = attempt.settings;
        const delta = { x: (mouseDelta.x * sensitivity) / 120, y: -((mouseDelta.y * sensitivity) / 120) };

        if (settings.CursorDrift.value) {
            attempt.cursorPosition = attempt.isReplay
                ? v2clamp(replayManager.cursorPosition, BOUNDS)
                : v2clamp({ x: attempt.cursorPosition.x + delta.x, y: attempt.cursorPosition.y + delta.y }, BOUNDS);
        } else {
            attempt.rawCursorPosition = attempt.isReplay
                ? { ...replayManager.cursorPosition }
                : { x: attempt.rawCursorPosition.x + delta.x, y: attempt.rawCursorPosition.y + delta.y };
            attempt.cursorPosition = v2clamp(attempt.rawCursorPosition, BOUNDS);
        }

        const parallax = settings.CameraParallax.value;
        const usePar = !(attempt.isReplay && attempt.replays.length > 1);

        camera.position.x = usePar ? attempt.cursorPosition.x * parallax : 0;
        camera.position.y = usePar ? attempt.cursorPosition.y * parallax : 0;
        camera.position.z = 3.75;
        camera.rotation.x = 0;
        camera.rotation.y = 0;
        camera.rotation.z = 0;

        if (v2finite(attempt.cursorPosition)) {
            cursor.position.x = attempt.cursorPosition.x;
            cursor.position.y = attempt.cursorPosition.y;
            cursor.position.z = 0;
        }
    }
}

export class CameraSpin {
    get name() {
        return 'Spin';
    }

    get rankable() {
        return true;
    }

    process(attempt, replayManager, camera, cursor, mouseDelta, sensitivity) {
        const settings = attempt.settings;

        if (!attempt.isReplay) {
            camera.rotation.x += ((-mouseDelta.y / 120) * sensitivity) / Math.PI;
            camera.rotation.y += ((-mouseDelta.x / 120) * sensitivity) / Math.PI;
        } else {
            camera.rotation.x += mouseDelta.y / Math.PI;
            camera.rotation.y += -mouseDelta.x / Math.PI;
        }

        camera.rotation.x = clamp(camera.rotation.x, degToRad(-90), degToRad(90));

        const parallax = settings.CameraParallax.value;
        const z = basisZ(camera.rotation);

        // The pivot is to mimic ROBLOX's orbital camera
        camera.position.x = attempt.cursorPosition.x * parallax + z.x / 4;
        camera.position.y = attempt.cursorPosition.y * parallax + z.y / 4;
        camera.position.z = 3.5 + z.z / 4;

        // Project cursor from the camera's "ray cast"
        const k = Math.abs(camera.position.z / z.z);
        attempt.rawCursorPosition = { x: camera.position.x - z.x * k, y: camera.position.y - z.y * k };
        attempt.cursorPosition = v2clamp(attempt.rawCursorPosition, BOUNDS);

        if (v2finite(attempt.cursorPosition)) {
            cursor.position.x = attempt.cursorPosition.x;
            cursor.position.y = attempt.cursorPosition.y;
            cursor.position.z = 0;
        }
    }
}

export const createCameraMode = (name) => (name === 'Spin' ? new CameraSpin() : new CameraLock());
