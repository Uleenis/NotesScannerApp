import * as ts from "typescript";

export type Finding = { line: number; text: string };

const DISPLAYED_KEYS = new Set([
  "title",
  "headerTitle",
  "headerBackTitle",
  "label",
  "tabBarLabel",
  "placeholder",
  "accessibilityLabel",
  "accessibilityHint",
  "aria-label",
  "text",
  "message",
  "description",
  "subtitle",
  "alt",
]);

const COLOR_PATTERN = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i;
const TEMPLATE_COLOR = /^(#|rgba?\(|hsla?\()/i;
const COLOR_KEY =/colou?r$/i;
const LETTER = /\p{L}/u;
const ENTITY = /&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi;

type StringNode = ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression;

function parse(fileName: string, source: string): ts.SourceFile {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function lineOf(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function isStringNode(node: ts.Node): node is StringNode {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node);
}

function literalText(node: StringNode): string {
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => span.literal.text).join("");
  }
  return node.text;
}

function nameText(name: ts.Node): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

function isDisplayedKey(name: ts.Node): boolean {
  const text = nameText(name);
  return text !== undefined && DISPLAYED_KEYS.has(text);
}

function isColorKey(name: ts.Node): boolean {
  const text = nameText(name);
  return text !== undefined && COLOR_KEY.test(text);
}

function isAlertCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "Alert" &&
    (callee.name.text === "alert" || callee.name.text === "prompt")
  );
}

const VALUE_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

function isStringJoin(parent: ts.BinaryExpression): boolean {
  return parent.operatorToken.kind === ts.SyntaxKind.PlusToken;
}

function isValuePassThrough(node: ts.Node, parent: ts.Node): boolean | undefined {
  if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent)) {
    return true;
  }
  if (ts.isConditionalExpression(parent)) {
    return node !== parent.condition;
  }
  if (ts.isBinaryExpression(parent)) {
    return VALUE_OPERATORS.has(parent.operatorToken.kind) || isStringJoin(parent);
  }
  return undefined;
}

function isTextChain(node: ts.Node, parent: ts.Node): boolean {
  if (ts.isArrayLiteralExpression(parent)) {
    return true;
  }
  if (ts.isPropertyAccessExpression(parent)) {
    return node === parent.expression;
  }
  return ts.isCallExpression(parent) && node === parent.expression && ts.isPropertyAccessExpression(node);
}

function isDisplayed(start: ts.Node): boolean {
  let node = start;
  for (let parent = node.parent; parent; node = parent, parent = parent.parent) {
    const passThrough = isValuePassThrough(node, parent);
    if (passThrough === true || (passThrough === undefined && isTextChain(node, parent))) {
      continue;
    }
    if (passThrough === false) {
      return false;
    }
    if (ts.isJsxExpression(parent)) {
      const owner = parent.parent;
      if (ts.isJsxElement(owner) || ts.isJsxFragment(owner)) {
        return true;
      }
      return ts.isJsxAttribute(owner) && isDisplayedKey(owner.name);
    }
    if (ts.isJsxAttribute(parent)) {
      return isDisplayedKey(parent.name);
    }
    if (ts.isPropertyAssignment(parent)) {
      return node === parent.initializer && isDisplayedKey(parent.name);
    }
    if (ts.isCallExpression(parent)) {
      return node !== parent.expression && isAlertCall(parent);
    }
    return false;
  }
  return false;
}

function isColorValue(start: ts.Node): boolean {
  let node = start;
  for (let parent = node.parent; parent; node = parent, parent = parent.parent) {
    const passThrough = isValuePassThrough(node, parent);
    if (passThrough === true) {
      continue;
    }
    if (passThrough === false) {
      return false;
    }
    if (ts.isJsxExpression(parent)) {
      return ts.isJsxAttribute(parent.parent) && isColorKey(parent.parent.name);
    }
    if (ts.isJsxAttribute(parent)) {
      return isColorKey(parent.name);
    }
    if (ts.isPropertyAssignment(parent)) {
      return node === parent.initializer && isColorKey(parent.name);
    }
    return false;
  }
  return false;
}

export function findHardcodedText(fileName: string, source: string): Finding[] {
  const sourceFile = parse(fileName, source);
  const findings: Finding[] = [];
  visit(sourceFile, (node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText(sourceFile);
      if (LETTER.test(text.replace(ENTITY, ""))) {
        const offset = text.length - text.trimStart().length;
        findings.push({ line: lineOf(sourceFile, node.getStart(sourceFile) + offset), text: text.trim() });
      }
      return;
    }
    if (isStringNode(node) && LETTER.test(literalText(node)) && isDisplayed(node)) {
      findings.push({ line: lineOf(sourceFile, node.getStart(sourceFile)), text: node.getText(sourceFile).trim() });
    }
  });
  return findings;
}

export function findColorLiterals(fileName: string, source: string): Finding[] {
  const sourceFile = parse(fileName, source);
  const findings: Finding[] = [];
  visit(sourceFile, (node) => {
    if (!isStringNode(node)) {
      return;
    }
    const text = literalText(node);
    const startsAsColor = ts.isTemplateExpression(node) ? TEMPLATE_COLOR.test(node.head.text) : COLOR_PATTERN.test(text);
    const namedColor = text !== "" && !ts.isTemplateExpression(node) && isColorValue(node);
    if (startsAsColor || namedColor) {
      findings.push({ line: lineOf(sourceFile, node.getStart(sourceFile)), text: node.getText(sourceFile).trim() });
    }
  });
  return findings;
}
