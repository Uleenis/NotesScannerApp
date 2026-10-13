import io
import warnings

from PIL import Image, ImageOps

MAX_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 12_000_000
MAX_SIDE = 8000
JPEG_START = b"\xff\xd8\xff"


class RefusalError(Exception):
    def __init__(self, status: int, code: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code


def too_large() -> RefusalError:
    return RefusalError(413, "too_large")


def unsupported() -> RefusalError:
    return RefusalError(415, "unsupported_media_type")


def invalid_photo() -> RefusalError:
    return RefusalError(400, "invalid_photo")


def open_photo(data: bytes) -> Image.Image:
    if len(data) > MAX_BYTES:
        raise too_large()
    if not data.startswith(JPEG_START):
        raise unsupported()
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            image = Image.open(io.BytesIO(data), formats=["JPEG"])
            width, height = image.size
            if not (0 < width <= MAX_SIDE and 0 < height <= MAX_SIDE and width * height <= MAX_PIXELS):
                raise too_large()
            image.load()
            upright = ImageOps.exif_transpose(image)
    except RefusalError:
        raise
    except Exception:
        raise invalid_photo() from None
    if upright.mode != "RGB":
        return upright.convert("RGB")
    return upright
