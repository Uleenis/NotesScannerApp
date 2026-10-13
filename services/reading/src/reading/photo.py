import io

from PIL import Image, ImageOps

from reading.refusal import invalid_photo, too_large, unsupported

MAX_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 12_000_000
MAX_SIDE = 8000
MAX_SCANS = 16
JPEG_START = b"\xff\xd8\xff"
END = 0xD9
SCAN = 0xDA
FILL = 0xFF
STUFFED = 0x00
RESTARTS = frozenset(range(0xD0, 0xD8))
FRAMES = frozenset({0xC0, 0xC1, 0xC2})
TABLES = frozenset({0xC4, 0xDB, 0xDD})
APPLICATIONS = frozenset(range(0xE0, 0xF0))
COMMENT = 0xFE
SEGMENTS = FRAMES | TABLES | APPLICATIONS | {SCAN, COMMENT}


def after_scan(data: bytes, position: int) -> int:
    while True:
        position = data.find(b"\xff", position)
        if position < 0 or position + 1 >= len(data):
            raise invalid_photo()
        following = data[position + 1]
        if following == STUFFED or following in RESTARTS:
            position += 2
            continue
        return position


def check_structure(data: bytes) -> None:
    position = 2
    frames = 0
    scans = 0
    while True:
        if position >= len(data) or data[position] != FILL:
            raise invalid_photo()
        while position < len(data) and data[position] == FILL:
            position += 1
        if position >= len(data):
            raise invalid_photo()
        marker = data[position]
        position += 1
        if marker == END:
            break
        if marker not in SEGMENTS or position + 2 > len(data):
            raise invalid_photo()
        length = int.from_bytes(data[position : position + 2], "big")
        if length < 2 or position + length > len(data):
            raise invalid_photo()
        position += length
        if marker in FRAMES:
            frames += 1
        if marker == SCAN:
            scans += 1
            if frames != 1 or scans > MAX_SCANS:
                raise invalid_photo()
            position = after_scan(data, position)
    if frames != 1 or scans == 0:
        raise invalid_photo()


def open_photo(data: bytes) -> Image.Image:
    if len(data) > MAX_BYTES:
        raise too_large()
    if not data.startswith(JPEG_START):
        raise unsupported()
    check_structure(data)
    try:
        image = Image.open(io.BytesIO(data), formats=["JPEG"])
        width, height = image.size
    except Image.DecompressionBombError:
        raise too_large() from None
    except Exception:
        raise invalid_photo() from None
    if not (0 < width <= MAX_SIDE and 0 < height <= MAX_SIDE and width * height <= MAX_PIXELS):
        raise too_large()
    try:
        image.load()
        upright = ImageOps.exif_transpose(image)
    except Exception:
        raise invalid_photo() from None
    if upright.mode != "RGB":
        return upright.convert("RGB")
    return upright
