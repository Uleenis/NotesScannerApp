import { useState } from "react";

import { alignEdit } from "./edit";
import type { NumberedPage } from "./pages";
import { useEditPage } from "./queries";
import type { PlacedWord } from "./words";

export type EditProblem = "tooBig" | "changed" | "refused" | "failed";

export function useTextEdit(page: NumberedPage, words: PlacedWord[]) {
  const edit = useEditPage(page.id);
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<EditProblem | null>(null);

  function start() {
    setProblem(null);
    setDraft(page.text ?? "");
  }

  function cancel() {
    setProblem(null);
    setDraft(null);
  }

  async function save() {
    if (draft === null || edit.isPending) {
      return;
    }
    const aligned = alignEdit(page.text ?? "", words, draft);
    if (aligned.status === "same") {
      cancel();
      return;
    }
    if (aligned.status === "refused") {
      setProblem("tooBig");
      return;
    }
    setProblem(null);
    const result = await edit.mutateAsync({ text: draft, words: aligned.words, gaps: aligned.gaps }).catch(() => ({ status: "error" }) as const);
    if (result.status === "saved") {
      cancel();
    } else {
      setProblem(result.status === "changed" ? "changed" : result.status === "refused" ? "refused" : "failed");
    }
  }

  return { draft, setDraft, problem, saving: edit.isPending, start, cancel, save };
}
