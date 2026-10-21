import * as ts from "typescript";

const root = ts.sys.getCurrentDirectory();
const SERVER_RIGHTS = ["select", "insert", "update", "delete"];

function migrations(): string[] {
  return ts.sys
    .readDirectory(`${root}/supabase/migrations`, [".sql"])
    .sort()
    .map((file) => ts.sys.readFile(file) ?? "");
}

function publicTables(sql: string): string[] {
  return [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map((match) => match[1]);
}

function serverRights(sql: string): Map<string, Set<string>> {
  const rights = new Map<string, Set<string>>();
  for (const match of sql.matchAll(/grant\s+([a-z,\s]+?)\s+on\s+(?:table\s+)?((?:public\.\w+\s*,?\s*)+)\s+to\s+service_role\s*;/gi)) {
    const granted = match[1].split(",").map((right) => right.trim().toLowerCase());
    for (const table of match[2].split(",").map((name) => name.trim().replace(/^public\./, ""))) {
      const known = rights.get(table) ?? new Set<string>();
      granted.forEach((right) => known.add(right));
      rights.set(table, known);
    }
  }
  return rights;
}

test("the migrations create the tables of slice 1", () => {
  expect(publicTables(migrations().join("\n"))).toEqual(
    expect.arrayContaining(["profiles", "pages", "readings", "page_texts", "email_monthly_counts"]),
  );
});

test("the migrations create the tables of slice 2", () => {
  expect(publicTables(migrations().join("\n"))).toEqual(expect.arrayContaining(["page_tokens", "htr_models"]));
});

test("the migrations create the tables of slice 4", () => {
  expect(publicTables(migrations().join("\n"))).toEqual(expect.arrayContaining(["corrections", "page_alerts"]));
});

test("every table in public gives its rights to the server explicitly, as the production project requires", () => {
  const sql = migrations().join("\n");
  const rights = serverRights(sql);
  const missing = publicTables(sql).flatMap((table) =>
    SERVER_RIGHTS.filter((right) => !rights.get(table)?.has(right)).map((right) => `${table}: ${right}`),
  );
  expect(missing).toEqual([]);
});
