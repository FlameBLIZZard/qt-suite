# Changelog

## Unreleased

- **Remote:** a new remote desktop tool. Open `http://<your-pc>:7802` on any device in your Tailscale network to see and control the PC from a browser, with touch gestures on phones, special keys, a shared clipboard, file drop and multiple screens. New devices pair with a 6-digit code you confirm on the PC (or from a device you already trust); each one gets a key that only works from that device, can be made view-only and can be removed. A strip on the PC shows who is connected and can end it. The Remote tile also lists your other Tailscale PCs so you can control them from here.

## 1.1.0 (2026-11-25)

A friendlier first run, and help that's always one key away.

- **Welcome:** a five-step first-run setup. Pick your tools (with presets and "needs the phone app" badges), choose how the suite starts, learn three keys, then take a 30-second tour. It can also load a QT backup file.
- **Help** (`F1` or the **?** on the rail): getting-started steps, a card for every tool with how to begin, common questions, search, and "Show me" to spot a tool on the rail. Help opens on the tool you're in.
- **Check my setup:** finds busy ports, a missing VOLT engine, no home network, low disk space or a read-only data folder, with fix buttons.
- **Get set up** list on Home that ticks itself, a first-time tip in each tool, and a tip of the day.
- **What's this?** (`Shift+F1`): point at anything to learn what it does.
- **Settings:** a search box, a Settings tour, text size, stronger contrast and a tips switch.
- **Copy a problem report** with your user name and PC name taken out, for bug reports.
- Start menu shortcut **QT Suite Help**, and a finish page in the installer that says what happens next.

## 1.0.0 (2026-11-25)

First public release: the hub plus Beam, VOLT, Burrow, Launchpad, Soundboard, Space Manager, Daily, Lens PC, Kharcha and Ping pages, Inkmotion, Pixlab, and the Pictures / Player / Reader / Code / Archive viewers. It ships as a per-user Windows installer and a portable zip, with Python bundled.
