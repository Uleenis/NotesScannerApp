import { readFileSync, writeFileSync } from "node:fs";

const [frenchPath, englishPath, outPath] = process.argv.slice(2);
if (!frenchPath || !englishPath || !outPath) {
  console.error("usage: node build.mjs <french-list> <english-list> <migration.sql>");
  process.exit(1);
}

const ACCEPTED = /^[\p{L}][\p{L}'-]*$/u;

function words(path, keep) {
  const found = new Set();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const entry = line.normalize("NFC").trim();
    if (!entry || !keep(entry)) continue;
    const word = entry.replace(/’/g, "'").toLowerCase();
    if (word.endsWith("'s") || !ACCEPTED.test(word) || word.length > 40) continue;
    found.add(word);
  }
  return found;
}

const french = words(frenchPath, () => true);
const english = words(englishPath, (entry) => entry === entry.toLowerCase());
const all = [...new Set([...french, ...english])].sort();

if (all.some((word) => word.includes("$"))) {
  throw new Error("a word contains the quote delimiter");
}

const sql = [
  "create table private.dictionary_words (",
  "  word text primary key check (word <> '' and char_length(word) <= 40)",
  ");",
  "",
  "revoke all on private.dictionary_words from public, anon, authenticated;",
  "",
  "alter table private.dictionary_words enable row level security;",
  "",
  "insert into private.dictionary_words (word)",
  "select distinct btrim(w, chr(13) || chr(32))",
  "from unnest(string_to_array($dictionary$" + all.join("\n") + "$dictionary$, chr(10))) as w",
  "where btrim(w, chr(13) || chr(32)) <> '';",
  "",
].join("\n");

writeFileSync(outPath, sql, "utf8");
console.log(`${french.size} French and ${english.size} English forms, ${all.length} in the dictionary`);
