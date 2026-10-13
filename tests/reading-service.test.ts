import * as ts from "typescript";

function read(path: string): string {
  const text = ts.sys.readFile(`${ts.sys.getCurrentDirectory()}/${path}`);
  if (text === undefined) throw new Error(`${path} is missing`);
  return text.replace(/\r\n/g, "\n");
}

function publishedPorts(compose: string): string[] {
  const ports: string[] = [];
  let listIndent: number | null = null;
  for (const line of compose.split("\n")) {
    const indent = line.length - line.trimStart().length;
    const content = line.trim();
    if (content === "") continue;
    if (listIndent !== null && indent > listIndent && content.startsWith("-")) {
      ports.push(content.slice(1).trim().replace(/^["']|["']$/g, ""));
      continue;
    }
    listIndent = content === "ports:" ? indent : null;
  }
  return ports;
}

describe("the local reading service", () => {
  const compose = read("services/reading/compose.yaml");

  it("is published on the PC only, never on the local network", () => {
    const ports = publishedPorts(compose);
    expect(ports.length).toBeGreaterThan(0);
    for (const port of ports) expect(port).toMatch(/^127\.0\.0\.1:\d+:\d+$/);
  });

  it("does not share the network of the PC", () => {
    expect(compose).not.toMatch(/network_mode/);
  });

  it("reads its secret from the file git ignores, never from the compose file", () => {
    expect(compose).not.toMatch(/READING_SECRET\s*[:=]/);
  });
});

describe("publishedPorts", () => {
  it("finds every entry of a ports list, quoted or not", () => {
    const compose = "services:\n  a:\n    ports:\n      - \"54340:8080\"\n      - 127.0.0.1:1:2\n    networks:\n      - x\n";
    expect(publishedPorts(compose)).toEqual(["54340:8080", "127.0.0.1:1:2"]);
  });
});
