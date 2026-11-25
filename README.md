# QT Suite

**Small, loud, offline tools for your PC and phone, in one window.**

QT Suite puts a dozen everyday tools behind one hub: send files to your phone, grab media from links, browse files fast, launch your games, play sounds into your mic, free up disk space, read and view almost any file, and keep notes, to-dos and reminders. Everything runs on your own PC. There are no accounts, no analytics and no cloud.

It's built in the **Ink Arcade** style: thick ink outlines, hard shadows and springy buttons.

![QT Suite home: tools, today's numbers, pinned files, new downloads and a to-do list](docs/media/home.png)

<p align="center"><img src="docs/media/clips/tools.gif" alt="Switching between Burrow, VOLT, Space Manager, Daily, Inkmotion and Pixlab inside the hub" width="800"></p>

## Install (Windows 10 or 11, 64-bit)

1. Download `QT-Suite-Setup-<version>.exe` from [Releases](https://github.com/FlameBLIZZard/qt-suite/releases).
2. Run it. It installs for your user only, so it needs no admin rights. It goes into `%LOCALAPPDATA%\Programs\QT Suite`.
3. Open **QT Suite** from the Start menu or desktop. Closing the window keeps it in the tray. Right-click the tray icon for your tools.

Windows SmartScreen may warn you because the installer isn't code-signed yet. Choose **More info**, then **Run anyway**. You can check the file against `SHA256SUMS.txt` in the release.

There's also a portable zip. Unzip it anywhere and run `QT Suite.exe`.

Python comes inside the app, so you don't need to install it.

## Getting started

The first time QT Suite opens, a short welcome walks you through setup. It takes about a minute.

1. **Pick your tools.** Tick the ones you want, or start from a preset such as *The basics*, *Phone + PC* or *Make stuff*. Badges show which tools need the phone app or the internet. Tools you don't pick are only hidden, so you can bring them back from Settings or Help any time.
2. **Choose how it starts.** Start with Windows, start your picked tools with the suite, little sounds, and how bouncy the motion is.
3. **Learn three moves.** `Ctrl+K` searches everything, `Ctrl+1` to `Ctrl+9` jump to a tool, and `F1` opens Help.
4. **Take the tour** (30 seconds). A spotlight shows the rail, Home, the Today strip and the little buttons.

![The welcome's tool picker with presets and tool cards](docs/media/welcome-pick.png)

After that:

- A **Get set up** list on Home ticks itself off as you try things: open search, open a tool, open a file, visit Settings and Help.
- The first time you open each tool, a small tip says how to start with it. You can turn tips off.
- **Help** (`F1`, or the **?** on the rail) explains every tool, answers common questions, and has a search box. It opens on the tool you're in.
- **Check my setup** in Help looks for busy ports, a missing download engine, no home network and low disk space, with a button to fix each one.
- **What's this?** (`Shift+F1`): point at any part of the window to learn what it does.
- **Settings** has a search box, plus text size and stronger contrast under *Help and comfort*.
- To connect your phone, open **Beam** and scan its QR code with your phone's camera. Your phone and PC need to be on the same Wi-Fi.

![Help: start buttons, getting started steps and a card for every tool](docs/media/help.png)

The Start menu also has a **QT Suite Help** shortcut.

## What's inside

| Tool | What it does |
|---|---|
| **Hub** | One window for everything. It has Ctrl+K for tools, apps, files, sums, units, colours, world clock, reminders, text tools and web search. It also has a to-do list, notes (Ctrl+J), clipboard history (Ctrl+Shift+V), a CPU / RAM / network meter, a focus timer and a tray icon. |
| **Beam** | Moves files, clipboard and links between this PC and your phone over Wi-Fi. No app is needed on the phone because the browser works. |
| **VOLT** | Saves video, audio and images from links you have the right to keep, using yt-dlp and gallery-dl. |
| **Burrow** | A fast file explorer with tabs, instant search and previews. |
| **Pictures, Player, Reader, Code, Archive** | Built-in viewers for photos (HEIC too), video and music, PDFs and documents, text and code, and zip files. They can also be your Windows default apps. |
| **Launchpad** | Finds the games on your PC (Steam, Epic, Riot and more) and tracks playtime. |
| **Soundboard** | Plays clips on hotkeys and can route them into your microphone (needs a virtual audio cable). |
| **Space Manager** | Shows what fills your drives, clears caches and finds big, old or duplicate files. |
| **Daily** | Today at a glance: downloads, new photos and free disk space. |
| **Lens PC** | Searches your PC photos by what's in them, if you have the Lens phone app and its model. |
| **Kharcha, Ping** | Show your phone's expenses and notifications on the PC. They need the companion Android apps. |
| **Inkmotion, Pixlab** | A stroke animation studio and a text-first pixel art editor. |
| **Surf** | A small built-in web browser with tabs and bookmarks. |

## See it in action

**Ctrl+K does a lot more than switch tools.** Sums and units, colours, world clock, date maths, reminders, text tools on your last copy, passwords, QR codes and web search. Type `?` to see the list.

<p align="center"><img src="docs/media/clips/palette.gif" alt="Typing sums, a colour, a world clock, a date, a reminder and a password into Ctrl+K" width="800"></p>

| | |
|---|---|
| ![A colour in hex, rgb and hsl with contrast](docs/media/palette-colour.png) | ![World clock for five cities](docs/media/palette-time.png) |
| ![Setting a reminder from Ctrl+K](docs/media/palette-remind.png) | ![Every Ctrl+K trick, listed by typing ?](docs/media/palette-help.png) |

**Home keeps your day together:** a to-do list with reminders, pinned files, your newest downloads, notes on Ctrl+J and zen mode on Ctrl+Shift+F.

<p align="center"><img src="docs/media/clips/home.gif" alt="Adding and ticking to-dos, setting a reminder, opening notes and zen mode" width="800"></p>

**Open almost any file in the suite:** photos with a slideshow, Markdown with an outline, code with find, CSV as a table, music with live bars, and zips you can unpack.

<p align="center"><img src="docs/media/clips/viewers.gif" alt="Stepping through photos, reading a Markdown note and searching code" width="800"></p>

| | | |
|---|---|---|
| ![Pictures](docs/media/viewer-pictures.png) | ![Reader](docs/media/viewer-reader.png) | ![Code](docs/media/viewer-code.png) |
| ![Table](docs/media/viewer-table.png) | ![Player](docs/media/viewer-player.png) | ![Archive](docs/media/viewer-archive.png) |

**The tools:**

| | | |
|---|---|---|
| ![Burrow file explorer](docs/media/tool-burrow.png) | ![VOLT downloader](docs/media/tool-volt.png) | ![Space Manager](docs/media/tool-space.png) |
| ![Daily](docs/media/tool-daily.png) | ![Beam](docs/media/tool-beam.png) | ![Surf browser](docs/media/tool-surf.png) |
| ![Inkmotion](docs/media/tool-inkmotion.png) | ![Pixlab](docs/media/tool-pixlab.png) | ![Kharcha](docs/media/tool-kharcha.png) |

It works on a phone-sized window too. <img src="docs/media/phone-home.png" alt="QT Suite on a narrow window" width="220" align="right">

The MP4 versions of the clips are in [docs/media/clips](docs/media/clips). All screenshots use made-up demo files. To make them again, run `packaging\media\make_media.ps1`.

## Privacy

- Every tool listens on `127.0.0.1` only. Beam also listens on your private Wi-Fi so your phone can reach it, and every request needs its key.
- Nothing is uploaded anywhere. VOLT and web searches reach the sites you ask for.
- The pages load their fonts from Google Fonts.
- Clipboard history stays in memory. It is never written to disk, and copies that password managers mark as private are skipped.
- Your data lives in `%LOCALAPPDATA%` (`QT Suite`, `Beam`, `Burrow`, `volt`, `SpaceManager`, `LensPC`). When you uninstall, you choose whether to keep it.

## Build it yourself

You need Windows, 64-bit Python 3.12+ from python.org with the packages listed in `packaging/make_runtime.py` installed, and optionally [Inno Setup 6](https://jrsoftware.org/isinfo.php) for the installer.

```powershell
powershell -ExecutionPolicy Bypass -File packaging\build.ps1
```

This builds:

- `build\app`, the folder that gets installed.
- `out\QT-Suite-<version>-portable.zip`.
- `out\QT-Suite-Setup-<version>.exe`, if Inno Setup is installed.
- `out\SHA256SUMS.txt`.

To run from source without building, use `python suite\app.py`.

## Layout

```
suite/          the hub: app.py (server on port 7800), static/ (UI), theme/qt.css (Ink Arcade), tray, viewers
beam/ volt/ burrow/ launcher/ soundboard/ space-manager/ daily/ lens-pc/   one folder per tool, each a small local web app
inkmotion/ pixlab/   single-file builds (their source lives in their own repos)
packaging/      export.py (copy from a working folder, scrub personal data), make_runtime.py, build.ps1, launcher/, installer/
```

## Licence

QT Suite is MIT. See [LICENSE](LICENSE). Bundled third-party software keeps its own licence, listed in [THIRD_PARTY.md](THIRD_PARTY.md).

VOLT is a general media saver. Use it only for media you have the right to download, and follow each site's terms and your local copyright law.
