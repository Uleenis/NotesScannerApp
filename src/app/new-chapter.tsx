import { Stack, router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";

import { HeaderTextButton } from "@/components/header-text-button";
import { NameForm } from "@/components/name-form";
import { useStrings } from "@/i18n";
import { newNotebookOptions } from "@/navigation-options";
import { useCreateChapter } from "@/notebooks/queries";

type Problem = { kind: "duplicate"; name: string } | { kind: "failed" };

export default function NewChapterScreen() {
  const { notebook } = useLocalSearchParams<{ notebook: string }>();
  const t = useStrings();
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const create = useCreateChapter();
  const sending = useRef(false);

  async function submit() {
    if (sending.current || name.trim() === "") {
      return;
    }
    sending.current = true;
    try {
      const result = await create.mutateAsync({ notebookId: notebook, name });
      if (result.status === "created") {
        router.dismiss();
        router.push(`/chapter/${result.chapter.id}`);
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

  const message =
    problem === null ? t.newChapter.hint : problem.kind === "duplicate" ? t.newChapter.duplicate(problem.name) : t.newChapter.failed;

  return (
    <>
      <Stack.Screen
        options={{
          ...newNotebookOptions,
          title: t.newChapter.title,
          headerLeft: () => <HeaderTextButton label={t.common.cancel} onPress={() => router.back()} />,
          headerRight: () => <HeaderTextButton label={t.newChapter.create} onPress={submit} />,
        }}
      />
      <NameForm
        label={t.newChapter.nameLabel}
        value={name}
        message={message}
        problem={problem !== null}
        onChange={change}
        onSubmit={submit}
      />
    </>
  );
}
