// First-visit tutorials, one per station (Tour.jsx). A step points at a monitor by its title (`mon`), at the console
// along the bottom (`desk`), or at a `data-tour` mark (`target`).
const desk = (text) => ({ desk: true, title: 'The console', text });

export const STATION_TOURS = {
  helm: [
    { mon: 'Warp factor', title: 'Warp factor', text: 'The warp the nacelles are making, on the cubic warp scale. The captain sets it with 0 to 9, or steps it with ↑ and ↓.' },
    { mon: 'Astrogator', title: 'Astrogator', text: 'Where the ship is and where it is heading. ← and → turn 5° to port or starboard.' },
    { mon: 'Shields', title: 'Shields', text: 'The four shield quadrants and the generator load. Shift S raises or drops them.' },
    { mon: 'Weapons', title: 'Weapons', text: 'Phasers fire at the locked contact (P), torpedoes with Shift P. The scanner shows what is locked.' },
    desk('Every button here is a real order sent to the ship. A dimmed one needs another role.'),
  ],
  engineering: [
    { mon: 'Reaction chamber', title: 'Reaction chamber', text: 'The matter/antimatter reaction that powers the ship. The buttons under a monitor turn its pages: rate, chamber temperature, detail.' },
    { mon: 'Power', title: 'Power', text: 'Reactor output, and on the Levers page how it is shared between warp, shields, weapons and life support. The presets on the console set it.' },
    { mon: 'Decks', title: 'Decks', text: 'All twelve decks. Pick one, then its page shows the air, temperature, pressure and gravity: stored history joined to the live stream.' },
    desk('Cruise, Combat and Emergency power reallocate power; Energize runs the transporter; Cold restart is the last resort.'),
  ],
  science: [
    { mon: 'Sensor scope', title: 'Sensor scope', text: 'The short- or long-range sweep around the ship. Contacts appear as blips.' },
    { mon: 'Contacts', title: 'Contacts', text: 'Every return above the noise floor, with bearing, range and signal strength.' },
    { mon: 'Life-forms aboard', title: 'Life-forms aboard', text: 'Unregistered life-forms counted aboard, with a forecast of when they become a problem.' },
    desk('Scan, focus on a contact, or switch between long and short range.'),
  ],
  comms: [
    { mon: 'Subspace carrier', title: 'Subspace carrier', text: 'The radio link itself: carrier strength, delay to Starfleet and message loss, live.' },
    { mon: 'Hailing', title: 'Hailing', text: 'Who the ship can reach: Starfleet Command and the task force, and whether the link is up.' },
    { mon: 'Message log', title: 'Message log', text: 'Alerts, answered hails and scenario lines, newest first.' },
    desk('Hail Starfleet (H), close the channel, send a priority-one message or open the intercom.'),
  ],
  sickbay: [
    { mon: 'Crew biosigns', title: 'Crew biosigns', text: 'All 430 crew by deck, each square coloured by how far they are from their own baseline. Click one to put them on the biobed.' },
    { mon: 'Crew on watch', title: 'Crew on watch', text: 'Everyone more than 2 standard deviations from their own normal, worst first.' },
    { mon: 'Biobed', title: 'Biobed', text: 'One crew member’s temperature, brain activity, heart and lungs. With sound on, the heartbeat plays at their live rate.' },
    desk('Inoculate the crew, or quarantine the deck with the most people on watch.'),
  ],
  fleet: [
    { mon: 'Sector map', title: 'Sector map', text: 'The four ships of the task force and their warp, live.' },
    { mon: 'Task force', title: 'Task force', text: 'Each ship’s condition, warp, shields and crew. Open one for that ship’s history.' },
    { mon: 'Operations', title: 'Operations', text: 'The server itself (readings per second, dashboards, ingest-to-screen latency) and the launcher for the six scenario episodes.' },
    { mon: 'Fleet log', title: 'Fleet log', text: 'Alerts from every ship of the task force, newest first.' },
  ],
  history: [
    { mon: 'Channel', title: 'Pick a reading', text: 'Choose a ship, a reading and a time range.' },
    { target: 'history-chart', title: 'Stored and live', text: 'Grey is what MongoDB stored, blue is the live stream. They are joined by sequence number, so there is no gap and no duplicate.' },
    { mon: 'Now', title: 'Now', text: 'The latest value of the reading, live.' },
  ],
  alerts: [
    { mon: "Captain's log", title: 'Alerts', text: 'Every alert your role may see, newest first. Filter by open, red or yellow; A acknowledges the newest one.' },
  ],
};
