#!/usr/bin/env python3
"""
midbar_ambient.py: "Midbar", the background loop for the Shevatim site.

The piece
---------
One seamless stereo loop of 95.11 s (2**22 samples at 44.1 kHz): desert at
dusk, closer to a held breath than to a song. Every sound is synthesised by
this file. Nothing is sampled and no existing tune is quoted, so the track
is free of rights.

  drone   D with its pure fifth (A), additive: a soft D2 under D3, A3 and
          D4. Each partial is slightly detuned between left and right so
          the image sways slowly, and a slow "filter" (the upper partials
          open and close) is darkest at the loop point.
  pad     a soft bowed layer that drifts through three colours over the
          D pedal, one voice at a time, with 9 s fades:
          open fourths (A D G), the raised third (A D F#), a suspended
          seventh (G C D).
  plucks  dark Karplus-Strong strings (oud / soft harp), seven short
          figures of two or three notes, 10 to 20 s apart, each in its own
          pan position. The flat second (Eb) appears once, falling to D
          under the raised third: the Hijaz / Ahava Rabbah colour, as a
          hint and not as a tune. All notes are tuned in pure ratios above
          D, so nothing beats against the drone.
  reverb  convolution with dark, exponentially decaying noise (about 5 s,
          30 ms pre-delay) on plucks and pad, so the piece sits far away.
  wind    two bands of noise with slow swells, far below everything else.

Seamless loop
-------------
Everything is rendered on a circular timeline: drone and wind are exactly
periodic in the loop length, events are added modulo the loop, and the
reverb and the master filter are circular convolutions, so tails that run
past the end land on the beginning. The loop point (t = 0) is the quietest,
most static moment: drone only, no pad, no pluck within 8 s.

AAC is a lapped transform, so a file encoded from the bare loop is wrong in
its first and last frame (the encoder sees silence beyond the ends) and
clicks when looped. The loop is therefore encoded with a few frames of
itself wrapped around both ends, and the extra packets are then cut off on
exact frame boundaries: what the decoder returns is the 2**22 samples of
the loop, with ends that meet.

Rebuild (deterministic, fixed seed):

    python3 scripts/audio/midbar_ambient.py

writes public/media/audio/midbar-ambient.m4a (AAC-LC, 44.1 kHz, ~112 kbps).
Needs numpy, scipy and ffmpeg. `--wav PATH` also keeps the lossless master.
Measure the result and draw its spectrograms with scripts/audio/verify_midbar.py.

Too present, or too dull? Turn these, then rebuild:
    TARGET_LUFS    overall level (the site also plays it at low volume)
    PLUCK_LEVEL    how far forward the plucked notes sit (0 removes them)
    PAD_LEVEL      how much pad there is over the drone
    PAD_TONE_HZ, PLUCK_TONE_HZ   brightness of pad and plucks (higher = brighter)
"""
import argparse
import os
import re
import subprocess
import tempfile

import numpy as np
from scipy import signal
from scipy.io import wavfile

# ----------------------------------------------------------------- settings
SR = 44100
N = 2 ** 22                      # loop length in samples (a whole number of AAC frames)
DUR = N / SR                     # 95.109 s
SEED = 5787

TARGET_LUFS = -28.0              # integrated loudness of the file: quiet in the file itself, because phones ignore a page's volume setting
PLUCK_LEVEL = 1.7                # peak of the loudest dry pluck, relative to the drone's RMS
PAD_LEVEL = 0.55                 # RMS of the full dry pad chord, relative to the drone's RMS
PAD_WET = 1.0                    # reverb RMS relative to the dry pad
PLUCK_WET = 1.5                  # reverb RMS relative to the dry plucks (above 1 = far away)
WIND_LEVEL = 0.055               # RMS of the wind bed, relative to the drone's RMS
LOOP_DIP = 0.10                  # how far the drone sinks at the loop point (0..1)
PAD_TONE_HZ = 1800.0             # where the pad's overtones start to fall away (higher = brighter)
PLUCK_TONE_HZ = 3600.0           # low-pass on the plucked strings (higher = brighter)
MASTER_LP_HZ = 6000.0            # roll-off of the whole mix
MASTER_HP_HZ = 30.0
BITRATE = "112k"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "public", "media", "audio", "midbar-ambient.m4a")

T = np.arange(N) / SR


D4 = 440.0 * 2.0 ** (-7 / 12)                              # 293.66 Hz
JUST = {0: 1.0, 1: 16 / 15, 4: 5 / 4, 5: 4 / 3, 7: 3 / 2, 10: 16 / 9}   # D Eb F# G A C


def midi(m):
    """Frequency of a MIDI note, tuned in pure ratios above D so that every note is still
    against the drone (an equal-tempered F# would beat about three times a second)."""
    octave, step = divmod(m - 62, 12)
    return D4 * 2.0 ** octave * JUST[step]


def loop_hz(f):
    """Nearest frequency that completes a whole number of cycles in the loop."""
    return round(f * DUR) / DUR


def pan_gains(p):
    """Constant-power pan, p in [-1, 1]."""
    a = (p + 1.0) * np.pi / 4.0
    return np.cos(a), np.sin(a)


def rms(x):
    return float(np.sqrt(np.mean(np.square(x))))


def raised_cos(n):
    return 0.5 - 0.5 * np.cos(np.pi * np.arange(n) / max(n, 1))


def add_circular(bus, start, mono, gl, gr):
    """Add a mono event to a stereo bus at sample `start`, wrapping around the loop."""
    idx = (start + np.arange(len(mono))) % N
    np.add.at(bus[0], idx, mono * gl)
    np.add.at(bus[1], idx, mono * gr)


def slow_wobble(rng, t, lo, hi, parts=3):
    """Smooth random movement in [-1, 1]: a few slow sines with random rates and phases."""
    out = np.zeros_like(t)
    for _ in range(parts):
        out += np.sin(2 * np.pi * rng.uniform(lo, hi) * t + rng.uniform(0, 2 * np.pi))
    return out / parts


# -------------------------------------------------------------------- drone
def make_drone(rng):
    """D and its pure fifth. Exactly periodic in the loop."""
    bus = np.zeros((2, N))
    w = 2 * np.pi * T / DUR                       # one turn per loop
    # brightness: darkest at the loop point, opens through the middle
    bright = 0.55 - 0.33 * np.cos(w) + 0.10 * np.sin(3 * w + 1.1) - 0.10 * np.sin(1.1)
    tilt = 0.18 * (1.0 - bright)                  # extra damping per partial number
    f0 = midi(38)                                 # D2
    # partial (multiple of D2) -> level. D3 leads, D2 is a soft floor under it, 1.5 is A2,
    # the pure fifth; the multiples 3 and 6 are A3 and A4. Small speakers still carry 150-600 Hz.
    partials = {1: 0.42, 1.5: 0.30, 2: 1.00, 3: 0.50, 4: 0.50, 5: 0.06, 6: 0.20,
                8: 0.11, 9: 0.03, 10: 0.03}
    for mult, level in partials.items():
        f = f0 * mult
        amp = level * np.exp(-(mult - 1) * tilt)
        side = 0.15 if f < 120 else 0.30          # the lowest partials stay near mono
        up = rng.integers(5, 24) / DUR            # detunes of 0.05 to 0.25 Hz, periodic in the loop
        dn = rng.integers(5, 24) / DUR
        ph = rng.uniform(0, 2 * np.pi, 3)
        centre = np.sin(2 * np.pi * loop_hz(f) * T + ph[0])
        hi = np.sin(2 * np.pi * (loop_hz(f) + up) * T + ph[1])
        lo = np.sin(2 * np.pi * (loop_hz(f) - dn) * T + ph[2])
        bus[0] += amp * (centre + side * (hi + 0.25 * lo))
        bus[1] += amp * (centre + side * (lo + 0.25 * hi))
    # one long breath that is lowest at the loop point, and a shallow shorter one
    breath = 1.0 - LOOP_DIP * (0.5 + 0.5 * np.cos(w)) ** 6
    breath *= 1.0 + 0.05 * np.sin(4 * w + 0.7) - 0.05 * np.sin(0.7)
    return bus * breath


# ---------------------------------------------------------------------- pad
#            midi  start  rise   end  fall  gain    (seconds; "end" is where the fall finishes)
PAD_NOTES = [
    (62, 3.0, 9.0, 91.0, 10.0, 1.00),   # D4, the common tone of all three colours
    (57, 5.0, 9.0, 66.0, 9.0, 0.90),    # A3
    (67, 8.0, 9.0, 36.0, 9.0, 0.65),    # G4   open fourths
    (66, 34.0, 9.0, 64.0, 9.0, 0.65),   # F#4  the raised third
    (55, 60.0, 9.0, 90.0, 10.0, 0.90),  # G3   suspended seventh
    (60, 63.0, 9.0, 89.0, 10.0, 0.75),  # C4
]


def make_pad(rng):
    bus = np.zeros((2, N))
    for m, start, rise, end, fall, gain in PAD_NOTES:
        n = int((end - start) * SR)
        t = np.arange(n) / SR
        env = np.ones(n)
        nr, nf = int(rise * SR), int(fall * SR)
        env[:nr] = raised_cos(nr)
        env[n - nf:] = raised_cos(nf)[::-1]
        env *= 1.0 + 0.28 * slow_wobble(rng, t, 0.04, 0.11)          # long bow strokes
        f = midi(m)
        for cents, pan, part in ((-1.6, -0.55, 0.5), (0.0, 0.0, 1.0), (1.9, 0.55, 0.5)):   # three players
            cents = cents + rng.uniform(-0.4, 0.4)
            drift = 1.5 * slow_wobble(rng, t, 0.07, 0.3)              # a cent or two of slow drift
            fi = f * 2.0 ** ((cents + drift) / 1200.0)
            phase = 2 * np.pi * np.cumsum(fi) / SR
            voice = np.zeros(n)
            k = 1
            while k * f < 5000.0:
                a = k ** -1.5 / (1.0 + (k * f / PAD_TONE_HZ) ** 2)    # soft, no edge
                shimmer = 1.0 + 0.22 * slow_wobble(rng, t, 0.1, 0.5, parts=2)
                voice += a * shimmer * np.sin(k * phase + rng.uniform(0, 2 * np.pi))
                k += 1
            gl, gr = pan_gains(pan + rng.uniform(-0.08, 0.08))
            add_circular(bus, int(start * SR), voice * env * gain * part, gl, gr)
    return bus


# ------------------------------------------------------------------- plucks
#         time   pan    notes: (midi, velocity)
FIGURES = [
    (8.5, -0.35, [(57, 0.80), (62, 0.90)]),               # A3 D4
    (21.0, 0.40, [(62, 0.85), (69, 0.80), (67, 0.70)]),   # D4 A4 G4
    (36.0, -0.15, [(66, 0.75), (69, 0.85)]),              # F#4 A4
    (48.5, 0.28, [(66, 0.85), (63, 0.60), (62, 0.80)]),   # F#4 Eb4 D4  (the Hijaz step)
    (62.0, -0.45, [(62, 0.85), (57, 0.75)]),              # D4 A3
    (74.0, 0.12, [(67, 0.80), (60, 0.75), (62, 0.85)]),   # G4 C4 D4
    (84.5, -0.05, [(57, 0.70), (50, 0.85)]),              # A3 D3
]
PLUCK_ATTACK_S = 0.018            # fade-in of every plucked note


def ks_string(f0, seconds, t60, damp, beta, rng):
    """One Karplus-Strong string: a delay loop with a three-tap low-pass (the damping)
    and an all-pass (fine tuning), written as a single IIR filter."""
    period = SR / f0
    whole = int(np.floor(period - 1.1))
    frac = period - 1.0 - whole                           # 0.1 .. 1.1 samples, done by the all-pass
    c = (1.0 - frac) / (1.0 + frac)
    g = 10.0 ** (-3.0 / (f0 * t60))
    loop = np.convolve(g * np.array([damp, 1.0 - 2.0 * damp, damp]), [c, 1.0])
    a = np.zeros(whole + 4)
    a[0], a[1] = 1.0, c
    a[whole:whole + 4] -= loop
    # excitation: one period of a plucked-string shape (pluck point beta), dark from the start
    p = int(round(period))
    u = np.arange(p) / p
    x = np.zeros(p)
    k = 1
    while k * f0 < 6000.0:
        x += np.sin(k * np.pi * beta) / k ** 1.45 * np.sin(2 * np.pi * k * u)
        k += 1
    x += 0.04 * np.max(np.abs(x)) * signal.lfilter([0.2], [1, -0.8], rng.standard_normal(p))
    x *= np.hanning(2 * p)[:p] ** 0.25 * np.hanning(2 * p)[p:] ** 0.25   # no step at either end
    y = signal.lfilter([1.0, c], a, np.concatenate([x, np.zeros(int(seconds * SR) - p)]))
    return y


def pluck(m, rng):
    f = midi(m)
    t60 = float(np.interp(m, [50, 57, 69], [5.0, 4.0, 2.8]))
    seconds = t60 * 1.5 + 0.5
    # a double course, as on an oud: two strings a few cents apart
    y = ks_string(f * 2 ** (-1.4 / 1200), seconds, t60, 0.22, 0.21, rng)
    y = y + 0.6 * ks_string(f * 2 ** (1.7 / 1200), seconds, t60 * 0.9, 0.24, 0.17, rng)
    sos = signal.butter(2, [90.0, PLUCK_TONE_HZ], btype="bandpass", fs=SR, output="sos")
    y = signal.sosfilt(sos, y)
    na = int(PLUCK_ATTACK_S * SR)
    y[:na] *= raised_cos(na)
    nf = int(0.4 * SR)
    y[-nf:] *= raised_cos(nf)[::-1]
    return y / np.max(np.abs(y))


def make_plucks(rng):
    bus = np.zeros((2, N))
    onsets = []
    for when, pan, notes in FIGURES:
        t = when + rng.uniform(-0.4, 0.4)
        for m, vel in notes:
            gl, gr = pan_gains(pan + rng.uniform(-0.07, 0.07))
            add_circular(bus, int(t * SR), pluck(m, rng) * vel, gl, gr)
            onsets.append(round(t, 3))
            t += rng.uniform(1.05, 1.75)                   # unhurried and uneven: never a beat
    return bus, onsets


# ------------------------------------------------------------------- reverb
def make_ir(rng):
    """Dark exponentially decaying noise: highs die first, 30 ms pre-delay, soft onset."""
    n = int(6.5 * SR)
    t = np.arange(n) / SR
    common = rng.standard_normal(n)
    ir = np.zeros((2, N))
    bands = [((40.0, 300.0), 5.6), ((300.0, 1500.0), 4.8), ((1500.0, 4500.0), 2.6)]
    for ch in range(2):
        noise = np.sqrt(0.6) * rng.standard_normal(n) + np.sqrt(0.4) * common
        tail = np.zeros(n)
        for edges, t60 in bands:
            sos = signal.butter(2, edges, btype="bandpass", fs=SR, output="sos")
            tail += signal.sosfiltfilt(sos, noise) * 10.0 ** (-3.0 * t / t60)
        on = int(0.09 * SR)
        tail[:on] *= raised_cos(on)
        off = int(0.6 * SR)
        tail[-off:] *= raised_cos(off)[::-1]
        pre = int(0.030 * SR)
        ir[ch, pre:pre + n] = tail / np.sqrt(np.sum(tail ** 2))
    return ir


def reverb(bus, ir):
    """Circular convolution: the tail that runs past the end comes back at the start."""
    return np.fft.irfft(np.fft.rfft(bus, axis=1) * np.fft.rfft(ir, axis=1), n=N, axis=1)


# --------------------------------------------------------------------- wind
def make_wind(rng):
    """Two bands of noise, each with its own slow swell. Periodic in the loop."""
    freqs = np.fft.rfftfreq(N, 1 / SR)
    w = 2 * np.pi * T / DUR
    bus = np.zeros((2, N))
    common = [np.fft.rfft(rng.standard_normal(N)) for _ in range(2)]
    for ch in range(2):
        for i, (centre, octaves, level, cycles) in enumerate(((420.0, 0.9, 1.0, (4, 7)),
                                                              (1100.0, 0.7, 0.45, (5, 9)))):
            spec = np.sqrt(0.5) * np.fft.rfft(rng.standard_normal(N)) + np.sqrt(0.5) * common[i]
            shape = np.exp(-0.5 * (np.log2(np.maximum(freqs, 1.0) / centre) / octaves) ** 2)
            band = np.fft.irfft(spec * shape, n=N)
            band /= rms(band)
            # lowest at the loop point
            swell = 0.55 - 0.27 * np.cos(cycles[0] * w + 0.5 * i) - 0.18 * np.cos(cycles[1] * w - 0.4 * i)
            bus[ch] += level * band * swell
    return bus


# ------------------------------------------------------------------- master
def master_filter(bus):
    """Zero-phase, circular: steep roll-off above MASTER_LP_HZ, nothing below MASTER_HP_HZ."""
    f = np.fft.rfftfreq(N, 1 / SR)
    lp = 1.0 / np.sqrt(1.0 + (f / MASTER_LP_HZ) ** 12)
    lp *= 1.0 / np.sqrt(1.0 + (f / 9000.0) ** 24)          # almost nothing above 9 kHz
    hp = 1.0 / np.sqrt(1.0 + (MASTER_HP_HZ / np.maximum(f, 1e-9)) ** 4)
    hp[0] = 0.0                                            # no DC
    return np.fft.irfft(np.fft.rfft(bus, axis=1) * lp * hp, n=N, axis=1)


def measure(path):
    """Integrated loudness, loudness range and true peak, as ffmpeg's ebur128 reports them."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path,
                        "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True)
    summary = r.stderr[r.stderr.rfind("Summary:"):]
    i = float(re.search(r"I:\s+(-?[\d.]+) LUFS", summary).group(1))
    lra = float(re.search(r"LRA:\s+(-?[\d.]+) LU", summary).group(1))
    peak = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", summary).group(1))
    return i, lra, peak


def write_wav(path, bus):
    wavfile.write(path, SR, bus.T.astype(np.float32))


def encode_loop(mix, out, tmp):
    """AAC-LC in MP4 whose decoded samples are exactly the loop (see the note at the top)."""
    k = 8 * 1024                                           # eight AAC frames of wrap-around per side
    wav = os.path.join(tmp, "wrapped.wav")
    write_wav(wav, np.concatenate([mix[:, -k:], mix, mix[:, :k]], axis=1))
    wrapped = os.path.join(tmp, "wrapped.m4a")
    quiet = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    exact = ["-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact"]
    subprocess.run(quiet + ["-i", wav] + exact +
                   ["-c:a", "aac", "-profile:a", "aac_low", "-b:a", BITRATE, "-ar", str(SR), "-ac", "2",
                    # ffmpeg's default "twoloop" coder left a few damaged frames on this very tonal
                    # material (errors 25 dB above its own average); "fast" is clean and 17 dB closer.
                    "-aac_coder", "fast",
                    wrapped], check=True)
    # Packets sit at multiples of 1024 samples, the first at -1024 (the encoder's priming packet).
    # Keep the packet just before the loop (it becomes the new priming packet) up to the last
    # packet of the loop, and shift the clock so that the loop starts at 0.
    first, last = k - 1024, k + N - 1024
    subprocess.run(quiet + ["-i", wrapped] + exact +
                   ["-c:a", "copy",
                    "-bsf:a", f"noise=drop='lt(pts\\,{first})+gt(pts\\,{last})',setts=ts=TS-{k}",
                    "-movflags", "+faststart", out], check=True)


def main():
    ap = argparse.ArgumentParser(description="Render the Midbar ambient loop.")
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--wav", default=None, help="also keep the lossless master here")
    args = ap.parse_args()

    seeds = np.random.SeedSequence(SEED).spawn(6)          # one stream per layer
    r_drone, r_pad, r_pluck, r_ir, r_wind, _ = [np.random.default_rng(s) for s in seeds]

    drone = make_drone(r_drone)
    ref = rms(drone)                                       # everything is set against the drone

    pad = make_pad(r_pad)
    full = slice(int(42 * SR), int(56 * SR))               # a stretch where the chord is complete
    pad *= PAD_LEVEL * ref / rms(pad[:, full])

    plucks, onsets = make_plucks(r_pluck)
    plucks *= PLUCK_LEVEL * ref / np.max(np.abs(plucks))

    ir = make_ir(r_ir)
    pad_wet = reverb(pad, ir)
    pad_wet *= PAD_WET * rms(pad) / max(rms(pad_wet), 1e-12)
    pluck_wet = reverb(plucks, ir)
    pluck_wet *= PLUCK_WET * rms(plucks) / max(rms(pluck_wet), 1e-12)

    wind = make_wind(r_wind)
    wind *= WIND_LEVEL * ref / rms(wind)

    mix = master_filter(drone + pad + pad_wet + plucks + pluck_wet + wind)

    near = np.r_[0:SR, N - SR:N]                           # one second each side of the loop point
    rest = master_filter(pad + pad_wet + plucks + pluck_wet)
    others = 20 * np.log10(rms(rest[:, near]) / rms(master_filter(drone)[:, near]))
    wind_db = 20 * np.log10(rms(master_filter(wind)[:, near]) / rms(master_filter(drone)[:, near]))

    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "master.wav")
        write_wav(wav, mix / np.max(np.abs(mix)) * 0.25)
        loud, _, _ = measure(wav)
        mix *= 0.25 / np.max(np.abs(mix)) * 10.0 ** ((TARGET_LUFS - loud) / 20.0)
        write_wav(wav, mix)
        if args.wav:
            write_wav(args.wav, mix)
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        encode_loop(mix, args.out, tmp)
        loud, lra, peak = measure(args.out)

    one = pluck(62, np.random.default_rng(SEED))           # attack of a single dry note, measured
    env = np.abs(signal.hilbert(one[:SR // 4]))
    top = int(np.argmax(env))
    t10 = int(np.argmax(env[:top + 1] >= 0.1 * env[top]))
    t90 = int(np.argmax(env[:top + 1] >= 0.9 * env[top]))
    print(f"loop      {DUR:.4f} s ({N} samples)")
    print(f"attack    plucks fade in over {PLUCK_ATTACK_S * 1000:.0f} ms "
          f"(10 to 90 % of the peak in {(t90 - t10) / SR * 1000:.1f} ms, peak after {top / SR * 1000:.0f} ms)")
    print(f"plucks    {len(onsets)} notes at " + " ".join(f"{t:.1f}" for t in onsets))
    print(f"          first {min(onsets):.1f} s after the loop point, last {DUR - max(onsets):.1f} s before it")
    print(f"loop pt   within 1 s of the loop point: pad, plucks and their reverb are {others:.0f} dB "
          f"below the drone, wind {wind_db:.0f} dB below it")
    print(f"loudness  {loud:.1f} LUFS, range {lra:.1f} LU, true peak {peak:.1f} dBTP")
    print(f"wrote     {args.out} ({os.path.getsize(args.out) / 1e6:.3f} MB)")


if __name__ == "__main__":
    main()
