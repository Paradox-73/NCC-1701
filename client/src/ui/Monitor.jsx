import { useState } from 'react';
import { Jewel, LitButton, STATUS_WORD, cx, useFlicker } from './controls.jsx';
import { Icon } from './icons.jsx';

const BLANK = {
  awaiting: ['AWAITING TELEMETRY', 'No readings from this source yet.'],
  nosignal: ['NO SIGNAL', 'The source stopped sending. The last reading is kept in history.'],
  restricted: ['RESTRICTED', 'Your role may not see this system.'],
};

/**
 * A wall screen (DESIGN.md, The 1966 set): the title on a black label plate, `meta` and the status lamp on a small
 * plate beside it, then the screen set flush in its slate bay. The screen has no padding of its own: the content sets
 * it. state: live (default) | awaiting | nosignal | restricted | off. `restricted` is the text under the lock, such as
 * "Medical records: CMO and captain only". The tube switches on whenever the state changes, and `flickerOn` flickers it
 * once whenever that value changes. `index` staggers the bridge's power-up when the monitor sits inside `.power-on`.
 * views: [{ label, content }] puts a row of page buttons in the bay under the screen, so readings past the headline
 * stay one press away; children are ignored then. `division` is accepted for older callers and not drawn.
 */
export function Monitor({ title, division, status, meta, state = 'live', restricted, flickerOn, index = 0, views, className, style, children, ...rest }) {
  const [view, setView] = useState(0);
  const ref = useFlicker(`${flickerOn}|${view}`);
  const [word, text] = BLANK[state] ?? [];
  const page = views?.[Math.min(view, views.length - 1)];
  return (
    <section ref={ref} className={cx('monitor', className)} data-state={state} style={{ '--i': index, ...style }} aria-label={typeof title === 'string' ? title : undefined} {...rest}>
      {(title || meta) && (
        <header className="monitor__title">
          {title && <h2>{title}</h2>}
          <span className="monitor__meta" title={typeof meta === 'string' ? meta : undefined}>
            {typeof meta === 'string' ? <span className="monitor__metatext">{meta}</span> : meta}
            {status && <Jewel status={state === 'live' ? status : 'off'} label={`${title ?? 'System'}: ${state === 'live' ? STATUS_WORD[status] : (word ?? 'off').toLowerCase()}`} />}
          </span>
        </header>
      )}
      <div className="monitor__bay">
        <div className="monitor__screen">
          <div className="monitor__in" key={state}>
            {state === 'live' && (page ? page.content : children)}
            {word && (
              <div className={cx('monitor__overlay', state === 'nosignal' && 'nosignal')} role="status">
                {state === 'restricted' && <Icon name="lock" />}
                <b className={state === 'awaiting' ? 'blink-slow' : undefined}>{word}</b>
                <span>{state === 'restricted' ? restricted ?? text : text}</span>
              </div>
            )}
          </div>
        </div>
        {views && state === 'live' && (
          <div className="monitor__views" role="group" aria-label={`${title ?? 'Monitor'}: pages`}>
            {views.map((v, i) => <LitButton key={v.label} size="sm" color="white" label={v.label} pressed={i === view} onClick={() => setView(i)} />)}
          </div>
        )}
      </div>
    </section>
  );
}
