import { DivisionPill, Jewel, STATUS_WORD, cx, useFlicker } from './controls.jsx';
import { Icon } from './icons.jsx';

const BLANK = {
  awaiting: ['AWAITING TELEMETRY', 'No readings from this source yet.'],
  nosignal: ['NO SIGNAL', 'The source stopped sending. The last reading is kept in history.'],
  restricted: ['RESTRICTED', 'Your role may not see this system.'],
};

/**
 * A rounded screen in a bezel with a title strip. The screen has no padding of its own: the content sets it.
 * state: live (default) | awaiting | nosignal | restricted | off. `restricted` is the text under the lock, such as
 * "Medical records: CMO and captain only". The tube switches on whenever the state changes, and `flickerOn` flickers it
 * once whenever that value changes. `index` staggers the bridge's power-up when the monitor sits inside `.power-on`.
 */
export function Monitor({ title, division, status, meta, state = 'live', restricted, flickerOn, index = 0, className, style, children, ...rest }) {
  const ref = useFlicker(flickerOn);
  const [word, text] = BLANK[state] ?? [];
  return (
    <section ref={ref} className={cx('monitor', className)} data-state={state} style={{ '--i': index, ...style }} aria-label={typeof title === 'string' ? title : undefined} {...rest}>
      {(title || meta) && (
        <header className="monitor__title">
          {division && <DivisionPill division={division} />}
          {title && <h2>{title}</h2>}
          <span className="monitor__meta">
            {meta}
            {status && <Jewel status={state === 'live' ? status : 'off'} label={`${title ?? 'System'}: ${state === 'live' ? STATUS_WORD[status] : (word ?? 'off').toLowerCase()}`} />}
          </span>
        </header>
      )}
      <div className="monitor__screen">
        <div className="monitor__in" key={state}>
          {state === 'live' && children}
          {word && (
            <div className={cx('monitor__overlay', state === 'nosignal' && 'nosignal')} role="status">
              {state === 'restricted' && <Icon name="lock" />}
              <b className={state === 'awaiting' ? 'blink-slow' : undefined}>{word}</b>
              <span>{state === 'restricted' ? restricted ?? text : text}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
