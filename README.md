# F1 Dashboard

🇮🇹 [Versione italiana](README.it.md)

A web dashboard for following a Formula 1 Grand Prix with timing, telemetry and strategy data, designed as a "second screen" next to the TV broadcast. It works on desktop and on smartphones (as a PWA), including away from your home network via Cloudflare Tunnel.

> **Project status**
> The original idea was to use the dashboard **live** during races. However, live data from [OpenF1](https://openf1.org) requires a paid subscription, so today the project is mainly usable as a **replay of past sessions** (OpenF1 historical data is free), with a player that rebuilds the race second by second. OpenF1 login support is still in the code for anyone with an account.

## Features

**Session selection**: pick year, Grand Prix and session (practice, qualifying, sprint, race).

**Race scrubber / replay**: a timeline to jump to any moment of the session, with automatic playback at 1×, 5×, 15× and 30×. Every panel updates to the state of the race at that moment.

Panels (each can be toggled on/off):

| Panel | Content |
|---|---|
| **Timing Tower** | Standings, gap to leader and intervals, last lap, sectors, current tyre, drivers in the pits and retired |
| **Track Map** | Circuit map rebuilt from GPS data, with animated car positions |
| **Tire Strategy** | Each driver's stints and compounds over the race, pit stops |
| **Weather** | Air/track temperature, humidity, wind, rain |
| **Lap Times** | Lap time chart for the selected drivers |
| **Head to Head** | Lap-by-lap comparison between two drivers |
| **Gap Chart** | Gaps over time |
| **Team Radio** | Team-driver radio messages with audio and **automatic transcription** (local Whisper, optional) |
| **Race Control** | Race direction messages (flags, safety car, penalties, investigations) |
| **Telemetry** | Speed, throttle, brake, gear and RPM for a lap, with two-driver comparison (via FastF1) |

Also:
- **PWA**: installable on your phone's home screen (manifest + service worker).
- **Remote access**: a script that builds the frontend, starts the backend and opens a free Cloudflare tunnel, showing the URL and a QR code to open on your phone.
- **Caching**: OpenF1 responses are cached in memory (respecting the ~3 req/s rate limit); FastF1 data and radio transcripts are cached on disk.

## Architecture

```
F1/
├── backend/                  FastAPI (Python)
│   ├── main.py               app, CORS, OpenF1 auth, serves frontend/dist in production
│   ├── routers/
│   │   ├── sessions.py       meetings, sessions, drivers + FastF1 historical endpoints
│   │   ├── live.py           timing, GPS positions, stints, pits, radio, weather, race control
│   │   └── ws.py             WebSocket /ws/{session_key} for periodic updates
│   └── services/
│       ├── openf1_client.py  OpenF1 HTTP client with caching, rate limiting and login
│       ├── fastf1_service.py telemetry and laps via the FastF1 library
│       └── whisper_service.py team radio transcription with openai-whisper
├── frontend/                 React 18 + TypeScript + Vite
│   └── src/
│       ├── App.tsx           layout, panel management and scrubber
│       ├── components/       one component per panel
│       ├── api/client.ts     backend calls
│       └── hooks/useWebSocket.ts
├── setup.bat                 installs Python and Node dependencies
├── start_backend.bat         starts uvicorn on :8000
├── start_frontend.bat        starts the Vite dev server on :5173
└── start_tunnel.bat/.ps1     build + backend + Cloudflare Tunnel
```

**Data sources**
- [OpenF1 API](https://openf1.org): timing, intervals, GPS positions, stints, pits, radio, weather, race control. Historical data free, live data paid.
- [FastF1](https://github.com/theOehrly/Fast-F1): detailed telemetry and laps for completed sessions.

## Requirements

- Python 3.10+
- Node.js 18+
- (optional) `openai-whisper` + [ffmpeg](https://ffmpeg.org) for team radio transcripts
- (optional) `cloudflared` for remote access (the script tries to install it with `winget`)

## Installation

On Windows just double-click `setup.bat`, or manually:

```powershell
cd backend
pip install -r requirements.txt
cd ..\frontend
npm install
```

To enable radio transcripts (the `base` model, ~145 MB, is downloaded on first use):

```powershell
pip install openai-whisper
```

## Usage

### Locally (development)

1. Start the backend: `start_backend.bat` (FastAPI on http://localhost:8000)
2. Start the frontend: `start_frontend.bat` (Vite on http://localhost:5173, proxying to the backend)
3. Open http://localhost:5173 and choose year → Grand Prix → session
4. Use the scrubber at the bottom to move through the race, or press Play for the replay

The dev server listens on `0.0.0.0`, so it is also reachable from other devices on the same Wi-Fi network via the PC's IP address.

### From a smartphone, anywhere (Cloudflare Tunnel)

Double-click `start_tunnel.bat`. The script:
1. builds the frontend into `frontend/dist` (only if something changed),
2. starts the backend on :8000, which also serves the built frontend,
3. starts a Cloudflare Quick Tunnel and shows the public `*.trycloudflare.com` URL with a QR code.

`Ctrl+C` stops everything. Note: in `start_tunnel.ps1` the path to `uvicorn.exe` is hard-coded (`$UVICORN`) and must be adapted to your Python installation.

### OpenF1 account (optional)

If OpenF1 responds with 401 (data that requires a subscription), the dashboard shows a login form. Credentials are only sent to the local backend, which gets a token from OpenF1 and keeps it in memory.

## Known limitations

- Without an OpenF1 subscription, data for the session in progress is not available: the dashboard is meant to be used after the session ends.
- OpenF1's free rate limit (~3 requests/s) makes the first load of a session somewhat slow; later requests use the cache.
- FastF1 telemetry downloads several MB of data the first time a session is loaded (then kept in `backend/cache`).

## License

Unofficial personal project, not affiliated with Formula 1, the FIA or the teams. F1 and related trademarks belong to their respective owners.
