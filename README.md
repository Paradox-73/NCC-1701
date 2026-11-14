# NCC-1701 Bridge

A real-time telemetry platform for a Constitution-class starship: every ship system streams live readings to a bridge you can sit at.

Work in progress for the MERNify hackathon.

## Run it

    npm install
    docker run -d --rm --name ncc-mongo -p 127.0.0.1:27017:27017 mongo:8
    npm run dev -w server        # http://localhost:4000
    npm start -w simulator       # three simulated ships
    npm run dev -w client        # http://localhost:5173, sign in as command / ncc-command (placeholder accounts)
    npm test                     # needs the MongoDB above

`docker compose up --build` runs everything. The wire format, rooms and API are described in `docs/PROTOCOL.md`; the domain (sources, channels, roles, alert rules) is the single file `shared/registry.js`.

## Attribution

The real-time engine (ingest with validation, de-duplication and rate limits, batched MongoDB time-series writer, history merged with live data, rooms per source and group, alert detector, load test, client live store, Chart and VirtualList) is adapted from PitWall, our own earlier project built in this same hackathon: a race-car telemetry platform. The race-specific parts (laps, circuits, tyres, pit stops) were removed and the wire format was made data-driven.
