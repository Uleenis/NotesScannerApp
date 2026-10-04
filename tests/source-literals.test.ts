import { findColorLiterals, findHardcodedText } from "./source-literals";

const flagged = (source: string) => findHardcodedText("screen.tsx", source).map((finding) => finding.text);

describe("findHardcodedText", () => {
  test.each([
    ["JSX text", "<Text>Bonjour</Text>", ["Bonjour"]],
    ["a string child", "<Text>{'Bonjour'}</Text>", ["'Bonjour'"]],
    ["both branches of a conditional child", "<Text>{ok ? 'Oui' : 'Non'}</Text>", ["'Oui'", "'Non'"]],
    ["text around an entity", "<Text>Tom&nbsp;&amp;&nbsp;Jerry</Text>", ["Tom&nbsp;&amp;&nbsp;Jerry"]],
    ["a logical child","<Text>{ok && 'Oui'}</Text>", ["'Oui'"]],
    ["a template child", "<Text>{`Page ${n}`}</Text>", ["`Page ${n}`"]],
    ["a displayed prop", '<TextInput placeholder="Nom" />', ['"Nom"']],
    ["a displayed prop in braces", "<Pressable accessibilityLabel={'Compte'} />", ["'Compte'"]],
    ["displayed screen options", "<Stack.Screen options={{ title: 'Carnet', headerBackTitle: 'Retour' }} />", ["'Carnet'", "'Retour'"]],
    ["alert texts", "Alert.alert('Supprimer', 'Sûr ?');", ["'Supprimer'", "'Sûr ?'"]],
    ["a concatenated child", "<Text>{'Page ' + n}</Text>", ["'Page '"]],
    ["a concatenation ending in text", "<Text>{n + ' pages'}</Text>", ["' pages'"]],
    ["a child with a method call", "<Text>{'Page'.toUpperCase()}</Text>", ["'Page'"]],
    ["a joined array child", "<Text>{['Oui', 'Non'].join(', ')}</Text>", ["'Oui'", "'Non'"]],
    ["a text prop", "<Foo text='Bonjour' />", ["'Bonjour'"]],
    ["a message option", "Share.share({ message: 'Bonjour' });", ["'Bonjour'"]],
    ["a description prop", "<Foo description={'Bonjour'} />", ["'Bonjour'"]],
    ["a subtitle option", "<Stack.Screen options={{ subtitle: 'Bonjour' }} />", ["'Bonjour'"]],
    ["an alternative text", "<Image alt='Photo' />", ["'Photo'"]],
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
    ["spacing entities", "<Text>&nbsp;&#8226;&nbsp;</Text>"],
    ["values", "<Text>{count}</Text>"],
    ["a comparison", "<Text>{n === 'a' ? t.a : t.b}</Text>"],
    ["a string used as a method argument", "<Text>{t.list.join(', ')}</Text>"],
    ["a string tested in a condition", "<Text>{names.includes('Bob') ? t.a : t.b}</Text>"],
    ["a text key holding a translation", "<Foo text={t.library.title} />"],
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

  test.each([
    ["a named color in a style", "const s = { color: 'white' };", ["'white'"]],
    ["transparent", "const s = { backgroundColor: 'transparent' };", ["'transparent'"]],
    ["a quoted key", "const s = { 'borderColor': 'red' };", ["'red'"]],
    ["a color prop", "<Icon color='red' />", ["'red'"]],
    ["a color prop in braces", "<Icon tintColor={'red'} />", ["'red'"]],
    ["a conditional color", "<Icon color={ok ? 'red' : colors.ink} />", ["'red'"]],
    ["a logical color", "const s = { color: dark || 'black' };", ["'black'"]],
    ["a hex template", "const c = `#${value}`;", ["`#${value}`"]],
  ])("flags %s", (_, source, expected) => {
    expect(findColorLiterals("screen.tsx", source).map((finding) => finding.text)).toEqual(expected);
  });

  test.each([
    ["a theme color", "const s = { color: colors.ink };"],
    ["an empty color", "const s = { color: '' };"],
    ["a color scheme", "const s = { colorScheme: 'light' };"],
    ["a theme color in a prop", "<Icon color={colors.ink} />"],
    ["a name that only contains color", "const s = { colorful: 'yes' };"],
  ])("ignores %s", (_, source) => {
    expect(findColorLiterals("screen.tsx", source)).toEqual([]);
  });
});
