"""A synthetic to-camera take with a known right answer, for evaluating an agent.

Spoken by a macOS system voice (`say`), so there is no real person's footage in the
repo. The take is a mess on purpose: chatter, a false start, a line said badly then
well, a line broken off and redone. The `GOOD` lines are what a careful editor keeps;
`BAD` fragments must not survive into the cut.

    uv run python evals/fixture.py [outdir]     → <outdir>/take.mp4
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

VOICE = "Daniel"

# (text, pause after in seconds). Order is recording order.
TAKE = [
    ("Okay, rolling. One two three.", 1.4),
    ("Today we're gonna look at- no, hang on.", 0.9),                               # false start: nothing in it can stand alone
    ("Today we are going to look at three things.", 1.0),                           # incomplete retake of line A
    ("Today we are going to look at three things about cooking pasta.", 1.2),       # A (good)
    ("First, salt the water well.", 0.7),                                           # B, first go
    ("First, salt the water- sorry.", 1.0),                                         # B broken off
    ("First, salt the water properly, until it tastes like the sea.", 1.2),         # B (good)
    ("Second, never rinse the pasta.", 0.8),                                        # C, first go
    ("That was rubbish, one more time.", 1.3),                                      # chatter
    ("Second, never rinse the pasta, because the starch helps the sauce stick.", 1.2),  # C (good)
    ("Third, save a cup of the cooking water.", 1.0),                               # D (good)
    ("And that's it. Thanks for watching.", 1.5),                                   # E (good)
]

# What the cut must contain (compared after lower-casing and dropping punctuation).
GOOD = [
    "three things about cooking pasta",
    "until it tastes like the sea",
    "because the starch helps the sauce stick",
    "save a cup of the cooking water",
    "thanks for watching",
]
# What must not appear anywhere in the cut.
BAD = ["rolling", "sorry", "rubbish", "one more time", "gonna", "hang on"]
# Lines that must appear exactly once (no retake left in).
ONCE = ["look at three things", "salt the water", "never rinse the pasta"]


def build(outdir: Path) -> Path:
    if not shutil.which("say"):
        sys.exit("evals/fixture.py needs macOS `say` to speak the script (no footage is stored in the repo)")
    outdir.mkdir(parents=True, exist_ok=True)
    out = outdir / "take.mp4"
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        parts = []
        for i, (text, pause) in enumerate(TAKE):
            aiff, wav, gap = td / f"u{i}.aiff", td / f"u{i}.wav", td / f"g{i}.wav"
            subprocess.run(["say", "-v", VOICE, "-r", "175", "-o", str(aiff), text], check=True)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(aiff), "-ar", "48000", "-ac", "1", str(wav)], check=True)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"anullsrc=r=48000:cl=mono", "-t", str(pause), str(gap)], check=True)
            parts += [wav, gap]
        listing = td / "list.txt"
        listing.write_text("".join(f"file '{p}'\n" for p in parts))
        speech = td / "speech.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(speech)], check=True)
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(speech)],
                                   capture_output=True, text=True, check=True).stdout)
        # room tone under the speech, so the gaps are not digital silence
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(speech), "-f", "lavfi", "-i", f"anoisesrc=d={dur}:c=pink:r=48000:a=0.004",
                        "-f", "lavfi", "-i", f"color=c=0x2F4F6F:s=1280x720:r=25:d={dur}",
                        "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=first:normalize=0[a]",
                        "-map", "[a]", "-map", "2:v", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(out)],
                       check=True)
    return out


if __name__ == "__main__":
    print(build(Path(sys.argv[1] if len(sys.argv) > 1 else ".evals-cache/pasta")))
