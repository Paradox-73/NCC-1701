import { DivisionPill, Jewel, cx, useFlicker } from './controls.jsx';
import { Icon } from './icons.jsx';

/**
 * A rounded screen in a bezel with a title strip.
 * state: live (default) | nosignal | restricted | off. `restricted` is the text under the lock, such as
 * "Medical records: CMO and captain only". `flickerOn` flickers the tube once whenever it changes.
 * `index` staggers the power-up animation when the monitor sits inside a `.power-on` parent.
 */
export function Monitor({ title, division, status, meta, state = 'live', restricted, flickerOn, index = 0, className, style, children, ...rest }) {
  const ref = useFlicker(flickerOn);
  return (
    <section ref={ref} className={cx('monitor', className)} data-state={state} style={{ '--i': index, ...style }} {...rest}>
      {(title || meta) && (
        <header className="monitor__title">
          {division && <DivisionPill division={division} />}
          {title && <h3>{title}</h3>}
          <span className="monitor__meta">
            {meta}
            {status && <Jewel status={state === 'live' ? status : 'off'} label={`${title ?? 'System'}: ${state === 'live' ? STATUS_WORD[status] : state === 'nosignal' ? 'no signal' : 'restricted'}`} />}
          </span>
        </header>
      )}
      <div className="monitor__screen">
        {state === 'live' && children}
        {state === 'nosignal' && (
          <div className="monitor__overlay nosignal" role="status"><b>NO SIGNAL</b><span>The source stopped sending. The last reading is kept in history.</span></div>
        )}
        {state === 'restricted' && (
          <div className="monitor__overlay" role="status"><Icon name="lock" /><b>RESTRICTED</b><span>{restricted ?? 'Your role may not see this system.'}</span></div>
        )}
        {state === 'off' && <div className="monitor__overlay" aria-hidden="true" />}
      </div>
    </section>
  );
}

export const STATUS_WORD = { ok: 'nominal', info: 'information', warn: 'yellow alert', crit: 'red alert', off: 'no signal' };
