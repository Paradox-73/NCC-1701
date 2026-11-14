// First-visit guides, one per page, worded for the role that is signed in (Tour.jsx). A step points at a monitor by its
// title (`mon`), at the console along the bottom (`desk`) or at a `data-tour` mark (`target`). `text` may be a function
// of the user and of `touch` (a phone or tablet with no keyboard: the wording names the buttons, not the keys);
// `when(user)` leaves a step out for a role it does not concern.
import { mayCommand } from '../lib/commands.js';
import { STATIONS, canEnter } from './stations.js';

const opens = (user) => STATIONS.slice(1).filter((s) => canEnter(user, s)).map((s) => s.label);
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** The console step: what this role may order from here, or who may. */
const desk = (type, mine, whose, mineTouch = mine) => ({
  desk: true,
  title: 'The console',
  text: (u, touch) => (mayCommand(u, type) ? `${touch ? mineTouch : mine} Every button is a real order to the ship, acknowledged in the captain’s log.` : `${whose} You can watch every reading; the buttons stay dimmed for your role.`),
});

export const TOURS = {
  bridge: [
    { target: 'viewscreen', title: 'Main viewer', text: (u, touch) => (touch ? 'The live view outside the ship. The button at the chair named for the current view (Forward, Tactical or Exterior) switches it.' : 'The live view outside the ship. V cycles forward, tactical and exterior; + and − magnify.') },
    {
      target: 'tile-engineering', title: 'Stations around the rail',
      text: (u) => `Each station shows one live reading; click one to go to its console. As ${u.label} you can open ${list(opens(u)) || 'none of them'}. A lock means your role cannot enter.`,
    },
    { target: 'helm', title: 'Helm and navigation', text: 'Warp factor, heading and the weakest shield, straight from the ship’s telemetry.' },
    {
      target: 'chair', title: 'The captain’s chair',
      text: (u, touch) => (u.role === 'captain'
        ? (touch ? 'Your chair: Red alert, Yellow and Stand down, Shields and Hail; Scenario plays an episode.' : 'Your chair. R for red alert, Y for yellow, N to stand down; Shift S for shields, and Scenario plays an episode.')
        : 'The captain’s orders: condition, shields, hailing. The buttons are dimmed for you, but you see every change the moment it is given.'),
    },
    {
      target: 'log', title: 'Captain’s log',
      text: (u, touch) => `Alerts, orders and scenario steps, newest first.${!u.canAck ? '' : touch ? ' All alerts opens the list, where you acknowledge them.' : ' A acknowledges the newest alert.'}`,
    },
    { target: 'lift', title: 'Turbolift', text: (u, touch) => (touch ? 'The station tabs, or the menu button on a phone, take you to any station.' : 'These tabs, or Ctrl K, take you to any station; G then a letter jumps straight there. Press ? for every shortcut.') },
  ],
  helm: [
    { mon: 'Warp factor', title: 'Warp factor', text: 'The warp the nacelles are making, on the cubic warp scale, and the impulse beneath it.' },
    { mon: 'Astrogator', title: 'Astrogator', text: 'Where the ship is and where it is heading, with the sensor alert above it.' },
    { mon: 'Shields', title: 'Shields', text: 'The four shield quadrants and the generator load.' },
    { mon: 'Targeting scanner', title: 'Weapons', text: 'Phaser charge, torpedoes left and whatever the scanner has locked.' },
    desk('helm.warp', 'You have the helm: 0 to 9 sets warp, ↑ and ↓ step it, ← and → turn 5°, Shift S shields, P phasers, Shift P a torpedo.', 'The helm takes the captain’s orders.',
      'You have the helm: Warp + and −, Impulse, All stop, Port and Stbd 5°, Shields, Phasers and Torpedo.'),
  ],
  engineering: [
    { mon: 'Reaction chamber', title: 'Reaction chamber', text: 'The matter/antimatter reaction that powers the ship: reaction rate, chamber temperature, intermix and field.' },
    { mon: 'Power allocation', title: 'Power allocation', text: 'How the reactor output is shared between warp, shields, weapons and life support.' },
    { mon: 'Deck stack', title: 'Deck stack', text: 'All twelve decks. Pick one to see its air, temperature, pressure and gravity beside it, stored history joined to the live stream.' },
    desk('engineering.allocate', 'Cruise, Combat and Emergency power reallocate the reactor; Energize runs the transporter; Cold restart is the last resort.', 'Engineering orders come from the chief engineer and the captain.'),
  ],
  science: [
    { mon: 'Sensor scope', title: 'Sensor scope', text: 'The short- or long-range sweep around the ship. Contacts appear as blips.' },
    { mon: 'Contacts', title: 'Contacts', text: 'Every return above the noise floor, with bearing, range and signal strength.' },
    { mon: 'Anomalies', title: 'Anomalies', text: 'The statistical detector: a reading 4 standard deviations from its recent mean, held for half a second. It sees what plain thresholds miss.' },
    desk('science.scan', 'Scan, focus on a contact, or switch between long and short range.', 'Scans are run by the science officer and the captain.'),
  ],
  comms: [
    { mon: 'Subspace channels', title: 'Subspace channels', text: 'The receiver waterfall: each open channel is a bright line, newest at the top. Carrier, delay and loss beside it.' },
    { mon: 'Hailing', title: 'Hailing', text: 'Who the ship can reach: Starfleet Command and the task force, and whether each link is up.' },
    { mon: 'Message log', title: 'Message log', text: 'Alerts, answered hails and scenario lines, newest first.' },
    desk('comms.hail', 'Hail Starfleet (H), close the channel, send a priority-one message or open the intercom.', 'Hailing is for the communications officer and the captain.',
      'Hail Starfleet, close the channel, send a priority-one message or open the intercom.'),
  ],
  sickbay: [
    { mon: 'Crew biosigns', title: 'Crew biosigns', text: 'All 430 crew by deck, each square coloured by how far they are from their own baseline. Click one to put them on the biobed.' },
    { mon: 'Watch list', title: 'Watch list', text: 'Everyone more than 2 standard deviations from their own normal, worst first.' },
    { mon: 'Biobed', title: 'Biobed', text: 'One crew member’s temperature, brain activity, heart and lungs. With sound on, the heartbeat plays at their live rate.' },
    desk('medical.inoculate', 'Inoculate the crew, or quarantine the deck with the most people on watch.', 'Medical orders come from the chief medical officer.'),
  ],
  fleet: [
    { mon: 'Sector map', title: 'Sector map', text: 'The four ships of the task force and their warp, live.' },
    { mon: 'Ship cards', title: 'Ship cards', text: 'Each ship’s condition, warp, shields and crew. Open a card for that ship’s history.' },
    { mon: 'System', title: 'System', text: 'The server itself: readings per second, dashboards connected and the ingest-to-screen latency.' },
    { mon: 'Scenarios', title: 'Scenarios', text: 'Start one of six episodes. Each is a scripted incident the pipeline has to catch; only one runs at a time.' },
  ],
  history: [
    { mon: 'Channel', title: 'Pick a reading', text: (u) => `Choose a ship, a reading and a time range: every reading your role may see (${u.label}).` },
    { target: 'history-chart', title: 'Stored and live', text: 'Grey is what MongoDB stored, blue is the live stream. They are joined by sequence number, so there is no gap and no duplicate.' },
    { mon: 'Merge', title: 'The join', text: 'How many samples came from storage and live, and how many overlaps were dropped.' },
  ],
  alerts: [
    {
      mon: "Captain's log", title: 'Alerts',
      text: (u, touch) => `Every alert your role may see, newest first; filter by open, red or yellow.${!u.canAck ? ' Your role can read them; acknowledging is for the officers who own them.' : touch ? ' Ack on an alert acknowledges it; Ack all clears the open ones.' : ' A acknowledges the newest; Ack all clears the open ones.'}`,
    },
  ],
};
