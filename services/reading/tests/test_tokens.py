from reading.tokens import Token, line_tokens, tokens_of

ACUTE = chr(0x301)
CURLY = chr(0x2019)
EM_DASH = chr(0x2014)


def texts(text: str) -> list[str]:
    return [token.text for token in tokens_of(text)]


def forms(text: str) -> list[str]:
    return [token.form for token in tokens_of(text)]


def test_words_keep_their_case() -> None:
    assert texts("Paris est Belle") == ["Paris", "est", "Belle"]
    assert forms("Paris est Belle") == ["Paris", "est", "Belle"]


def test_words_keep_their_apostrophes_and_hyphens() -> None:
    assert texts("l'homme est-il là") == ["l'homme", "est-il", "là"]


def test_a_curly_apostrophe_is_kept_in_the_word_and_unified_in_its_form() -> None:
    assert tokens_of(f"l{CURLY}homme") == [Token(f"l{CURLY}homme", "l'homme")]


def test_a_long_dash_joins_like_a_hyphen_and_is_unified_in_the_form() -> None:
    assert tokens_of(f"oui{EM_DASH}non") == [Token(f"oui{EM_DASH}non", "oui-non")]


def test_punctuation_is_not_a_word() -> None:
    assert texts("Bonjour, toi ! (oui) ; 12/05/2026.") == ["Bonjour", "toi", "oui", "12", "05", "2026"]


def test_a_lone_dash_or_apostrophe_is_not_a_word() -> None:
    assert texts("- pain\n' lait -- '") == ["pain", "lait"]


def test_the_illegible_mark_is_one_word() -> None:
    assert texts("il [?] demain") == ["il", "[?]", "demain"]


def test_decomposed_accents_are_read_composed() -> None:
    assert texts(f"e{ACUTE}te{ACUTE} chaud") == ["été", "chaud"]


def test_words_outside_the_latin_letters_are_left_out_as_in_the_spikes() -> None:
    greek = "".join(map(chr, (0x3B3, 0x3AC, 0x3C4, 0x3B1)))
    assert texts(f"cat {greek} dog") == ["cat", "dog"]


def test_each_word_knows_its_line_counting_empty_lines() -> None:
    assert [(token.text, line) for token, line in line_tokens("Le chat\n\n  dort ici\nfin")] == [
        ("Le", 0),
        ("chat", 0),
        ("dort", 2),
        ("ici", 2),
        ("fin", 3),
    ]


def test_line_tokens_and_tokens_agree() -> None:
    text = "Jour 12 : l'été\r\narrive -- enfin\n[?] oui"
    assert [token for token, _ in line_tokens(text)] == tokens_of(text)


def test_no_text_no_word() -> None:
    assert tokens_of("") == []
    assert line_tokens(" \n\n") == []
