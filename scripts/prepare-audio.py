"""Prepare the default engine from one recording. Requires ffmpeg.
Usage: python3 scripts/prepare-audio.py /path/to/extracted-engine-archive
See public/CREDITS.md for the source and license.
"""
from pathlib import Path
import subprocess
import sys

source = Path(sys.argv[1]) / 'engine-loop' / 'engine-loop-1-normalized.wav'
output = Path(__file__).resolve().parents[1] / 'public' / 'sounds'
output.mkdir(parents=True, exist_ok=True)
subprocess.run([
    'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', '0.1', '-i', str(source), '-t', '3.8',
    '-af', 'highpass=f=35,lowpass=f=6500,loudnorm=I=-18:TP=-3:LRA=7',
    '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', str(output / 'engine.wav'),
], check=True)
print('Prepared engine.wav from one continuous recording.')
