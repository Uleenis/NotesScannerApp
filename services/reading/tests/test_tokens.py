from reading.tokens import Token, form_of, line_tokens, raw_spans, token_spans, tokens_of

ACUTE = chr(0x301)
DIAERESIS = chr(0x308)
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


def test_the_spans_of_the_words_point_into_their_form_line_after_line() -> None:
    text = f"l{CURLY}homme est-il là\r\n\n  Paris, 12 h - fin\ne{ACUTE}té{EM_DASH}hiver"
    spans = token_spans(text)
    form = form_of(text)
    assert [form[start:end] for start, end in spans] == [token.form for token, _ in line_tokens(text)]


def test_the_places_of_the_words_in_a_composed_text_are_the_spans_of_its_form() -> None:
    text = f"l{CURLY}homme est-il là\r\n\n  Paris, 12 h - fin"
    assert raw_spans(text) == token_spans(text)


def test_the_places_of_the_words_cut_the_text_as_it_was_written() -> None:
    text = f"l{CURLY}homme est-il là\r\n\n  Paris, 12 h - fin\n[?] oui"
    spans = raw_spans(text)
    assert spans is not None
    assert [text[start:end] for start, end in spans] == [
        f"l{CURLY}homme",
        "est-il",
        "là",
        "Paris",
        "12",
        "h",
        "fin",
        "[?]",
        "oui",
    ]


def test_the_places_of_a_decomposed_text_are_counted_in_the_characters_it_has() -> None:
    text = f"e{ACUTE}te{ACUTE} chaud\ne{ACUTE}cole"
    spans = raw_spans(text)
    assert spans is not None
    assert [text[start:end] for start, end in spans] == [f"e{ACUTE}te{ACUTE}", "chaud", f"e{ACUTE}cole"]
    assert len(spans) == len(line_tokens(text))


def test_a_text_with_no_word_has_no_place() -> None:
    assert raw_spans(" - \n") == []
    assert raw_spans("") == []


def test_a_word_that_ends_inside_a_composed_character_has_no_place() -> None:
    text = f"o{DIAERESIS}{ACUTE} oui"
    assert [token.text for token, _ in line_tokens(text)] == ["ö", "oui"]
    assert raw_spans(text) is None
