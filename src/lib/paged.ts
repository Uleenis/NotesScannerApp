export const PAGE_ROWS = 1000;
export const MAX_ROWS = 100_000;

type Chunk = { data: unknown; error: unknown };

export async function readAllRows(fetchRows: (from: number, to: number) => PromiseLike<Chunk>): Promise<unknown[] | null> {
  const rows: unknown[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_ROWS) {
    const { data, error } = await fetchRows(from, from + PAGE_ROWS - 1);
    if (error || !Array.isArray(data)) {
      return null;
    }
    rows.push(...data);
    if (data.length < PAGE_ROWS) {
      return rows;
    }
  }
  return null;
}
