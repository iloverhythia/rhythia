// Space registry: prefabs/spaces/<name>.tscn -> JS port. Unknown names fall back to void like SkinManager.loadSpace.

import { CircularTunnelSpace } from './circulartunnel.js';
import { ConspiracySpace } from './conspiracy.js';
import { GalaxySpace } from './galaxy.js';
import { GridSpace } from './grid.js';
import { RelicSpace } from './relic.js';
import { SolidSpace } from './solid.js';
import { SquirclesSpace } from './squircles.js';
import { TriTunnelSpace } from './tritunnel.js';
import { TunnelSpace } from './tunnel.js';
import { VoidSpace } from './void.js';
import { VortexSpace } from './vortex.js';
import { WavesSpace } from './waves.js';

export const SPACES = {
    void: VoidSpace,
    grid: GridSpace,
    waves: WavesSpace,
    squircles: SquirclesSpace,
    galaxy: GalaxySpace,
    tunnel: TunnelSpace,
    circulartunnel: CircularTunnelSpace,
    tritunnel: TriTunnelSpace,
    vortex: VortexSpace,
    solid: SolidSpace,
    relic: RelicSpace,
    conspiracy: ConspiracySpace,
};

export async function createSpace(name, ctx) {
    const SpaceClass = Object.hasOwn(SPACES, name) ? SPACES[name] : VoidSpace;
    const space = new SpaceClass(ctx);
    await space.init();
    space.load();
    return space;
}
