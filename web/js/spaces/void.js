// Port of scripts/spaces/Void.cs + prefabs/spaces/void.tscn (custom colour background, default black)

import * as THREE from 'three';
import { BaseSpace } from './base.js';

export class VoidSpace extends BaseSpace {
    async init() {
        this.clearColor = new THREE.Color(0, 0, 0);
    }
}
