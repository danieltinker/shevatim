#!/usr/bin/env python3
"""
verify_midbar.py: measure the Midbar loop and draw its spectrograms.

    python3 scripts/audio/verify_midbar.py [FILE.m4a] [PICTURE_DIR]

Prints loudness, peaks, clicks, stereo correlation, band limits and a test of
the loop join (the decoded file played twice in a row), and writes
spectrogram pictures into PICTURE_DIR (default: a new temporary folder).
Needs numpy, scipy, matplotlib and ffmpeg. Measurement only: no ears involved.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

import numpy as np
from scipy import signal

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DEFAULT = os.path.join(ROOT, "public", "media", "audio", "midbar-ambient.m4a")


def db(x):
    return 20 * np.log10(np.maximum(x, 1e-12))


def decode(path, extra=()):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", *extra, "-i", path,
                        "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"], capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.float32).reshape(-1, 2).T.astype(np.float64)


def frames(x, size, hop):
    n = 1 + (x.shape[-1] - size) // hop
    idx = np.arange(size)[None, :] + hop * np.arange(n)[:, None]
    return x[..., idx]


def join_report(x, label):
    """Play the file twice and compare what happens at the join with the rest of the piece."""
    n = x.shape[1]
    mono2 = np.concatenate([x, x], axis=1).mean(axis=0)
    size = 1024
    # non-overlapping frames laid out so that one boundary falls exactly on the join
    start = n % size
    fr = frames(mono2[start:], size, size)
    j = (n - start) // size                      # fr[j-1] ends at the join, fr[j] starts at it
    level = db(np.sqrt(np.mean(fr ** 2, axis=1)))
    dlevel = np.abs(np.diff(level))
    spec = db(np.abs(np.fft.rfft(fr * np.hanning(size), axis=1))[:, :int(8000 / SR * size)] / size)
    spec = np.maximum(spec, -110.0)
    dspec = np.sqrt(np.mean(np.diff(spec, axis=0) ** 2, axis=1))
    # frames that straddle the join (it sits in their middle): a click would show here
    fr2 = frames(mono2[start + size // 2:], size, size)
    hp = signal.sosfiltfilt(signal.butter(4, 3000, btype="highpass", fs=SR, output="sos"), mono2)
    hf = frames(hp[start + size // 2:], size, size)
    hf_level = db(np.sqrt(np.mean(hf ** 2, axis=1)))
    level2 = db(np.sqrt(np.mean(fr2 ** 2, axis=1)))
    jump = np.abs(np.diff(mono2))
    out = {
        "level step across the join (dB)": round(float(dlevel[j - 1]), 3),
        "level step, neighbouring frames elsewhere: median / 95% / max (dB)":
            [round(float(v), 3) for v in (np.median(dlevel), np.percentile(dlevel, 95), dlevel.max())],
        "spectrum change across the join (dB rms, 0-8 kHz)": round(float(dspec[j - 1]), 2),
        "spectrum change elsewhere: median / 95% / max":
            [round(float(v), 2) for v in (np.median(dspec), np.percentile(dspec, 95), dspec.max())],
        "level of the frame holding the join (dBFS)": round(float(level2[j - 1]), 2),
        "level of the frames before / after it (dBFS)":
            [round(float(level2[j - 2]), 2), round(float(level2[j]), 2)],
        "energy above 3 kHz in the frame holding the join (dBFS)": round(float(hf_level[j - 1]), 1),
        "energy above 3 kHz elsewhere: median / 95% / max (dBFS)":
            [round(float(v), 1) for v in (np.median(hf_level), np.percentile(hf_level, 95), hf_level.max())],
        "sample step at the join (full scale)": round(float(jump[n - 1]), 5),
        "largest sample step anywhere (full scale)": round(float(jump.max()), 5),
    }
    print(f"\n-- join: {label}")
    for k, v in out.items():
        print(f"   {k}: {v}")
    return out


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    pics = sys.argv[2] if len(sys.argv) > 2 else tempfile.mkdtemp(prefix="midbar-")
    os.makedirs(pics, exist_ok=True)

    probe = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", path],
        capture_output=True, text=True, check=True).stdout)
    s = probe["streams"][0]
    print(f"file      {path}")
    print(f"size      {os.path.getsize(path)} bytes ({os.path.getsize(path) / 1e6:.3f} MB)")
    print(f"codec     {s['codec_name']} {s.get('profile')}, {s['sample_rate']} Hz, {s['channels']} ch, "
          f"{int(probe['format']['bit_rate']) / 1000:.1f} kbps, duration {float(probe['format']['duration']):.4f} s")

    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true",
                        "-f", "null", "-"], capture_output=True, text=True).stderr
    summary = r[r.rfind("Summary:"):]
    print("loudness  I {} LUFS, LRA {} LU (low {} / high {}), true peak {} dBTP".format(
        re.search(r"I:\s+(-?[\d.]+)", summary).group(1), re.search(r"LRA:\s+(-?[\d.]+)", summary).group(1),
        re.search(r"LRA low:\s+(-?[\d.]+)", summary).group(1), re.search(r"LRA high:\s+(-?[\d.]+)", summary).group(1),
        re.search(r"Peak:\s+(-?[\d.]+)", summary).group(1)))
    rows = re.findall(r"t:\s*([\d.]+)\s+TARGET.*?M:\s*(-?[\d.]+)\s+S:\s*(-?[\d.]+)", r)
    tt = np.array([float(a) for a, _, _ in rows])
    mm = np.array([float(b) for _, b, _ in rows])
    ss = np.array([float(c) for _, _, c in rows])
    ok = tt > 3.0
    print(f"          short-term (3 s) from {ss[ok].min():.1f} (at {tt[ok][ss[ok].argmin()]:.0f} s) "
          f"to {ss[ok].max():.1f} LUFS (at {tt[ok][ss[ok].argmax()]:.0f} s)")
    print(f"          momentary (0.4 s) from {mm[ok].min():.1f} to {mm[ok].max():.1f} LUFS "
          f"(at {tt[ok][mm[ok].argmax()]:.1f} s)")

    x = decode(path)
    n = x.shape[1]
    print(f"decoded   {n} samples = {n / SR:.5f} s (2**22 = {2 ** 22})")
    print(f"peak      sample peak {db(np.abs(x).max()):.2f} dBFS; clipped samples {(np.abs(x) >= 0.999).sum()}")
    print(f"dc        left {x[0].mean():+.2e}, right {x[1].mean():+.2e} of full scale")
    step = np.abs(np.diff(x, axis=1))
    print(f"clicks    largest sample-to-sample step {step.max():.5f} of full scale "
          f"(at {step.max(axis=0).argmax() / SR:.2f} s)")
    # attacks: level of the 500 Hz - 4 kHz band (where the plucks live) in 30 ms windows, 10 ms apart
    band = signal.sosfiltfilt(signal.butter(4, [500, 4000], btype="bandpass", fs=SR, output="sos"), x.mean(axis=0))
    lvl = db(np.sqrt(np.mean(frames(band, 1323, 441) ** 2, axis=1)))
    rise = np.diff(lvl)
    print(f"attacks   fastest rise of the 0.5-4 kHz level: {rise.max():.2f} dB per 10 ms (at {rise.argmax() * 0.01:.2f} s); "
          f"fastest fall {rise.min():.2f} dB per 10 ms")

    corr = float(np.corrcoef(x[0], x[1])[0, 1])
    win = frames(x, SR, SR // 2)
    c1 = np.array([np.corrcoef(win[0, i], win[1, i])[0, 1] for i in range(win.shape[1])])
    mid, side = x.mean(axis=0), 0.5 * (x[0] - x[1])
    lr = 0.5 * (np.sqrt(np.mean(x[0] ** 2)) + np.sqrt(np.mean(x[1] ** 2)))
    print(f"stereo    L/R correlation {corr:.3f} overall; per second from {c1.min():.3f} to {c1.max():.3f}")
    print(f"          mono sum is {db(np.sqrt(np.mean(mid ** 2)) / lr):+.2f} dB against one channel; "
          f"side is {db(np.sqrt(np.mean(side ** 2)) / np.sqrt(np.mean(mid ** 2))):+.1f} dB against mid")
    print(f"          channel balance L-R {db(np.sqrt(np.mean(x[0] ** 2)) / np.sqrt(np.mean(x[1] ** 2))):+.2f} dB")

    f, p = signal.welch(mid, SR, nperseg=8192)
    total = p.sum()
    for lo in (150, 1000, 3000, 6000, 9000):
        print(f"spectrum  energy above {lo} Hz: {10 * np.log10(p[f >= lo].sum() / total):.1f} dB of the total")
    edges = [0, 100, 200, 400, 800, 1600, 3200, 6000, 9000, 22050]
    print("          by band: " + ", ".join(
        f"{a}-{b} Hz {10 * np.log10(max(p[(f >= a) & (f < b)].sum() / total, 1e-12)):.0f} dB"
        for a, b in zip(edges[:-1], edges[1:])))
    sec = frames(mid, SR, SR // 4)
    lv = db(np.sqrt(np.mean(sec ** 2, axis=1)))
    print(f"silence   quietest 1 s window {lv.min():.1f} dBFS, loudest {lv.max():.1f} dBFS, "
          f"mean level {db(np.sqrt(np.mean(mid ** 2))):.1f} dBFS")

    join_report(x, "decoded AAC, played twice in a row")
    gap = np.concatenate([x, np.zeros((2, int(0.010 * SR)))], axis=1)
    join_report(gap, "worst case: the player inserts 10 ms of silence at the loop")

    # ------------------------------------------------------------ pictures
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    def spectro(sig, t0, title, name, nper, hop, fmax, log=True):
        ff, tm, sx = signal.spectrogram(sig, SR, nperseg=nper, noverlap=nper - hop, window="hann", mode="magnitude")
        fig, ax = plt.subplots(figsize=(16, 6), dpi=100)
        keep = (ff >= 40) & (ff <= fmax)
        im = ax.pcolormesh(tm + t0, ff[keep], db(sx[keep]), vmin=-100, vmax=-25,
                           cmap="magma", shading="auto")
        if log:
            ax.set_yscale("log")
            ax.set_yticks([50, 100, 200, 500, 1000, 2000, 5000, 10000])
            ax.set_yticklabels(["50", "100", "200", "500", "1k", "2k", "5k", "10k"])
        ax.set_xlabel("seconds")
        ax.set_ylabel("Hz")
        ax.set_title(title)
        fig.colorbar(im, ax=ax, label="dBFS")
        fig.tight_layout()
        out = os.path.join(pics, name)
        fig.savefig(out)
        plt.close(fig)
        return out

    made = [spectro(mid, 0.0, "Midbar: whole loop (mid channel)", "whole.png", 8192, 2048, 16000)]
    two = np.concatenate([mid, mid])
    a, b = n - 2 * SR, n + 2 * SR
    made.append(spectro(two[a:b], -2.0, "Join: last 2 s + first 2 s (0 = loop point)", "join.png", 2048, 128, 16000))
    made.append(spectro(two[a:b], -2.0, "Join, linear frequency (a click would be a vertical line at 0)",
                        "join-linear.png", 512, 32, 12000, log=False))
    made.append(spectro(side, 0.0, "Midbar: side channel (L-R)/2", "side.png", 8192, 2048, 16000))

    fig, ax = plt.subplots(3, 1, figsize=(16, 9), dpi=100)
    ax[0].plot(tt, ss, label="short-term (3 s)")
    ax[0].plot(tt, mm, lw=0.6, label="momentary (0.4 s)")
    ax[0].set_ylim(-30, -10)
    ax[0].set_ylabel("LUFS")
    ax[0].legend(loc="lower right")
    ax[0].set_title("Loudness over the loop")
    ax[1].plot(np.arange(len(c1)) / 2, c1)
    ax[1].set_ylim(0, 1)
    ax[1].set_ylabel("L/R correlation, 1 s")
    w = int(0.05 * SR)
    seg = np.arange(-w, w)
    ax[2].plot(seg / SR * 1000, np.concatenate([x[0], x[0]])[n + seg], label="left")
    ax[2].plot(seg / SR * 1000, np.concatenate([x[1], x[1]])[n + seg], label="right")
    ax[2].axvline(0, color="k", lw=0.5)
    ax[2].set_xlabel("ms around the loop point (waveform)")
    ax[2].legend(loc="lower right")
    fig.tight_layout()
    out = os.path.join(pics, "levels.png")
    fig.savefig(out)
    plt.close(fig)
    made.append(out)
    print("\npictures")
    for m in made:
        print("  " + m)


if __name__ == "__main__":
    main()
