# F1 Dashboard - Avvio con Cloudflare Tunnel
# Uso: doppio clic su start_tunnel.bat

$ErrorActionPreference = "Stop"

$ROOT     = Split-Path $MyInvocation.MyCommand.Path
$BACKEND  = Join-Path $ROOT "backend"
$FRONTEND = Join-Path $ROOT "frontend"
$DIST     = Join-Path $FRONTEND "dist"
$UVICORN  = "C:\Users\User\AppData\Local\Programs\Python\Python310\Scripts\uvicorn.exe"
$PORT     = 8000
$LOGFILE  = Join-Path $env:TEMP "cloudflared_f1.log"

function Write-Step($msg)  { Write-Host "`n  $msg" -ForegroundColor Cyan }
function Write-OK($msg)    { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "`n  [ERRORE] $msg" -ForegroundColor Red }

Clear-Host
Write-Host ""
Write-Host "  F1 Dashboard - avvio con Cloudflare Tunnel" -ForegroundColor Red
Write-Host ""

# ----------------------------------------------------------------
# 1. Build frontend
# ----------------------------------------------------------------
Write-Step "1/4  Build frontend React..."

$needBuild = $true
if (Test-Path $DIST) {
    $srcDir  = Join-Path $FRONTEND "src"
    $distAge = (Get-Item $DIST).LastWriteTime
    $newer   = Get-ChildItem $srcDir -Recurse -File |
               Where-Object { $_.LastWriteTime -gt $distAge } |
               Select-Object -First 1
    if (-not $newer) {
        Write-OK "dist/ gia' aggiornata - salto build"
        $needBuild = $false
    }
}

if ($needBuild) {
    Push-Location $FRONTEND
    try {
        Write-Host "  npm run build..." -ForegroundColor Gray
        npm run build 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "npm run build ha fallito"
            Pop-Location
            Read-Host "Premi Invio per uscire"
            exit 1
        }
        Write-OK "Build completata"
    } finally {
        Pop-Location
    }
}

# ----------------------------------------------------------------
# 2. Avvio backend
# ----------------------------------------------------------------
Write-Step "2/4  Avvio backend FastAPI..."

$oldPids = (Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue).OwningProcess |
           Sort-Object -Unique
foreach ($p in $oldPids) {
    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 600

if (-not (Test-Path $UVICORN)) {
    Write-Fail "uvicorn non trovato: $UVICORN"
    Read-Host "Premi Invio per uscire"
    exit 1
}

$backendProc = Start-Process `
    -FilePath $UVICORN `
    -ArgumentList "main:app --host 0.0.0.0 --port $PORT" `
    -WorkingDirectory $BACKEND `
    -WindowStyle Minimized `
    -PassThru

$ready = $false
for ($i = 0; $i -lt 50; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $r = Invoke-WebRequest "http://localhost:$PORT/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
}

if ($ready) {
    Write-OK "Backend attivo su http://localhost:$PORT"
} else {
    Write-Warn "Backend non risponde dopo 25s - potrebbe ancora avviarsi"
}

# ----------------------------------------------------------------
# 3. Verifica / installa cloudflared
# ----------------------------------------------------------------
Write-Step "3/4  Verifica cloudflared..."

$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf) {
    Write-Warn "cloudflared non trovato - installo tramite winget..."
    try {
        winget install --id Cloudflare.cloudflared -e --silent --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                    [System.Environment]::GetEnvironmentVariable("Path","User")
        $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
        if (-not $cf) { throw "cloudflared non trovato dopo installazione" }
        Write-OK "cloudflared installato"
    } catch {
        Write-Fail "Installazione automatica fallita.`nScaricalo da: https://github.com/cloudflare/cloudflared/releases"
        Read-Host "Premi Invio per uscire"
        exit 1
    }
} else {
    Write-OK "cloudflared trovato: $($cf.Source)"
}

# ----------------------------------------------------------------
# 4. Avvio tunnel e attesa URL
# ----------------------------------------------------------------
Write-Step "4/4  Avvio tunnel Cloudflare..."
Write-Host "  attendo URL pubblico (max 35 secondi)..." -ForegroundColor Gray

# Kill any leftover cloudflared from a previous run (it may still hold the log file open)
Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 600

# Remove old log; if it is still locked use a fresh timestamped file instead
if (Test-Path $LOGFILE) {
    Remove-Item $LOGFILE -Force -ErrorAction SilentlyContinue
    if (Test-Path $LOGFILE) {
        $LOGFILE = Join-Path $env:TEMP ("cloudflared_f1_" + (Get-Date -Format "HHmmss") + ".log")
    }
}

$cfProc = Start-Process `
    -FilePath "cloudflared" `
    -ArgumentList "tunnel --url http://localhost:$PORT --no-autoupdate" `
    -RedirectStandardError $LOGFILE `
    -WindowStyle Hidden `
    -PassThru

$tunnelUrl = $null
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt 35) {
    Start-Sleep -Milliseconds 500
    if (Test-Path $LOGFILE) {
        $content = Get-Content $LOGFILE -Raw -ErrorAction SilentlyContinue
        if ($content -match "(https://[a-z0-9\-]+\.trycloudflare\.com)") {
            $tunnelUrl = $Matches[1]
            break
        }
    }
}

if (-not $tunnelUrl) {
    Write-Fail "Tunnel non avviato entro 35 secondi. Controlla la connessione internet."
    $cfProc | Stop-Process -Force -ErrorAction SilentlyContinue
    Read-Host "Premi Invio per uscire"
    exit 1
}

# ----------------------------------------------------------------
# Risultato
# ----------------------------------------------------------------
Clear-Host
Write-Host ""
Write-Host "  +----------------------------------------------------------+" -ForegroundColor Green
Write-Host "  |          F1 DASHBOARD - ONLINE                           |" -ForegroundColor Green
Write-Host "  +----------------------------------------------------------+" -ForegroundColor Green
$padded = $tunnelUrl.PadRight(54)
Write-Host "  | URL: $padded |" -ForegroundColor White
Write-Host "  +----------------------------------------------------------+" -ForegroundColor Green
Write-Host "  | Locale:  http://localhost:8000                           |" -ForegroundColor Gray
Write-Host "  +----------------------------------------------------------+" -ForegroundColor Green
Write-Host ""
Write-Host "  Copia l'URL sul telefono, oppure scansiona il QR code:" -ForegroundColor Cyan

$qrBase  = "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data="
$qrUrl   = $qrBase + [Uri]::EscapeDataString($tunnelUrl)
Start-Process $qrUrl

Write-Host "  (il browser ha aperto il QR code)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Premi Ctrl+C per fermare tutto." -ForegroundColor Gray
Write-Host ""

# ----------------------------------------------------------------
# Loop watchdog - riavvia backend se muore
# ----------------------------------------------------------------
try {
    while ($true) {
        Start-Sleep -Seconds 5
        if ($backendProc.HasExited) {
            Write-Warn "Backend terminato - riavvio..."
            $backendProc = Start-Process `
                -FilePath $UVICORN `
                -ArgumentList "main:app --host 0.0.0.0 --port $PORT" `
                -WorkingDirectory $BACKEND `
                -WindowStyle Minimized `
                -PassThru
        }
    }
} finally {
    Write-Host "`n  Chiusura in corso..." -ForegroundColor Gray
    $cfProc      | Stop-Process -Force -ErrorAction SilentlyContinue
    $backendProc | Stop-Process -Force -ErrorAction SilentlyContinue
    if (Test-Path $LOGFILE) { Remove-Item $LOGFILE -Force -ErrorAction SilentlyContinue }
    Write-Host "  Tutto fermato." -ForegroundColor Gray
}
