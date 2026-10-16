// Port of scripts/Constants.cs

export const STARTED = performance.now();

export const DEFAULT_MAP_EXT = 'phxm';

export const CURSOR_SIZE = 0.2625;

export const GRID_SIZE = 3.0;

// (float) cast in C#, kept as plain numbers here
export const BOUNDS = { x: GRID_SIZE / 2 - CURSOR_SIZE / 2, y: GRID_SIZE / 2 - CURSOR_SIZE / 2 };

export const HIT_BOX_SIZE = 0.07;

export const HIT_WINDOW = 55;

export const BREAK_TIME = 4000; // used for skipping breaks mid-map

export const DIFFICULTIES = ['N/A', 'Easy', 'Medium', 'Hard', 'Insane', 'Illogical'];

export const DIFFICULTY_COLORS = ['#ffffffff', '#77f379ff', '#fff832ff', '#e24479ff', '#9d6effff', '#0094fcff'];

// Asset roots, relative to web/index.html
export const RES = '..';
export const USER_RES = '../user';
