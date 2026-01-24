@echo off
start cmd /k "cd server && npm start"
timeout /t 3 >nul
start cmd /k "cd client && npm run dev"
timeout /t 5 >nul
start http://localhost:5173
