from PIL import Image

from reading.harvest import Correction, TileLine, harvest
from reading.recognition import TileWord

WORD_WIDTH = 100
GAP = 20


def line_of(words: list[str], height: int = 40) -> TileLine:
    width = len(words) * (WORD_WIDTH + GAP) + GAP
    tiles = []
    for index, text in enumerate(words):
        x0 = GAP + index * (WORD_WIDTH + GAP)
        tiles.append(TileWord(text, float(x0), float(x0 + WORD_WIDTH), 0.99))
    image = Image.new("L", (width, height), 255)
    for index in range(width):
        image.putpixel((index, 0), index % 256)
    return TileLine(image, tuple(tiles))


def never(a: str, b: str, language: str) -> bool:
    return False


def always(a: str, b: str, language: str) -> bool:
    return True


def texts(
    b1: str, lines: list[TileLine], corrections: dict[int, Correction] | None = None, language: str | None = "fr"
) -> list[str]:
    return [sample.text for sample in harvest(b1, lines, corrections or {}, language, never)]


def test_a_line_where_a_and_b1_agree_is_kept_whole() -> None:
    line = line_of(["Le", "chat", "dort"])
    samples = harvest("Le chat dort", [line], {}, "fr", never)
    assert [sample.text for sample in samples] == ["Le chat dort"]
    assert samples[0].image.size == line.image.size
    assert samples[0].image.tobytes() == line.image.tobytes()


def test_the_longest_run_of_agreeing_words_is_kept() -> None:
    assert texts("Le chat dort sur le tapis", [line_of(["Le", "chot", "dort", "sur", "le", "tapis"])]) == [
        "dort sur le tapis"
    ]


def test_agreement_is_to_the_character_case_included() -> None:
    assert texts("le Chat dort", [line_of(["le", "chat", "dort"])]) == ["le"]


def test_one_run_per_line_and_none_for_a_line_without_agreement() -> None:
    b1 = "Le chat dort\nLa pluie tombe"
    assert texts(b1, [line_of(["Le", "chat", "dort"]), line_of(["Lo", "pliie", "tambe"])]) == ["Le chat dort"]


def test_the_cut_falls_in_the_middle_of_the_gap_with_the_next_word() -> None:
    line = line_of(["Le", "chat", "dort", "xyz"])
    samples = harvest("Le chat dort bien", [line], {}, "fr", never)
    assert [sample.text for sample in samples] == ["Le chat dort"]
    end_of_dort = GAP + 2 * (WORD_WIDTH + GAP) + WORD_WIDTH
    start_of_next = end_of_dort + GAP
    assert samples[0].image.width == (end_of_dort + start_of_next) // 2


def test_the_cut_falls_in_the_middle_of_the_gap_with_the_previous_word() -> None:
    line = line_of(["xyz", "chat", "dort"])
    samples = harvest("Le chat dort", [line], {}, "fr", never)
    end_of_first = GAP + WORD_WIDTH
    left = (end_of_first + end_of_first + GAP) // 2
    assert samples[0].image.width == line.image.width - left
    assert samples[0].image.getpixel((0, 0)) == left % 256


def test_a_corrected_word_counts_as_agreeing_with_the_corrected_text() -> None:
    corrections = {1: Correction(1, "chat", "chot")}
    assert texts("Le chot dort", [line_of(["Le", "chot", "dort"])], corrections) == ["Le chat dort"]


def test_a_corrected_word_keeps_the_punctuation_read_around_it() -> None:
    corrections = {1: Correction(1, "chat", "chot")}
    assert texts("Le chot, dort", [line_of(["Le", "chot,", "dort"])], corrections) == ["Le chat, dort"]


def test_a_homophone_correction_one_edit_from_a_is_left_out() -> None:
    corrections = {1: Correction(1, "à", "a")}
    samples = harvest("Il a la maison", [line_of(["Il", "a", "la", "maison"])], corrections, "fr", always)
    assert [sample.text for sample in samples] == ["la maison"]


def test_a_correction_that_sounds_the_same_but_is_further_from_a_is_kept() -> None:
    corrections = {1: Correction(1, "vers", "verre")}
    samples = harvest("Un verre plein", [line_of(["Un", "verre", "plein"])], corrections, "fr", always)
    assert [sample.text for sample in samples] == ["Un vers plein"]


def test_a_correction_in_another_language_is_not_fed() -> None:
    corrections = {1: Correction(1, "Haus", "Hous")}
    assert texts("Das Hous ist gross", [line_of(["Das", "Hous", "ist", "gross"])], corrections, "de") == ["ist gross"]


def test_a_word_of_b1_missing_from_a_cuts_the_run() -> None:
    assert texts("Le petit chat dort bien", [line_of(["Le", "chat", "dort", "bien"])]) == ["chat dort bien"]


def test_a_word_of_a_missing_from_b1_cuts_the_run() -> None:
    assert texts("Le chat dort", [line_of(["Le", "gros", "chat", "dort"])]) == ["chat dort"]


def test_a_correction_needs_a_word_read_by_a() -> None:
    corrections = {1: Correction(1, "petit", "pet")}
    assert texts("Le petit chat", [line_of(["Le"]), line_of([])], corrections) == ["Le"]


def test_a_run_narrower_than_eight_pixels_is_dropped() -> None:
    line = TileLine(
        Image.new("L", (30, 20), 255),
        (TileWord("a", 0.0, 3.0, 0.9), TileWord("zz", 3.0, 6.0, 0.9), TileWord("b", 6.0, 30.0, 0.9)),
    )
    assert texts("a xx yy", [line]) == []


def test_a_line_read_empty_is_a_hole_and_the_next_lines_still_pair() -> None:
    b1 = "La pluie tombe\nLe chat dort"
    assert texts(b1, [line_of([]), line_of(["Le", "chat", "dort"])]) == ["Le chat dort"]
