import { findColorLiterals, findHardcodedText } from "./source-literals";

const flagged = (source: string) => findHardcodedText("screen.tsx", source).map((finding) => finding.text);

describe("findHardcodedText", () => {
  test.each([
    ["JSX text", "<Text>Bonjour</Text>", ["Bonjour"]],
    ["a string child", "<Text>{'Bonjour'}</Text>", ["'Bonjour'"]],
    ["both branches of a conditional child", "<Text>{ok ? 'Oui' : 'Non'}</Text>", ["'Oui'", "'Non'"]],
    ["a logical child", "<Text>{ok && 'Oui'}</Text>", ["'Oui'"]],
    ["a template child", "<Text>{`Page ${n}`}</Text>", ["`Page ${n}`"]],
    ["a displayed prop", '<TextInput placeholder="Nom" />', ['"Nom"']],
    ["a displayed prop in braces", "<Pressable accessibilityLabel={'Compte'} />", ["'Compte'"]],
    ["displayed screen options", "<Stack.Screen options={{ title: 'Carnet', headerBackTitle: 'Retour' }} />", ["'Carnet'", "'Retour'"]],
    ["alert texts", "Alert.alert('Supprimer', 'Sûr ?');", ["'Supprimer'", "'Sûr ?'"]],
  ])("flags %s", (_, source, expected) => {
    expect(flagged(source)).toEqual(expected);
  });

  test.each([
    ["imports", "import { Text } from 'react-native';"],
    ["route names", '<Stack.Screen name="index" />'],
    ["links", '<Link href="/capture" />'],
    ["inline styles", "<View style={{ alignItems: 'center' }} />"],
    ["style sheets", "const styles = StyleSheet.create({ row: { flexDirection: 'row' } });"],
    ["empty titles", "<Stack.Screen options={{ title: '' }} />"],
    ["translated text", "<Text>{t.library.title}</Text>"],
    ["punctuation", "<Text>·</Text>"],
    ["values", "<Text>{count}</Text>"],
  ])("ignores %s", (_, source) => {
    expect(flagged(source)).toEqual([]);
  });

  test("gives the line of each finding", () => {
    expect(findHardcodedText("screen.tsx", "const a = 1;\n\n<Text>Bonjour</Text>")).toEqual([
      { line: 3, text: "Bonjour" },
    ]);
  });
});

describe("findColorLiterals", () => {
  test.each(["'#FAF6EC'", "'#fff'", "'rgba(0, 0, 0, 0.5)'", "'hsl(10, 20%, 30%)'"])("flags %s", (literal) => {
    expect(findColorLiterals("screen.tsx", `const c = ${literal};`).map((finding) => finding.text)).toEqual([literal]);
  });

  test.each(["'paper'", "'#tag'", "'center'"])("ignores %s", (literal) => {
    expect(findColorLiterals("screen.tsx", `const c = ${literal};`)).toEqual([]);
  });
});
