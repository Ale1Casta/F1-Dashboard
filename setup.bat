@echo off
echo === F1 Dashboard - Setup ===
echo.

echo [1/2] Installazione dipendenze Python (backend)...
cd backend
pip install -r requirements.txt
cd ..

echo.
echo [2/2] Installazione dipendenze Node (frontend)...
cd frontend
npm install
cd ..

echo.
echo === Setup completato! ===
echo Usa start_backend.bat e start_frontend.bat per avviare.
pause
