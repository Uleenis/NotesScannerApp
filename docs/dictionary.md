# Dictionary

`private.dictionary_words` holds the general dictionary of the lexicon (migration `20261029120000_t7_dictionary.sql`, built by `supabase/dictionary/build.mjs`). It lives in the database only, is never sent to the app and is not a part of the app bundle.

| Source | Version | Licence |
|---|---|---|
| `wfrench` (French word list, Debian) | 1.2.9 | GNU General Public License, version 3 or later |
| `wamerican` (SCOWL, English word list, Debian), lowercase entries only | 2020.12.07 | SCOWL licence: copyright 2000-2011 Kevin Atkinson, permission to use, copy, modify and distribute without fee provided the notice stays |

The French list follows the spelling of before 1990. The English list keeps only the entries written in lowercase, so proper nouns are not in the dictionary.

To rebuild the migration, download both lists and run `node supabase/dictionary/build.mjs <french list> <english list> <migration>`. The "Licences" screen of the app lists both entries.
