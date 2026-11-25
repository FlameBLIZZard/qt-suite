@echo off
rem Lets phones on your Wi-Fi reach Beam (port 7788). Asks for admin once.
net session >nul 2>nul || (powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'" & exit /b)
netsh advfirewall firewall delete rule name="Beam 7788" >nul 2>nul
netsh advfirewall firewall add rule name="Beam 7788" dir=in action=allow protocol=TCP localport=7788 profile=private,domain
echo.
echo Done. If it still fails, set your Wi-Fi to "Private" in Windows Settings ^> Network.
pause
