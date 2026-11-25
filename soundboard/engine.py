"""Audio engine for the soundboard.

Mixes your real microphone and the soundboard clips into a virtual cable
("CABLE Input") so Discord / games / OBS can use "CABLE Output" as a mic.
Clips can also be played to your headphones so you hear them too.

No GUI code in here, so it can be tested on its own.
"""
import threading

import numpy as np
import sounddevice as sd
import soundfile as sf

RATE = 48000  # everything is mixed at this rate; Windows converts for each device
HOST_APIS = ("Windows WASAPI", "Windows DirectSound", "MME")


# --------------------------------------------------------------------------
# Files
# --------------------------------------------------------------------------
def load_audio(path):
    """Decode an audio file to float32 stereo at RATE."""
    data, sr = sf.read(path, dtype="float32", always_2d=True)
    if data.shape[0] == 0:
        raise ValueError("file is empty")
    data = np.repeat(data, 2, axis=1) if data.shape[1] == 1 else data[:, :2]
    if sr != RATE:
        n_new = max(1, int(round(data.shape[0] * RATE / sr)))
        x_old = np.arange(data.shape[0])
        x_new = np.linspace(0, data.shape[0] - 1, n_new)
        data = np.stack(
            [np.interp(x_new, x_old, data[:, c]) for c in range(2)], axis=1
        ).astype(np.float32)
    return np.ascontiguousarray(data)


# --------------------------------------------------------------------------
# Devices
# --------------------------------------------------------------------------
def hostapi_names():
    names = [a["name"] for a in sd.query_hostapis()]
    return [n for n in HOST_APIS if n in names]


def devices_for(api_name):
    """-> (inputs {name: idx}, outputs {name: idx}, default_in_name, default_out_name)"""
    api = next(a for a in sd.query_hostapis() if a["name"] == api_name)
    ins, outs = {}, {}
    for idx in api["devices"]:
        d = sd.query_devices(idx)
        if d["max_input_channels"] > 0:
            ins[d["name"]] = idx
        if d["max_output_channels"] > 0:
            outs[d["name"]] = idx

    def name_of(idx):
        return sd.query_devices(idx)["name"] if idx is not None and idx >= 0 else None

    return ins, outs, name_of(api["default_input_device"]), name_of(api["default_output_device"])


def refresh_devices():
    """Re-scan audio devices (only safe while no stream is open)."""
    sd._terminate()
    sd._initialize()


def _extra(dev_idx):
    api = sd.query_hostapis(sd.query_devices(dev_idx)["hostapi"])["name"]
    return sd.WasapiSettings(auto_convert=True) if "WASAPI" in api else None


# --------------------------------------------------------------------------
# Mic FIFO: absorbs the tiny clock difference between the mic and the output
# --------------------------------------------------------------------------
class Fifo:
    def __init__(self, capacity):
        self.buf = np.zeros((capacity, 2), np.float32)
        self.cap = capacity
        self.r = 0
        self.n = 0
        self.primed = False
        self.lock = threading.Lock()

    def write(self, x):
        with self.lock:
            m = len(x)
            if m >= self.cap:
                self.buf[:] = x[-self.cap:]
                self.r, self.n = 0, self.cap
                return
            w = (self.r + self.n) % self.cap
            first = min(m, self.cap - w)
            self.buf[w:w + first] = x[:first]
            if m > first:
                self.buf[:m - first] = x[first:]
            self.n += m
            if self.n > self.cap:  # overflow: drop the oldest
                drop = self.n - self.cap
                self.r = (self.r + drop) % self.cap
                self.n = self.cap

    def _take(self, k):
        idx = (self.r + np.arange(k)) % self.cap
        out = self.buf[idx]
        self.r = (self.r + k) % self.cap
        self.n -= k
        return out

    def read(self, k):
        with self.lock:
            # too much queued -> latency creeping up: jump back to a small cushion
            if self.n > max(int(0.15 * RATE), 6 * k):
                self._take(self.n - 2 * k)
            if not self.primed:
                if self.n < 2 * k:
                    return np.zeros((k, 2), np.float32)
                self.primed = True
            if self.n < k:  # ran dry: re-buffer a little before resuming
                self.primed = False
                out = np.zeros((k, 2), np.float32)
                out[:self.n] = self._take(self.n)
                return out
            return self._take(k)


# --------------------------------------------------------------------------
# Engine
# --------------------------------------------------------------------------
class Voice:
    __slots__ = ("pad_id", "data", "vol", "loop", "pos")

    def __init__(self, pad_id, data, vol, loop, sinks):
        self.pad_id, self.data, self.vol, self.loop = pad_id, data, vol, loop
        self.pos = {s: 0 for s in sinks}

    def finished(self):
        n = len(self.data)
        return (not self.loop) and all(p >= n for p in self.pos.values())


class Engine:
    def __init__(self):
        self._lock = threading.Lock()
        self._voices = []
        self._streams = []
        self._sinks = set()
        self._fifo = {"out": Fifo(RATE), "mon": Fifo(RATE)}
        # live-adjustable settings
        self.mic_gain = 1.0
        self.sound_gain = 1.0
        self.mic_to_out = True      # send my mic to the virtual mic
        self.sounds_to_out = True   # send clips to the virtual mic
        self.sounds_to_mon = True   # hear clips in my headphones
        self.mic_to_mon = False     # hear my own mic in my headphones
        # meters (running max since last read)
        self.peak = {"mic": 0.0, "clips": 0.0, "out": 0.0, "mon": 0.0}

    @property
    def running(self):
        return bool(self._streams)

    # ---- lifecycle ----
    def start(self, mic=None, out=None, mon=None):
        """Open streams. mic/out/mon are PortAudio device indices or None."""
        self.stop()
        self._fifo = {"out": Fifo(RATE), "mon": Fifo(RATE)}  # drop mic audio left from old streams
        sinks = set()
        try:
            if out is not None:
                self._open(sd.OutputStream, out, 2, self._out_cb)
                sinks.add("out")
            if mon is not None:
                self._open(sd.OutputStream, mon, 2, self._mon_cb)
                sinks.add("mon")
            self._sinks = sinks
            if mic is not None:
                last = None
                for ch in (1, 2):
                    try:
                        self._open(sd.InputStream, mic, ch, self._mic_cb)
                        last = None
                        break
                    except sd.PortAudioError as e:
                        last = e
                if last:
                    raise last
        except Exception:
            self.stop()
            raise

    def _open(self, cls, dev, channels, cb):
        s = cls(samplerate=RATE, device=dev, channels=channels, dtype="float32",
                latency="low", callback=cb, extra_settings=_extra(dev))
        s.start()
        self._streams.append(s)

    def stop(self):
        streams, self._streams = self._streams, []
        for s in streams:
            try:
                s.stop()
                s.close()
            except Exception:
                pass
        self._sinks = set()
        with self._lock:
            self._voices = []

    # ---- playback control (thread-safe) ----
    def play(self, pad_id, data, volume=1.0, loop=False):
        if not self._sinks:
            return False
        v = Voice(pad_id, data, volume, loop, self._sinks)
        with self._lock:
            self._voices = [x for x in self._voices if x.pad_id != pad_id] + [v]
        return True

    def stop_pad(self, pad_id):
        with self._lock:
            self._voices = [x for x in self._voices if x.pad_id != pad_id]

    def stop_all(self):
        with self._lock:
            self._voices = []

    def playing_ids(self):
        with self._lock:
            return {v.pad_id for v in self._voices if not v.finished()}

    def progress(self):
        """-> {pad_id: 0..1} how far each playing clip has got (for the pad progress bars)."""
        out = {}
        with self._lock:
            for v in self._voices:
                n = len(v.data)
                if n and v.pos and not v.finished():
                    p = max(v.pos.values())
                    out[v.pad_id] = (p % n if v.loop else min(p, n)) / n
        return out

    def set_volume(self, pad_id, vol):
        """Change the volume of a clip that is already playing."""
        with self._lock:
            for v in self._voices:
                if v.pad_id == pad_id:
                    v.vol = vol

    def is_playing(self, pad_id):
        return pad_id in self.playing_ids()

    def read_peaks(self):
        p = dict(self.peak)
        for k in self.peak:
            self.peak[k] = 0.0
        return p

    # ---- audio callbacks ----
    def _mic_cb(self, indata, frames, time, status):
        try:
            x = indata
            self.peak["mic"] = max(self.peak["mic"], float(np.max(np.abs(x))))
            x = np.repeat(x, 2, axis=1) if x.shape[1] == 1 else x[:, :2]
            if self.mic_to_out and "out" in self._sinks:
                self._fifo["out"].write(x)
            if self.mic_to_mon and "mon" in self._sinks:
                self._fifo["mon"].write(x)
        except Exception:
            pass

    def _out_cb(self, outdata, frames, time, status):
        outdata[:] = self._render("out", frames)

    def _mon_cb(self, outdata, frames, time, status):
        outdata[:] = self._render("mon", frames)

    def _render(self, sink, frames):
        try:
            with self._lock:
                voices = list(self._voices)
            snd = np.zeros((frames, 2), np.float32)
            for v in voices:
                pos = v.pos.get(sink)
                n = len(v.data)
                if pos is None or n == 0:
                    continue
                filled = 0
                while filled < frames:
                    if pos >= n:
                        if v.loop:
                            pos = 0
                        else:
                            break
                    take = min(frames - filled, n - pos)
                    snd[filled:filled + take] += v.data[pos:pos + take] * v.vol
                    pos += take
                    filled += take
                v.pos[sink] = pos

            sounds_on = self.sounds_to_out if sink == "out" else self.sounds_to_mon
            mic_on = self.mic_to_out if sink == "out" else self.mic_to_mon
            buf = snd * self.sound_gain if sounds_on else np.zeros_like(snd)
            if sink == "out":
                self.peak["clips"] = max(self.peak["clips"], float(np.max(np.abs(buf))))
            if mic_on:
                buf += self._fifo[sink].read(frames) * self.mic_gain
            np.clip(buf, -1.0, 1.0, out=buf)
            self.peak[sink] = max(self.peak[sink], float(np.max(np.abs(buf))))

            if any(v.finished() for v in voices):
                with self._lock:
                    self._voices = [v for v in self._voices if not v.finished()]
            return buf
        except Exception:
            return np.zeros((frames, 2), np.float32)
