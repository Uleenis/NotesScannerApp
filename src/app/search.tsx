import { Ionicons } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { BackLink } from "@/components/back-link";
import { LargeTitle } from "@/components/large-title";
import { useStrings } from "@/i18n";
import { useNotebooks } from "@/notebooks/queries";
import { usePages } from "@/pages/queries";
import { useSearch } from "@/search/queries";
import type { SearchHit } from "@/search/search";
import { excerptParts, replaceWords } from "@/search/text";
import { SEARCH_DELAY_MS } from "@/search/timing";
import { colors, radius, typography } from "@/theme";

const MAX_QUERY_LENGTH = 100;

type ResultRowProps = { hit: SearchHit; meta: string | null; alsoReadLine: string | null; onPress: () => void };

function ResultRow({ hit, meta, alsoReadLine, onPress }: ResultRowProps) {
  const parts = excerptParts(hit.excerpt, hit.matchStart, hit.matchEnd);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      <Text numberOfLines={3} style={styles.excerpt}>
        {parts.before}
        {parts.match === "" ? null : <Text style={styles.match}>{parts.match}</Text>}
        {parts.after}
      </Text>
      {alsoReadLine === null ? null : <Text style={styles.meta}>{alsoReadLine}</Text>}
      {meta === null ? null : <Text style={styles.meta}>{meta}</Text>}
    </Pressable>
  );
}

export default function SearchScreen() {
  const t = useStrings();
  const params = useLocalSearchParams<{ notebook?: string }>();
  const notebooks = useNotebooks();
  const pages = usePages();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);

  const known = notebooks.data ?? [];
  const requested = typeof params.notebook === "string" && known.some((notebook) => notebook.id === params.notebook) ? params.notebook : null;
  const notebookId = chosen === undefined ? requested : chosen;
  const search = useSearch(query, notebookId);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  function submit() {
    setQuery(text);
  }

  function searchInstead(replacement: string) {
    setText(replacement);
    setQuery(replacement);
  }

  const notebookNames = new Map(known.map((notebook) => [notebook.id, notebook.name]));
  const numbered = new Map((pages.data ?? []).map((page) => [page.id, page.number]));

  function metaOf(hit: SearchHit): string | null {
    const name = notebookNames.get(hit.notebookId);
    const number = numbered.get(hit.pageId);
    if (name === undefined) {
      return number === undefined ? null : t.document.pageNumber(number);
    }
    return number === undefined ? name : t.library.cardMeta(name, t.document.pageNumber(number));
  }

  function open(hit: SearchHit) {
    router.push({
      pathname: "/page/[id]",
      params: hit.tokenIndex === null ? { id: hit.pageId } : { id: hit.pageId, found: String(hit.tokenIndex) },
    });
  }

  const outcome = search.data;
  const waiting = query.trim() !== "" && outcome === undefined && !search.isError;
  const inText = outcome?.status === "found" ? outcome.hits.filter((hit) => hit.rank === 1) : [];
  const alsoRead = outcome?.status === "found" ? outcome.hits.filter((hit) => hit.rank === 2) : [];
  const replacement = outcome?.status === "found" ? replaceWords(query.trim(), outcome.suggestions) : null;
  const suggestion = replacement !== null && replacement !== query.trim() ? replacement : null;

  function body() {
    if (query.trim() === "") {
      return <Text style={styles.note}>{t.search.hint}</Text>;
    }
    if (search.isError || outcome?.status === "error") {
      return <Text style={styles.note}>{t.search.failed}</Text>;
    }
    if (waiting || outcome === undefined) {
      return <Text style={styles.note}>{t.search.searching}</Text>;
    }
    if (outcome.status === "tooLong") {
      return <Text style={styles.note}>{t.search.tooLong}</Text>;
    }
    if (outcome.status === "tooManyWords") {
      return <Text style={styles.note}>{t.search.tooManyWords}</Text>;
    }
    return (
      <>
        {suggestion === null ? null : (
          <Pressable accessibilityRole="button" onPress={() => searchInstead(suggestion)} style={styles.suggestion}>
            <Text style={styles.suggestionLabel}>{t.search.didYouMean(suggestion)}</Text>
          </Pressable>
        )}
        {outcome.hits.length === 0 ? <Text style={styles.note}>{t.search.none}</Text> : null}
        {inText.length === 0 ? null : (
          <>
            <Text style={styles.section}>{t.search.inText}</Text>
            {inText.map((hit) => (
              <ResultRow key={hit.pageId} hit={hit} meta={metaOf(hit)} alsoReadLine={null} onPress={() => open(hit)} />
            ))}
          </>
        )}
        {alsoRead.length === 0 ? null : (
          <>
            <Text style={styles.section}>{t.search.alsoRead}</Text>
            {alsoRead.map((hit) => (
              <ResultRow
                key={hit.pageId}
                hit={hit}
                meta={metaOf(hit)}
                alsoReadLine={hit.alsoRead === null ? null : t.search.alsoReadLine(hit.alsoRead)}
                onPress={() => open(hit)}
              />
            ))}
          </>
        )}
      </>
    );
  }

  const filters: { id: string | null; name: string }[] = [{ id: null, name: t.search.allNotebooks }, ...known.map((notebook) => ({ id: notebook.id, name: notebook.name }))];

  return (
    <>
      <Stack.Screen
        options={{
          title: "",
          headerBackVisible: false,
          headerLeft: () => <BackLink name={t.common.back} label={t.common.back} onPress={() => router.back()} />,
        }}
      />
      <LargeTitle text={t.search.title} />
      <View style={styles.field}>
        <Ionicons name="search" size={20} color={colors.inkSecondary} />
        <TextInput
          accessibilityLabel={t.search.fieldLabel}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          maxLength={MAX_QUERY_LENGTH}
          onChangeText={setText}
          onSubmitEditing={submit}
          placeholder={t.search.placeholder}
          placeholderTextColor={colors.inkTertiary}
          returnKeyType="search"
          style={styles.input}
          submitBehavior="blurAndSubmit"
          value={text}
        />
      </View>
      {known.length < 2 ? null : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipsScroll}>
          {filters.map((filter) => {
            const selected = filter.id === notebookId;
            return (
              <Pressable
                key={filter.id ?? "all"}
                accessibilityLabel={t.search.filterOption(filter.name)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setChosen(filter.id)}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                <Text numberOfLines={1} style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                  {filter.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      <ScrollView contentContainerStyle={styles.results} keyboardShouldPersistTaps="handled">
        {body()}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    alignItems: "center",
    backgroundColor: colors.sheet,
    borderColor: colors.rule,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 8,
    marginHorizontal: 20,
    marginTop: 12,
    paddingHorizontal: 12,
  },
  input: {
    ...typography.interfaceBody,
    color: colors.ink,
    flex: 1,
    paddingVertical: 12,
  },
  chipsScroll: {
    flexGrow: 0,
  },
  chips: {
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  chip: {
    borderColor: colors.rule,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 200,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipSelected: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  chipLabel: {
    ...typography.interfaceSecondary,
    color: colors.ink,
  },
  chipLabelSelected: {
    color: colors.paper,
  },
  results: {
    paddingBottom: 48,
    paddingHorizontal: 20,
  },
  note: {
    ...typography.interfaceBody,
    color: colors.inkSecondary,
    paddingTop: 16,
  },
  section: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
    paddingBottom: 4,
    paddingTop: 16,
  },
  row: {
    borderBottomColor: colors.rule,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
    paddingVertical: 14,
  },
  excerpt: {
    ...typography.documentBody,
    color: colors.ink,
  },
  match: {
    fontFamily: typography.pageTitle.fontFamily,
    fontWeight: "700",
  },
  meta: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
  },
  suggestion: {
    paddingTop: 16,
  },
  suggestionLabel: {
    ...typography.interfaceBody,
    color: colors.blue,
  },
});
