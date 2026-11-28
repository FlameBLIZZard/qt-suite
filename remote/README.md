# QT Remote

Remote desktop for QT Suite. See and control this PC from a laptop, phone or another PC, in any
browser, over [Tailscale](https://tailscale.com).

- **On this PC:** QT Suite > Remote (or `python app.py`). Port 7802.
- **On the other device:** sign in to Tailscale with the same account, open `http://<this-pc>:7802`,
  press *Ask to connect*, check the 6-digit code matches the prompt on the PC, press *Allow*.

## Security

1. **Network.** Listens only on 127.0.0.1 and this PC's Tailscale address. Tailscale (WireGuard)
   encrypts everything end to end. Plain Wi-Fi is refused unless you switch it on in Settings.
2. **Identity.** `tailscale whois` names the device and account behind every connection. By default
   only devices signed in to the same Tailscale account as the PC may even ask to pair.
3. **Pairing.** A new device shows a code; the PC shows the same code in an always-on-top prompt.
   Allow (control), View only, or Don't allow. A device you already trust can also approve. The
   approved device gets a 256-bit random key, stored on the PC only as a SHA-256 hash and only valid
   from that same Tailscale device. Remove a device and its key stops working at once.
4. **While connected** a strip at the top of the PC's screen says who is connected and has an End
   button (it is hidden from the stream, so it never covers what the viewer sees). Every connect,
   pair, refusal and file is in the Activity log. Optional: *Ask on this PC every time*.
5. Wrong keys and pairing spam are rate limited per address. The console API only answers this PC,
   checks Host and Origin (no DNS rebinding or cross-site requests), and pages refuse framing.

## Limits

- Windows does not let any app see or control the lock screen, sign-in or UAC prompts, or send
  Ctrl+Alt+Del. Keep the PC signed in and awake to use it from elsewhere.
- Apps running as administrator (Task Manager, installers) ignore input from a normal app.
- No sound yet. Text clipboard only; files go one way (to the PC's Downloads\From Remote).

## Files

`app.py` server and sessions, `capture.py` GDI capture + tile diff + JPEG, `control.py` SendInput
(scan codes) + clipboard, `trust.py` Tailscale identity, pairing and trusted devices,
`indicator.py` the allow prompt and the connected strip (tkinter), `static/` console and viewer.
Data: `%LOCALAPPDATA%\QT Remote` (settings.json, trusted.json, log.json).

Tests: `powershell -File tests\run_tests.ps1` (sandbox on port 7808 with fake input).
