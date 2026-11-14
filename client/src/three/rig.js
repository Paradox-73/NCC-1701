// Timings shared by the stage (DOM) and the camera rig (3D chunk); kept apart so the page bundle needs no three.js.
// The cold open follows client/public/audio/intro.mp3: ms where each narration phrase starts and where the theme
// music begins, read off the file's loudness envelope (quarter-second RMS) where the speech pauses.
export const NARRATION_AT = [5500, 9600, 14500, 22700];
export const THEME_AT = 26500;
export const FLYBY_MS = THEME_AT; // the ship glides in during the narration and holds as the theme starts
export const FLIGHT_MS = 3200; // sign-in to the bridge dome
