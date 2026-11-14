// Timings shared by the stage (DOM) and the camera rig (3D chunk); kept apart so the page bundle needs no three.js.
// The cold open follows client/public/audio/intro.mp3. NARRATION_AT: ms where our lines start, on the narrator's
// phrases ("Space", "These are the voyages", "Its five-year mission", "to boldly go"), read off word timestamps from a
// speech recogniser run on the file. THEME_AT: the beat drop, where the theme's bass and percussion land after the
// fly-by whoosh: below 150 Hz the 10 ms RMS envelope jumps 18 dB between 30.20 and 30.28 s and stays up.
export const NARRATION_AT = [5500, 14400, 18600, 26100];
export const THEME_AT = 30200;
export const FLYBY_MS = THEME_AT; // the ship glides in during the narration and arrives on the drop
export const FLIGHT_MS = 3200; // sign-in to the bridge dome
