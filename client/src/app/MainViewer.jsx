import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTick } from '../lib/hooks.js';
import { hitOn, ship } from '../lib/ship.js';
import { getRing, state } from '../lib/store.js';
import ViewscreenView from '../three/ViewscreenView.jsx';

const ALERT = { normal: 'green', yellow: 'yellow', red: 'red' };

// The element the viewer fills: the bridge's viewscreen glass while the bridge is on screen, else none.
let slotEl = null;
let notify = () => {};
/** Ref callback for the bridge's viewscreen glass. */
export const viewerSlot = (el) => { slotEl = el; notify(el); };

/**
 * The bridge's main viewer, mounted once per sign-in by the shell. The bridge only lends it a place: opening a station
 * parks it, paused, instead of unmounting it, so coming back to the bridge reuses its WebGL context and compiled
 * shaders instead of paying the 180-230 ms a 3D view costs when it first opens.
 */
export default function MainViewer({ viewer, condition, threeD }) {
  useTick();
  const [slot, setSlot] = useState(slotEl);
  const [host] = useState(() => Object.assign(document.createElement('div'), { className: 'viewer-host' }));
  useLayoutEffect(() => { notify = setSlot; setSlot(slotEl); return () => { notify = () => {}; }; }, []);
  useLayoutEffect(() => { if (slot) slot.appendChild(host); else host.remove(); }, [slot, host]);
  const warp = performance.now() < ship.warpFx ? 9 : state.overview.get(1)?.warp ?? 0; // a time warp streaks the stars
  const orbit = getRing(1, 'helm')?.last('orbitAlt') > 0 || !!ship.scene;
  const mode = viewer.mode === 'tactical' ? 'tactical' : orbit ? 'orbit' : 'space';
  return createPortal(
    <ViewscreenView mode3d={threeD ? 'auto' : '2d'} paused={!slot} warp={warp} mode={mode} scene={ship.scene} alert={ALERT[condition]} hit={hitOn(1)} />,
    host,
  );
}
