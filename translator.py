import re
import asyncio
from deep_translator import GoogleTranslator

MAX_CHARS = 4500  # GoogleTranslator limit is 5000; stay safe


def strip_html(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html).strip()


def _translate_chunk(text: str, target: str) -> str:
    return GoogleTranslator(source="auto", target=target).translate(text) or text


def translate_sync(text: str, target: str) -> str:
    """Translate text synchronously. target: 'zh-TW' or 'ja'"""
    clean = strip_html(text)
    if not clean:
        return text

    # Chunk if too long
    if len(clean) <= MAX_CHARS:
        try:
            return _translate_chunk(clean, target)
        except Exception:
            return text

    # Split by sentences and translate in chunks
    sentences = re.split(r"(?<=[.!?。！？])\s+", clean)
    chunks, current = [], ""
    for s in sentences:
        if len(current) + len(s) + 1 > MAX_CHARS:
            chunks.append(current.strip())
            current = s
        else:
            current += " " + s
    if current.strip():
        chunks.append(current.strip())

    results = []
    for chunk in chunks:
        try:
            results.append(_translate_chunk(chunk, target))
        except Exception:
            results.append(chunk)

    return " ".join(results)


async def translate_async(text: str, target: str) -> str:
    """Non-blocking wrapper for use inside asyncio event loop."""
    return await asyncio.to_thread(translate_sync, text, target)
