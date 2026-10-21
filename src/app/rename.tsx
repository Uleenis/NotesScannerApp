import { Stack, router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";

import { HeaderTextButton } from "@/components/header-text-button";
import { NameForm } from "@/components/name-form";
import { useStrings } from "@/i18n";
import { newNotebookOptions } from "@/navigation-options";
import { useChapters, useNotebook, useRenameChapter, useRenameNotebook } from "@/notebooks/queries";

type Kind = "notebook" | "chapter";

type Problem = { kind: "duplicate"; name: string } | { kind: "failed" };

function RenameForm({ kind, id, current }: { kind: Kind; id: string; current: string }) {
  const t = useStrings();
  const [name, setName] = useState(current);
  const [problem, setProblem] = useState<Problem | null>(null);
  const renameNotebook = useRenameNotebook();
  const renameChapter = useRenameChapter();
  const sending = useRef(false);

  async function submit() {
    if (sending.current || name.trim() === "") {
      return;
    }
    if (name.trim() === current) {
      router.back();
      return;
    }
    sending.current = true;
    try {
      const result = await (kind === "notebook" ? renameNotebook.mutateAsync({ id, name }) : renameChapter.mutateAsync({ id, name }));
      if (result.status === "renamed") {
        router.back();
      } else if (result.status === "duplicate") {
        setProblem({ kind: "duplicate", name: result.name });
      } else if (result.status === "failed") {
        setProblem({ kind: "failed" });
      }
    } catch {
      setProblem({ kind: "failed" });
    } finally {
      sending.current = false;
    }
  }

  function change(text: string) {
    setName(text);
    setProblem(null);
  }

  const duplicate = kind === "notebook" ? t.newNotebook.duplicate : t.newChapter.duplicate;
  const title = kind === "notebook" ? t.rename.notebookTitle : t.rename.chapterTitle;
  const label = kind === "notebook" ? t.rename.notebookLabel : t.rename.chapterLabel;
  const hint = kind === "notebook" ? t.newNotebook.hint : t.newChapter.hint;
  const message = problem === null ? hint : problem.kind === "duplicate" ? duplicate(problem.name) : t.rename.failed;

  return (
    <>
      <Stack.Screen
        options={{
          ...newNotebookOptions,
          title,
          headerLeft: () => <HeaderTextButton label={t.common.cancel} onPress={() => router.back()} />,
          headerRight: () => <HeaderTextButton label={t.rename.save} onPress={submit} />,
        }}
      />
      <NameForm label={label} value={name} message={message} problem={problem !== null} onChange={change} onSubmit={submit} />
    </>
  );
}

export default function RenameScreen() {
  const { kind, id } = useLocalSearchParams<{ kind: string; id: string }>();
  const notebook = useNotebook(kind === "notebook" ? id : null);
  const chapters = useChapters();

  if (kind !== "notebook" && kind !== "chapter") {
    return null;
  }
  const current = kind === "notebook" ? notebook.data?.name : chapters.data?.find((chapter) => chapter.id === id)?.name;
  if (current === undefined) {
    return null;
  }
  return <RenameForm key={id} kind={kind} id={id} current={current} />;
}
