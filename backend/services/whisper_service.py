"""
Local Whisper transcription service.

Install:  pip install openai-whisper
The first call downloads the 'base' model (~145 MB) from HuggingFace.
Transcriptions are cached to disk in transcript_cache/ so each clip
is only processed once even across server restarts.
"""
import asyncio
import hashlib
import json
import os
import tempfile
from pathlib import Path

import httpx

CACHE_DIR = Path(__file__).parent.parent / "transcript_cache"
_MODEL_NAME = "base"   # tiny=75MB  base=145MB  small=466MB  medium=1.5GB
_model = None          # loaded lazily on first request


def _load_model():
    import whisper as _whisper  # noqa: PLC0415
    return _whisper.load_model(_MODEL_NAME)


def _run_transcription(model, path: str) -> str:
    result = model.transcribe(
        path,
        language="en",  # team radio is always English
        fp16=False,      # safer on CPU (no half-precision)
        verbose=False,
    )
    return result["text"].strip()


async def get_model():
    """Lazily load the Whisper model in a thread pool (blocking call)."""
    global _model
    if _model is None:
        loop = asyncio.get_running_loop()
        _model = await loop.run_in_executor(None, _load_model)
    return _model


async def transcribe_url(audio_url: str) -> str:
    """Return the transcription for *audio_url*, fetching and transcribing if needed."""
    CACHE_DIR.mkdir(exist_ok=True)

    # Stable cache key: MD5 of URL
    key = hashlib.md5(audio_url.encode()).hexdigest()
    cache_file = CACHE_DIR / f"{key}.json"

    # Cache hit — return immediately without downloading or running Whisper
    if cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))["text"]

    # Download audio clip
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(audio_url)
        r.raise_for_status()
        audio_bytes = r.content

    # Write to a temp file (Whisper requires a filesystem path)
    suffix = ".mp3" if audio_url.lower().endswith(".mp3") else ".ogg"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        model = await get_model()
        loop = asyncio.get_running_loop()
        text = await loop.run_in_executor(None, _run_transcription, model, tmp_path)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    # Persist to disk cache
    cache_file.write_text(
        json.dumps({"url": audio_url, "text": text}, ensure_ascii=False),
        encoding="utf-8",
    )
    return text
