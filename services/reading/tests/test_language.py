import pytest

from reading.language import Lingua

DETECTOR = Lingua()


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        pytest.param("Aujourd'hui je suis allé au marché avec ma soeur, il faisait beau.", "fr", id="french"),
        pytest.param("Today I went to the market with my sister after the class.", "en", id="english"),
        pytest.param("Hoy fui al mercado con mi hermana y compramos fruta.", "es", id="spanish"),
        pytest.param("Ich bin heute mit meiner Schwester in die Stadt gegangen.", "de", id="german"),
    ],
)
def test_the_language_of_a_page_is_two_lowercase_letters(text: str, expected: str) -> None:
    assert DETECTOR.language_of(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        pytest.param("", id="empty"),
        pytest.param("Paris", id="one word"),
        pytest.param("pain lait oeufs beurre", id="four words"),
        pytest.param("12/05/2026 14h30 - 3 x 4 = 12", id="numbers"),
    ],
)
def test_a_page_too_short_has_no_language(text: str) -> None:
    assert DETECTOR.language_of(text) is None


def test_a_page_whose_language_is_unclear_has_no_language() -> None:
    assert DETECTOR.language_of("Rendez-vous chez le dentiste mardi 14h") is None
