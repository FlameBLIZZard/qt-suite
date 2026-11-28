# Third-party software in QT Suite

QT Suite's own code is MIT (see [LICENSE](LICENSE)). The installer and portable zip also contain the software below, each under its own licence. Every bundled Python package keeps its full licence text in `runtime\Lib\site-packages\<package>.dist-info\`. `runtime\packages.json` lists the exact versions in a given build.

## Runtime

| Component | Licence | Notes |
|---|---|---|
| CPython 3.14 | PSF License 2.0 | `runtime\LICENSE.txt`; includes Tcl/Tk, OpenSSL, SQLite, libffi, zlib, bzip2, xz under their own permissive licences |

## Python packages

| Package | Licence | Used by |
|---|---|---|
| Pillow | MIT-CMU | thumbnails, screenshots, photo facts |
| NumPy | BSD-3-Clause (bundled libs: 0BSD, MIT, Zlib) | Lens PC, Soundboard |
| onnxruntime, flatbuffers, protobuf, packaging | MIT; Apache-2.0; BSD-3-Clause; Apache-2.0 / BSD-2-Clause | Lens PC photo search |
| sounddevice, cffi, pycparser | MIT; MIT-0; BSD-3-Clause | Soundboard |
| soundfile | BSD-3-Clause | Soundboard |
| keyboard | MIT | Soundboard hotkeys |
| Flask, Werkzeug, Jinja2, MarkupSafe, itsdangerous, click, blinker | BSD-3-Clause; blinker is MIT | VOLT's web page |
| yt-dlp, yt-dlp-ejs | Unlicense (public domain); ejs also MIT and ISC | VOLT |
| gallery-dl | GPL-2.0-only | VOLT, image galleries; source at https://github.com/mikf/gallery-dl |
| mutagen | GPL-2.0-or-later | VOLT, cover art and tags; source at https://github.com/quodlibet/mutagen |
| curl_cffi | MIT (bundles curl-impersonate: MIT / curl licence) | VOLT |
| requests, urllib3, idna, charset-normalizer, certifi | Apache-2.0; MIT; BSD-3-Clause; MIT; MPL-2.0 | VOLT, Beam |
| websockets, pycryptodomex, brotli, typing-extensions | BSD-3-Clause; BSD / public domain; MIT; PSF-2.0 | VOLT |

gallery-dl and mutagen are GPL. They are shipped unmodified as Python source, so the source is already inside the install. The links above have their upstream repositories. QT Suite runs them as part of VOLT, and the rest of QT Suite stays MIT.

## Web assets

| Component | Licence | Notes |
|---|---|---|
| QR Code Generator for JavaScript (Kazuhiko Arase) | MIT | `suite\static\qrcode.js`, `beam\static\qrcode.js`, `remote\static\qrcode.js` |
| Archivo Black, Space Grotesk, JetBrains Mono | SIL Open Font License 1.1 | loaded from Google Fonts at run time, not bundled |

## Not bundled

- **ffmpeg** isn't shipped. VOLT and Burrow use it when it's on your PATH: `winget install Gyan.FFmpeg`. Without it, VOLT still downloads but can't merge separate audio/video streams or convert to MP3.
- **Lens model files** (MobileCLIP ONNX) aren't shipped. Lens PC copies them from a Lens phone-app checkout if it finds one.
- **Virtual audio cable** for Soundboard's mic routing, such as VB-Cable, is a separate download from its maker.
