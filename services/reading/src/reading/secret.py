from collections.abc import Mapping

GATE_VARIABLE = "READING_SECRET"
MINIMUM_LENGTH = 32


class SecretError(Exception):
    pass


def check_secret(secret: str, name: str = GATE_VARIABLE) -> str:
    if secret == "":
        raise SecretError(f"{name} is not set: the service does not start without it")
    if secret != secret.strip():
        raise SecretError(f"{name} starts or ends with a space")
    if len(secret) < MINIMUM_LENGTH:
        raise SecretError(f"{name} is shorter than {MINIMUM_LENGTH} characters")
    return secret


def load_secret(environ: Mapping[str, str]) -> str:
    return check_secret(environ.get(GATE_VARIABLE, ""))
