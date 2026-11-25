# F1 Dashboard

Dashboard web per seguire un Gran Premio di Formula 1 con dati di timing, telemetria e strategia, pensata come "secondo schermo" accanto alla diretta TV. Funziona su desktop e da smartphone (PWA), anche fuori dalla rete di casa tramite Cloudflare Tunnel.

> **Nota sullo stato del progetto**
> L'idea originale era usare la dashboard **in tempo reale** durante le gare. I dati live di [OpenF1](https://openf1.org) però richiedono un abbonamento a pagamento, quindi oggi il progetto è utilizzabile soprattutto come **replay delle sessioni passate** (i dati storici di OpenF1 sono gratuiti), con un player che ricostruisce la gara secondo per secondo. Il supporto al login OpenF1 è comunque presente nel codice per chi ha un account.

## Feature

**Selezione sessione**: scelta di anno, Gran Premio e sessione (prove libere, qualifiche, sprint, gara).

**Race scrubber / replay**: barra temporale per spostarsi in qualsiasi istante della sessione, con riproduzione automatica a velocità 1×, 5×, 15× e 30×. Tutti i pannelli si aggiornano allo stato della gara in quell'istante.

Pannelli (attivabili/disattivabili singolarmente):

| Pannello | Contenuto |
|---|---|
| **Timing Tower** | Classifica, distacchi dal leader e intervalli, ultimo giro, settori, gomma attuale, piloti ai box e ritirati |
| **Track Map** | Mappa del circuito ricostruita dai dati GPS, con la posizione animata delle vetture |
| **Tire Strategy** | Stint e mescole di ogni pilota lungo la gara, pit stop |
| **Weather** | Temperatura aria/pista, umidità, vento, pioggia |
| **Lap Times** | Grafico dei tempi sul giro per i piloti selezionati |
| **Head to Head** | Confronto diretto giro per giro tra due piloti |
| **Gap Chart** | Andamento dei distacchi nel tempo |
| **Team Radio** | Messaggi radio team-pilota con audio e **trascrizione automatica** (Whisper locale, opzionale) |
| **Race Control** | Messaggi della direzione gara (bandiere, safety car, penalità, investigazioni) |
| **Telemetry** | Velocità, acceleratore, freno, marcia e RPM di un giro, con confronto tra due piloti (via FastF1) |

Altro:
- **PWA**: installabile sulla home del telefono (manifest + service worker).
- **Accesso remoto**: script che compila il frontend, avvia il backend e apre un tunnel Cloudflare gratuito, mostrando URL e QR code da aprire sul telefono.
- **Cache**: le risposte OpenF1 sono in cache in memoria (con rispetto del rate limit di ~3 req/s), i dati FastF1 e le trascrizioni radio sono in cache su disco.

## Architettura

```
F1/
├── backend/                  FastAPI (Python)
│   ├── main.py               app, CORS, auth OpenF1, serve frontend/dist in produzione
│   ├── routers/
│   │   ├── sessions.py       meeting, sessioni, piloti + endpoint storici FastF1
│   │   ├── live.py           timing, posizioni GPS, stint, pit, radio, meteo, race control
│   │   └── ws.py             WebSocket /ws/{session_key} per aggiornamenti periodici
│   └── services/
│       ├── openf1_client.py  client HTTP OpenF1 con cache, rate limit e login
│       ├── fastf1_service.py telemetria e giri via libreria FastF1
│       └── whisper_service.py trascrizione team radio con openai-whisper
├── frontend/                 React 18 + TypeScript + Vite
│   └── src/
│       ├── App.tsx           layout, gestione pannelli e scrubber
│       ├── components/       un componente per pannello
│       ├── api/client.ts     chiamate al backend
│       └── hooks/useWebSocket.ts
├── setup.bat                 installa dipendenze Python e Node
├── start_backend.bat         avvia uvicorn su :8000
├── start_frontend.bat        avvia Vite dev server su :5173
└── start_tunnel.bat/.ps1     build + backend + Cloudflare Tunnel
```

**Fonti dati**
- [OpenF1 API](https://openf1.org): timing, intervalli, posizioni GPS, stint, pit, radio, meteo, race control. Storico gratuito, live a pagamento.
- [FastF1](https://github.com/theOehrly/Fast-F1): telemetria dettagliata e giri per le sessioni concluse.

## Requisiti

- Python 3.10+
- Node.js 18+
- (opzionale) `openai-whisper` + [ffmpeg](https://ffmpeg.org) per le trascrizioni dei team radio
- (opzionale) `cloudflared` per l'accesso remoto (lo script prova a installarlo con `winget`)

## Installazione

Su Windows basta un doppio clic su `setup.bat`, oppure a mano:

```powershell
cd backend
pip install -r requirements.txt
cd ..\frontend
npm install
```

Per abilitare le trascrizioni radio (al primo uso scarica il modello `base`, ~145 MB):

```powershell
pip install openai-whisper
```

## Utilizzo

### In locale (sviluppo)

1. Avvia il backend: `start_backend.bat` (FastAPI su http://localhost:8000)
2. Avvia il frontend: `start_frontend.bat` (Vite su http://localhost:5173, con proxy verso il backend)
3. Apri http://localhost:5173, scegli anno → Gran Premio → sessione
4. Usa lo scrubber in basso per muoverti nella gara o premi Play per il replay

Il dev server ascolta su `0.0.0.0`, quindi è raggiungibile anche da altri dispositivi sulla stessa rete Wi-Fi tramite l'IP del PC.

### Da smartphone ovunque (Cloudflare Tunnel)

Doppio clic su `start_tunnel.bat`. Lo script:
1. compila il frontend in `frontend/dist` (solo se ci sono modifiche),
2. avvia il backend su :8000, che serve anche il frontend compilato,
3. avvia un Quick Tunnel Cloudflare e mostra l'URL pubblico `*.trycloudflare.com` con un QR code.

`Ctrl+C` chiude tutto. Nota: in `start_tunnel.ps1` il percorso di `uvicorn.exe` è fisso (`$UVICORN`); va adattato alla propria installazione di Python.

### Account OpenF1 (opzionale)

Se OpenF1 risponde con 401 (dati che richiedono abbonamento), la dashboard mostra un form di login. Le credenziali vengono inviate solo al backend locale, che ottiene un token da OpenF1 e lo tiene in memoria.

## Limiti noti

- Senza abbonamento OpenF1 i dati della sessione in corso non sono disponibili: la dashboard va usata a sessione conclusa.
- Il rate limit gratuito di OpenF1 (~3 richieste/s) rende il primo caricamento di una sessione un po' lento; le richieste successive usano la cache.
- La telemetria FastF1 al primo caricamento di una sessione scarica diversi MB di dati (poi resta in `backend/cache`).

## Licenza

Progetto personale non ufficiale, non affiliato a Formula 1, FIA o ai team. F1 e i marchi correlati appartengono ai rispettivi proprietari.
