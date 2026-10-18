import json
import os
from collections.abc import Sequence
from pathlib import Path

import numpy as np
from tokenizers import Tokenizer

from reading.refusal import too_complex
from reading.tokens import form_of, token_spans

SCOPE = {"PER", "LOC", "ORG", "MISC"}
WINDOW = 510
MAX_PIECES = 15_000
BRACKETS = "<>" + "".join(map(chr, (0xFE64, 0xFE65, 0xFF1C, 0xFF1E)))
NEUTRAL = str.maketrans(BRACKETS, " " * len(BRACKETS))
UNKNOWN = "<unk>"
OUTSIDE = "O"
TELEMETRY_SWITCH = "ORT_DISABLE_TELEMETRY"

Span = tuple[int, int]


def kind_of(label: str) -> str:
    return OUTSIDE if label == OUTSIDE else label.split("-", 1)[-1]


def first_label(word: Span, pieces: Sequence[tuple[Span, str]], cursor: int) -> tuple[str, int]:
    start, end = word
    while cursor < len(pieces) and pieces[cursor][0][1] <= start:
        cursor += 1
    k = cursor
    while k < len(pieces) and pieces[k][0][0] < end:
        if pieces[k][0][1] > start:
            return pieces[k][1], cursor
        k += 1
    return OUTSIDE, cursor


class Camembert:
    def __init__(self, directory: Path) -> None:
        if os.environ.get(TELEMETRY_SWITCH) != "1":
            raise RuntimeError(f"{TELEMETRY_SWITCH} must be 1 before onnxruntime is loaded")
        import onnxruntime

        self._tokenizer = Tokenizer.from_file(str(directory / "tokenizer.json"))
        options = onnxruntime.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.log_severity_level = 3
        self._session = onnxruntime.InferenceSession(
            str(directory / "model.onnx"), sess_options=options, providers=["CPUExecutionProvider"]
        )
        self._inputs = {item.name for item in self._session.get_inputs()}
        config = json.loads((directory / "config.json").read_text(encoding="utf-8"))
        self._labels = [str(config["id2label"][str(i)]) for i in range(len(config["id2label"]))]
        wrapped = self._tokenizer.encode("x").ids
        self._start, self._end = wrapped[0], wrapped[-1]
        unknown = self._tokenizer.token_to_id(UNKNOWN)
        if unknown is None:
            raise RuntimeError("the tokenizer has no unknown token")
        self._unknown: int = unknown
        added = self._tokenizer.get_added_tokens_decoder()
        self._special = {index for index, token in added.items() if token.special} - {self._unknown}

    def labels(self, text: str) -> list[str]:
        form = form_of(text)
        pieces = self._pieces(form)
        out = []
        cursor = 0
        for word in token_spans(text):
            label, cursor = first_label(word, pieces, cursor)
            out.append(kind_of(label))
        return out

    def flags(self, text: str) -> list[bool]:
        return [label in SCOPE for label in self.labels(text)]

    def _pieces(self, form: str) -> list[tuple[Span, str]]:
        encoded = self._tokenizer.encode(form.translate(NEUTRAL), add_special_tokens=False)
        if len(encoded.ids) > MAX_PIECES:
            raise too_complex()
        pieces: list[tuple[Span, str]] = []
        for first in range(0, len(encoded.ids), WINDOW):
            ids = [self._unknown if i in self._special else i for i in encoded.ids[first : first + WINDOW]]
            offsets = encoded.offsets[first : first + WINDOW]
            for offset, best in zip(offsets, self._best(ids), strict=True):
                pieces.append(((int(offset[0]), int(offset[1])), self._labels[best]))
        return pieces

    def _best(self, ids: Sequence[int]) -> list[int]:
        sequence = [self._start, *ids, self._end]
        batch = {
            "input_ids": np.array([sequence], dtype=np.int64),
            "attention_mask": np.ones((1, len(sequence)), dtype=np.int64),
        }
        if "token_type_ids" in self._inputs:
            batch["token_type_ids"] = np.zeros((1, len(sequence)), dtype=np.int64)
        logits = np.asarray(self._session.run(None, batch)[0])[0][1:-1]
        return [int(row.argmax()) for row in logits]
