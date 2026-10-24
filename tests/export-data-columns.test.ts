import * as ts from "typescript";

import { EXPORTED_COLUMNS } from "@/export/data/read";

const root = ts.sys.getCurrentDirectory();
const scope = ts.sys.readFile(`${root}/supabase/tests/database/my-data-scope.test.sql`) ?? "";

test("the database test of the export reads the very columns the app reads, table by table", () => {
  const missing = Object.entries(EXPORTED_COLUMNS)
    .filter(([table, columns]) => !scope.includes(`select ${columns} from public.${table}`))
    .map(([table]) => table);
  expect(missing).toEqual([]);
});

test("no exported table is left out of the database test", () => {
  expect(Object.keys(EXPORTED_COLUMNS).sort()).toEqual(
    [
      "chapters",
      "corrections",
      "lexicon_entries",
      "notebooks",
      "page_alerts",
      "page_charges",
      "page_gaps",
      "page_images",
      "page_texts",
      "page_tokens",
      "pages",
      "profiles",
      "readings",
    ].sort(),
  );
});

test("the app never reads a column that carries an account identifier", () => {
  const columns = Object.entries(EXPORTED_COLUMNS).flatMap(([table, list]) =>
    list
      .split(",")
      .map((column) => column.trim())
      .filter((column) => column === "user_id")
      .map((column) => `${table}.${column}`),
  );
  expect(columns).toEqual([]);
});
