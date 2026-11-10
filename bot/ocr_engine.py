import aiohttp
import asyncio
import math
import re
import io
import os
from PIL import Image

def clean_val(v_str):
    try:
        m = re.match(r'\s*([\d.,]+)\s*([KMB])?', str(v_str).upper())
        if not m: return 0.0
        num = m.group(1)
        if "." in num and "," in num:
            num = num.replace(",", "")          # 1,234.5 -> 1234.5
        elif "," in num:
            parts = num.split(",")
            num = "".join(parts) if all(len(p) == 3 for p in parts[1:]) else num.replace(",", ".")
        try:
            value = float(num)
        except ValueError:
            return 0.0
        value *= {'K': 1e3, 'M': 1e6, 'B': 1e9}.get(m.group(2), 1)
        if not math.isfinite(value) or abs(value) > 1e15:
            return 0.0
        return value
    except (ValueError, AttributeError, OverflowError):
        return 0.0


def _fraction_number(text):
    """OCR digits -> the form clean_val understands (keep ',', fix O/o for 0)."""
    return str(text or "").replace('O', '0').replace('o', '0').upper()


def _prepare_jpeg(image_bytes):
    """Decode, crop to the race columns and compress to a <1MB JPEG."""
    # `with` guarantees the decoded bitmap is released even on error.
    with Image.open(io.BytesIO(image_bytes)) as source:
        w, h = source.size
        img = source.crop((int(w * 0.55), 0, w, h)).convert('RGB')
        best = b""
        for quality in (90, 80, 70, 60, 50):
            buf = io.BytesIO()
            img.save(buf, format='JPEG', quality=quality)
            best = buf.getvalue()
            if len(best) < 1_000_000:
                break
        return best


async def process_race_image(image_bytes):
    try:
        api_key = os.environ.get("OCR_SPACE_API_KEY")
        if not api_key:
            print("❌ Missing OCR_SPACE_API_KEY in environment variables.")
            return None

        # Pillow decode/crop/encode is CPU work: keep it off the event loop.
        jpeg = await asyncio.to_thread(_prepare_jpeg, image_bytes)

        payload = {'language': 'eng', 'isOverlayRequired': 'true', 'isTable': 'false', 'OCREngine': '2'}
        headers = {'apikey': api_key}
        
        form = aiohttp.FormData()
        form.add_field('file', jpeg, filename='scan.jpg', content_type='image/jpeg')
        for k, v in payload.items():
            form.add_field(k, v)

        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=25)) as session:
            async with session.post('https://api.ocr.space/parse/image', data=form, headers=headers) as resp:
                data = await resp.json(content_type=None)

        if data.get("IsErroredOnProcessing"):
            return None

        res = (data.get("ParsedResults") or [{}])[0]
        lines = (res.get("TextOverlay") or {}).get("Lines") or []
        
        if not lines: return None

        headers_y = {}
        for ln in lines:
            text = ln.get("LineText", "").lower()
            if "for all" in text or "one for" in text: headers_y["ofa"] = ln.get("MinTop")
            elif "your part" in text or "do your" in text: headers_y["dyp"] = ln.get("MinTop")
            elif "joint" in text or "effort" in text: headers_y["je"] = ln.get("MinTop")

        if len(headers_y) != 3: return None

        sorted_h = sorted(headers_y.items(), key=lambda x: x[1])
        FRAC = re.compile(r'([\dOo]+(?:[.,]\d+)?(?:\s*[KMB]\b)?)\s*[/|\\]\s*(\d+(?:[.,]\d+)?(?:\s*[KMB]\b)?)', re.IGNORECASE)
        bounds = [y for _, y in sorted_h] + [10**9]
        extracted_data = {}
        
        for i, (key, h_y) in enumerate(sorted_h):
            cands = []
            for ln in lines:
                top = ln.get("MinTop", 0)
                if h_y <= top < bounds[i + 1]:
                    for m in FRAC.finditer(ln.get("LineText", "")):
                        # Do not turn thousands separators into decimal points:
                        # "1,200" must stay 1200, not 1.2.
                        prog = _fraction_number(m.group(1))
                        targ = _fraction_number(m.group(2))
                        cands.append((top, prog, targ))
            if cands:
                best = min(cands)
                extracted_data[key] = {"progress": best[1], "target": best[2]}

        if len(extracted_data) != 3: return None

        for key in ["ofa", "je"]:
            if key in extracted_data:
                p_str = extracted_data[key]["progress"]
                t_str = extracted_data[key]["target"]
                if clean_val(p_str) > clean_val(t_str):
                    extracted_data[key]["progress"] = t_str

        def get_task_text(start_y, end_y=None):
            text = ""
            for ln in lines:
                if start_y <= ln.get("MinTop", 0) and (end_y is None or ln.get("MinTop", 0) < end_y):
                    text += ln.get("LineText", "") + " "
            return text.lower()

        ofa_text = get_task_text(headers_y["ofa"], headers_y["dyp"])
        dyp_text = get_task_text(headers_y["dyp"], headers_y["je"])
        je_text = get_task_text(headers_y["je"])

        def extract_task(text_block, default_task):
            if "collect" in text_block and "gold" in text_block: return "Collect Gold"
            if "collect" in text_block and "food" in text_block: return "Collect Food"
            if "hatch" in text_block: return "Hatch Monsters"
            if "breed" in text_block: return "Breed Monsters"
            if "rank up" in text_block: return "Rank Up Monsters"
            if "level up" in text_block and "relic" in text_block:
                if "gold relic" in text_block: return "Level Up Gold Relics"
                if "silver relic" in text_block: return "Level Up Silver Relics"
                return "Level Up Relics"
            if "craft" in text_block:
                lv = re.search(r'(?:lvl|l|level)\s*(\d+)', text_block)
                if lv: return f"Craft Level {lv.group(1)} Runes"
                return "Craft Runes"
            if re.search(r'\bwin\b', text_block): return "Win Battles"
            if "feed" in text_block: return "Feed Food"
            return default_task

        def norm(t):
            return re.sub(r'(\d)\s*([KMB])$', r'\1 \2', t)

        return {
            "ofa": {"progress": norm(extracted_data["ofa"]["progress"]), "target": norm(extracted_data["ofa"]["target"]), "task": extract_task(ofa_text, "Race Task")},
            "dyp": {"progress": int(clean_val(extracted_data["dyp"]["progress"])), "target": int(clean_val(extracted_data["dyp"]["target"])), "task": extract_task(dyp_text, "Race Task")},
            "je":  {"progress": norm(extracted_data["je"]["progress"]), "target": norm(extracted_data["je"]["target"]), "task": extract_task(je_text, "Race Task")}
        }
    except Exception as e:
        print(f"[OCR Error] {e}", flush=True)
        return None
