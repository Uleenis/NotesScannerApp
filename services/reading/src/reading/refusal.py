class RefusalError(Exception):
    def __init__(self, status: int, code: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code


def invalid_request() -> RefusalError:
    return RefusalError(400, "invalid_request")


def invalid_photo() -> RefusalError:
    return RefusalError(400, "invalid_photo")


def too_large() -> RefusalError:
    return RefusalError(413, "too_large")


def unsupported() -> RefusalError:
    return RefusalError(415, "unsupported_media_type")


def too_complex() -> RefusalError:
    return RefusalError(422, "too_complex")


def busy() -> RefusalError:
    return RefusalError(503, "busy")
