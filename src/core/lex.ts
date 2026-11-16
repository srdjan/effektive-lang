// Hand-written lexer. It scans a whole file into parallel typed arrays and keeps
// whitespace and comments as trivia, so the syntax tree can print the exact text.
// Newline tokens are significant. The parser decides where they separate items.

import { type Diagnostic, makeDiagnostic } from "./diagnostics.ts";
import { byteArrayFrom, indices, setFrom, uint32ArrayFrom } from "./runtime.ts";

const FOUR_STEPS: readonly number[] = [0, 1, 2, 3];

export const TokenKind = {
  Eof: 0,
  Newline: 1,
  Ident: 2,
  KwImport: 3,
  KwExport: 4,
  KwConst: 5,
  KwMatch: 6,
  KwTry: 7,
  KwCatch: 8,
  KwIf: 9,
  KwElse: 10,
  KwTrue: 11,
  KwFalse: 12,
  KwNull: 13,
  String: 14,
  Number: 15,
  LParen: 16,
  RParen: 17,
  LBrace: 18,
  RBrace: 19,
  LBracket: 20,
  RBracket: 21,
  Comma: 22,
  Colon: 23,
  Semicolon: 24,
  Dot: 25,
  DotDotDot: 26,
  Question: 27,
  Eq: 28,
  Arrow: 29,
  EqEqEq: 30,
  BangEqEq: 31,
  Lt: 32,
  LtEq: 33,
  Gt: 34,
  GtEq: 35,
  AmpAmp: 36,
  PipePipe: 37,
  Pipe: 38,
  PipeGt: 39,
  Plus: 40,
  Minus: 41,
  Star: 42,
  Slash: 43,
  Bang: 44,
  Unknown: 45,
  QuestionQuestion: 46,
  KwFinally: 47,
  KwWith: 48,
  Percent: 49,
} as const;

export type TokenKind = (typeof TokenKind)[keyof typeof TokenKind];

export const TriviaKind = {
  Whitespace: 0,
  LineComment: 1,
  BlockComment: 2,
} as const;

export type TriviaKind = (typeof TriviaKind)[keyof typeof TriviaKind];

type TriviaTable = {
  readonly kinds: Uint8Array;
  readonly starts: Uint32Array;
  readonly ends: Uint32Array;
};

export type Lexed = {
  readonly text: string;
  /** Number of tokens, including the final Eof token. */
  readonly count: number;
  readonly kinds: Uint8Array;
  readonly starts: Uint32Array;
  readonly ends: Uint32Array;
  readonly trivia: TriviaTable;
  /**
   * `triviaEnd[t]` is the number of trivia items emitted up to token `t`.
   * Token `t` owns trivia items from `triviaEnd[t - 1]` (or 0) up to `triviaEnd[t]`.
   * Trivia after the last real token belongs to the Eof token.
   */
  readonly triviaEnd: Uint32Array;
  readonly diagnostics: readonly Diagnostic[];
};

export type LexerText = string;
export type LexerStatus = boolean;
export type TokenDescription = string;
export type LexerNumber = number;

/** Narrows one compact token-array value to its stable token kind. */
/** The kind that has the number `value`. The numbers run from Eof to Percent without gaps. */
export function tokenKind(value: LexerNumber): TokenKind | undefined {
  return Number.isInteger(value) && value >= TokenKind.Eof &&
      value <= TokenKind.Percent
    ? value as TokenKind
    : undefined;
}

const KEYWORD_KINDS = {
  import: TokenKind.KwImport,
  export: TokenKind.KwExport,
  const: TokenKind.KwConst,
  match: TokenKind.KwMatch,
  try: TokenKind.KwTry,
  catch: TokenKind.KwCatch,
  if: TokenKind.KwIf,
  else: TokenKind.KwElse,
  true: TokenKind.KwTrue,
  false: TokenKind.KwFalse,
  null: TokenKind.KwNull,
  finally: TokenKind.KwFinally,
  with: TokenKind.KwWith,
} as const;

type KeywordWord = keyof typeof KEYWORD_KINDS;

function keywordKind(word: LexerText): TokenKind | undefined {
  return Object.hasOwn(KEYWORD_KINDS, word)
    ? KEYWORD_KINDS[word as KeywordWord]
    : undefined;
}

function keywordWords(): IterableIterator<LexerText> {
  return Object.keys(KEYWORD_KINDS).values();
}

type KeywordTable = {
  readonly get: (word: LexerText) => TokenKind | undefined;
  readonly keys: () => IterableIterator<LexerText>;
};

/** The fixed keyword lookup. */
export const KEYWORDS: KeywordTable = {
  get: keywordKind,
  keys: keywordWords,
};

export function isKeywordKind(kind: LexerNumber | undefined): LexerStatus {
  return kind !== undefined &&
    ((kind >= TokenKind.KwImport && kind <= TokenKind.KwNull) ||
      kind === TokenKind.KwFinally || kind === TokenKind.KwWith);
}

/** Whether the name `word` is the keyword `from`: only a string literal, the module path, follows it. */
export function isFromKeyword(
  word: LexerText,
  next: TokenKind | undefined,
): LexerStatus {
  return word === "from" && next === TokenKind.String;
}

/** The token kinds that the editors color as operators. The order of the enum does not matter. */
const OPERATOR_KIND_VALUES: readonly TokenKind[] = [
  TokenKind.Eq,
  TokenKind.QuestionQuestion,
  TokenKind.Arrow,
  TokenKind.EqEqEq,
  TokenKind.BangEqEq,
  TokenKind.Lt,
  TokenKind.LtEq,
  TokenKind.Gt,
  TokenKind.GtEq,
  TokenKind.AmpAmp,
  TokenKind.PipePipe,
  TokenKind.Pipe,
  TokenKind.PipeGt,
  TokenKind.Plus,
  TokenKind.Minus,
  TokenKind.Star,
  TokenKind.Slash,
  TokenKind.Percent,
  TokenKind.Bang,
];

function hasOperatorKind(kind: TokenKind): LexerStatus {
  return OPERATOR_KIND_VALUES.includes(kind);
}

type OperatorKinds = {
  readonly has: (kind: TokenKind) => LexerStatus;
};

/** Fixed token kinds that editors color as operators. */
export const OPERATOR_KINDS: OperatorKinds = { has: hasOperatorKind };

/**
 * How a contextual word is used. The lexer reads each of these words as a name.
 * The parser, the editor queries, and the playground highlighter decide by
 * position when the word acts as a keyword. Each of them reads the words of the
 * roles it needs from this table.
 *
 * - `declaration`: names the declaration form (`type`, `error`, `service`, `provider`).
 * - `modifier`: marks the declaration or the type that follows (`sealed`, `opaque`, `borrow`, `pure`).
 * - `clause`: starts a clause of a header (`fails`, `provides`).
 * - `positional`: a keyword only in one syntactic position (`where`, `using`).
 * - `import`: belongs to an import header (`from`, `imports`).
 */
const CONTEXTUAL_ROLES = {
  type: "declaration",
  error: "declaration",
  service: "declaration",
  provider: "declaration",
  sealed: "modifier",
  opaque: "modifier",
  borrow: "modifier",
  pure: "modifier",
  fails: "clause",
  provides: "clause",
  where: "positional",
  using: "positional",
  from: "import",
  imports: "import",
} as const;

export type ContextualWord = keyof typeof CONTEXTUAL_ROLES;

type ContextualRole = (typeof CONTEXTUAL_ROLES)[ContextualWord];

/** The contextual words that have one of `roles`, in table order. */
export function contextualWordsOf(
  roles: readonly ContextualRole[],
): ReadonlySet<LexerText> {
  const words: LexerText[] = [];
  for (const word of Object.keys(CONTEXTUAL_ROLES)) {
    if (roles.includes(CONTEXTUAL_ROLES[word as ContextualWord])) {
      words[words.length] = word;
    }
  }
  return setFrom(words);
}

/** The words that can start a declaration when a name follows. */
const DECLARATION_START_WORDS: readonly LexerText[] = [
  "type",
  "error",
  "service",
  "provider",
  "sealed",
  "opaque",
];

/** True when token `index` is an identifier that spells a declaration start word. */
export function isDeclarationStartWord(
  lexed: Lexed,
  index: LexerNumber,
): LexerStatus {
  if (lexed.kinds[index] !== TokenKind.Ident) return false;
  const length = lexed.ends[index] - lexed.starts[index];
  if (length < 4 || length > 8) {
    return false;
  }
  return DECLARATION_START_WORDS.includes(
    lexed.text.slice(lexed.starts[index], lexed.ends[index]),
  );
}

/**
 * Words that a strict ES module reserves. An identifier with one of these
 * spellings is a `syntax` diagnostic, so the emitter never renames a source
 * identifier. `void` is also on the list but stays valid as a type name, and
 * `while` stays valid as a record label (the `retry` option): the lexer skips
 * both and the parser checks them in the other positions.
 */
export type ParserCheckedWord = "void" | "while";

export const PARSER_CHECKED_WORDS: readonly ParserCheckedWord[] = [
  "void",
  "while",
];

const RESERVED_WORDS: readonly LexerText[] = [
  "break",
  "case",
  "class",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "enum",
  "extends",
  "for",
  "function",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "typeof",
  "var",
  "void",
  "while",
  "implements",
  "interface",
  "let",
  "package",
  "private",
  "protected",
  "public",
  "static",
  "yield",
  "await",
  "arguments",
  "eval",
];

const TOKEN_NAMES: readonly TokenDescription[] = [
  "end of file",
  "end of line",
  "name",
  "`import`",
  "`export`",
  "`const`",
  "`match`",
  "`try`",
  "`catch`",
  "`if`",
  "`else`",
  "`true`",
  "`false`",
  "`null`",
  "string",
  "number",
  "`(`",
  "`)`",
  "`{`",
  "`}`",
  "`[`",
  "`]`",
  "`,`",
  "`:`",
  "`;`",
  "`.`",
  "`...`",
  "`?`",
  "`=`",
  "`=>`",
  "`===`",
  "`!==`",
  "`<`",
  "`<=`",
  "`>`",
  "`>=`",
  "`&&`",
  "`||`",
  "`|`",
  "`|>`",
  "`+`",
  "`-`",
  "`*`",
  "`/`",
  "`!`",
  "unknown character",
  "`??`",
  "`finally`",
  "`with`",
  "`%`",
];

/** A short name for messages. */
export function describeTokenKind(kind: TokenKind): TokenDescription {
  return TOKEN_NAMES[kind];
}

export function isWord(
  lexed: Lexed,
  index: LexerNumber,
  word: LexerText,
): LexerStatus {
  return lexed.kinds[index] === TokenKind.Ident &&
    lexed.ends[index] - lexed.starts[index] === word.length &&
    lexed.text.startsWith(word, lexed.starts[index]);
}

function isIdentStart(c: LexerNumber): LexerStatus {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f ||
    c === 0x24;
}

function isDigit(c: LexerNumber): LexerStatus {
  return c >= 0x30 && c <= 0x39;
}

export function isIdentPart(c: LexerNumber): LexerStatus {
  return isIdentStart(c) || isDigit(c);
}

/** True when `text` has the shape of one identifier. */
export function isIdentifier(text: LexerText): LexerStatus {
  if (text.length === 0 || !isIdentStart(text.charCodeAt(0))) return false;
  let first = true;
  for (const character of text) {
    if (first) {
      first = false;
      continue;
    }
    if (character.length !== 1 || !isIdentPart(character.charCodeAt(0))) {
      return false;
    }
  }
  return true;
}

function isHexDigit(c: LexerNumber): LexerStatus {
  return isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}

function describeChar(
  text: LexerText,
  index: LexerNumber,
): TokenDescription {
  const cp = text.codePointAt(index) ?? 0;
  if (cp < 0x20 || cp === 0x7f || (cp >= 0xd800 && cp <= 0xdfff)) {
    return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return `'${String.fromCodePoint(cp)}'`;
}

function addDiagnostic(
  diagnostics: Diagnostic[],
  source: LexerText,
  code: Parameters<typeof makeDiagnostic>[0],
  message: TokenDescription,
  start: LexerNumber,
  end: LexerNumber,
): Diagnostic[] {
  diagnostics[diagnostics.length] = makeDiagnostic(code, message, {
    source: source,
    start: start,
    end: end,
  });
  return diagnostics;
}

function singleToken(code: LexerNumber): TokenKind | undefined {
  if (code === 0x28) return TokenKind.LParen;
  if (code === 0x29) return TokenKind.RParen;
  if (code === 0x7b) return TokenKind.LBrace;
  if (code === 0x7d) return TokenKind.RBrace;
  if (code === 0x5b) return TokenKind.LBracket;
  if (code === 0x5d) return TokenKind.RBracket;
  if (code === 0x2c) return TokenKind.Comma;
  if (code === 0x3a) return TokenKind.Colon;
  if (code === 0x3b) return TokenKind.Semicolon;
  if (code === 0x2b) return TokenKind.Plus;
  if (code === 0x2d) return TokenKind.Minus;
  if (code === 0x2a) return TokenKind.Star;
  if (code === 0x25) return TokenKind.Percent;
  return undefined;
}

function durationUnitLength(text: LexerText, index: LexerNumber): LexerNumber {
  const first = text.charCodeAt(index);
  const second = text.charCodeAt(index + 1);
  let length = 0;
  if (first === 0x6d && second === 0x73) {
    length = 2;
  } else if (first === 0x73 || first === 0x6d || first === 0x68) {
    length = 1;
  }
  const after = index + length;
  return length > 0 &&
      (after >= text.length || !isIdentPart(text.charCodeAt(after)))
    ? length
    : 0;
}

/** True when the text of a Number token has a duration suffix, such as `5s`. */
export function isDurationText(text: LexerText): LexerStatus {
  if (text.length < 2 || !isDigit(text.charCodeAt(0))) return false;
  let end = 0;
  for (const character of text) {
    if (character.length !== 1 || !isDigit(character.charCodeAt(0))) break;
    end = end + 1;
  }
  const unitLength = durationUnitLength(text, end);
  return end > 0 && unitLength > 0 && end + unitLength === text.length;
}

/** The value of a Number token's text. A duration literal such as `5s` becomes milliseconds. */
export function numberValue(text: LexerText): LexerNumber {
  if (!isDurationText(text)) return Number(text);
  if (text.endsWith("ms")) return Number(text.slice(0, -2));
  if (text.endsWith("s")) return Number(text.slice(0, -1)) * 1000;
  if (text.endsWith("m")) return Number(text.slice(0, -1)) * 60000;
  return Number(text.slice(0, -1)) * 3600000;
}

/** Scans a number that starts at `start`. */
function scanNumber(
  source: LexerText,
  text: LexerText,
  diagnosticsInput: Diagnostic[],
  start: LexerNumber,
): { readonly diagnostics: Diagnostic[]; readonly end: LexerNumber } {
  const count = text.length;
  let end = scanDigitEnd(text, start + 1);
  const integerEnd = end;
  let malformed: LexerText | undefined;
  if (text.charCodeAt(start) === 0x30 && integerEnd - start > 1) {
    malformed = "a number cannot have a leading zero";
  }
  if (
    end + 1 < count && text.charCodeAt(end) === 0x2e &&
    isDigit(text.charCodeAt(end + 1))
  ) {
    end = scanDigitEnd(text, end + 1);
  }
  const exponent = end < count ? text.charCodeAt(end) : 0;
  if (exponent === 0x65 || exponent === 0x45) {
    let exponentEnd = end + 1;
    const sign = text.charCodeAt(exponentEnd);
    if (exponentEnd < count && (sign === 0x2b || sign === 0x2d)) {
      exponentEnd = exponentEnd + 1;
    }
    if (exponentEnd < count && isDigit(text.charCodeAt(exponentEnd))) {
      exponentEnd = scanDigitEnd(text, exponentEnd);
      end = exponentEnd;
    } else {
      malformed = malformed ?? "the exponent has no digits";
      end = exponentEnd;
    }
  }
  let duration = false;
  if (end === integerEnd) {
    const unitLength = durationUnitLength(text, end);
    if (unitLength > 0) {
      end = end + unitLength;
      duration = true;
    }
  }
  if (end < count && isIdentPart(text.charCodeAt(end))) {
    malformed = malformed ?? "a number cannot be followed by letters";
    end = scanIdentEnd(text, end);
  }
  const value = numberValue(text.slice(start, end));
  if (malformed !== undefined) {
    return {
      diagnostics: addDiagnostic(
        diagnosticsInput,
        source,
        "syntax/006",
        `malformed number: ${malformed}`,
        start,
        end,
      ),
      end: end,
    };
  }
  if (!Number.isFinite(value)) {
    return {
      diagnostics: addDiagnostic(
        diagnosticsInput,
        source,
        "syntax/005",
        "number literal is not a finite value",
        start,
        end,
      ),
      end: end,
    };
  }
  if (duration && value > Number.MAX_SAFE_INTEGER) {
    return {
      diagnostics: addDiagnostic(
        diagnosticsInput,
        source,
        "syntax/005",
        "duration literal exceeds the largest safe integer in milliseconds",
        start,
        end,
      ),
      end: end,
    };
  }
  return { diagnostics: diagnosticsInput, end: end };
}

function scanDigitEnd(text: LexerText, start: LexerNumber): LexerNumber {
  let end = start;
  for (const offset of indices(text.length - start)) {
    const index = start + offset;
    if (!isDigit(text.charCodeAt(index))) break;
    end = index + 1;
  }
  return end;
}

function scanIdentEnd(text: LexerText, start: LexerNumber): LexerNumber {
  let end = start;
  for (const offset of indices(text.length - start)) {
    const index = start + offset;
    if (!isIdentPart(text.charCodeAt(index))) break;
    end = index + 1;
  }
  return end;
}

function lineCommentEnd(text: LexerText, start: LexerNumber): LexerNumber {
  const lineFeed = text.indexOf("\n", start);
  const carriageReturn = text.indexOf("\r", start);
  if (lineFeed < 0) return carriageReturn < 0 ? text.length : carriageReturn;
  if (carriageReturn < 0) return lineFeed;
  return Math.min(lineFeed, carriageReturn);
}

/** Scans the escape at `start` inside a string. */
function scanEscape(
  source: LexerText,
  text: LexerText,
  diagnosticsInput: Diagnostic[],
  start: LexerNumber,
): { readonly diagnostics: Diagnostic[]; readonly end: LexerNumber } {
  const count = text.length;
  const escape = start + 1 < count ? text.charCodeAt(start + 1) : -1;
  if (
    escape === 0x22 || escape === 0x5c || escape === 0x2f ||
    escape === 0x62 || escape === 0x66 || escape === 0x6e ||
    escape === 0x72 || escape === 0x74
  ) {
    return { diagnostics: diagnosticsInput, end: start + 2 };
  }
  if (escape === 0x75) {
    let end = start + 2;
    let digits = 0;
    for (const offset of FOUR_STEPS) {
      const index = start + 2 + offset;
      if (index >= count || !isHexDigit(text.charCodeAt(index))) break;
      end = index + 1;
      digits = digits + 1;
    }
    if (digits < 4) {
      return {
        diagnostics: addDiagnostic(
          diagnosticsInput,
          source,
          "syntax/003",
          "invalid escape sequence: \\u needs four hex digits",
          start,
          end,
        ),
        end: end,
      };
    }
    return { diagnostics: diagnosticsInput, end: end };
  }
  if (escape === -1 || escape === 0x0a || escape === 0x0d) {
    return {
      diagnostics: addDiagnostic(
        diagnosticsInput,
        source,
        "syntax/003",
        "invalid escape sequence: backslash at end of line",
        start,
        start + 1,
      ),
      end: start + 1,
    };
  }
  const width = (text.codePointAt(start + 1) ?? 0) > 0xffff ? 2 : 1;
  return {
    diagnostics: addDiagnostic(
      diagnosticsInput,
      source,
      "syntax/003",
      `invalid escape sequence: \\${text.slice(start + 1, start + 1 + width)}`,
      start,
      start + 1 + width,
    ),
    end: start + 1 + width,
  };
}

/** Scans a string that starts at `start`. */
function scanString(
  source: LexerText,
  text: LexerText,
  diagnosticsInput: Diagnostic[],
  start: LexerNumber,
): { readonly diagnostics: Diagnostic[]; readonly end: LexerNumber } {
  let diagnostics = diagnosticsInput;
  let end = start + 1;
  for (const offset of indices(text.length - end)) {
    const index = start + 1 + offset;
    if (index < end) continue;
    if (end >= text.length) break;
    const code = text.charCodeAt(index);
    if (code === 0x22) {
      return { diagnostics: diagnostics, end: index + 1 };
    }
    if (code === 0x0a || code === 0x0d) break;
    if (code < 0x20 || code === 0x7f) {
      diagnostics = addDiagnostic(
        diagnostics,
        source,
        "syntax/003",
        `string literal contains the control character ${
          describeChar(text, index)
        }; use an escape sequence`,
        index,
        index + 1,
      );
      end = index + 1;
    } else if (code === 0x5c) {
      const escaped = scanEscape(source, text, diagnostics, index);
      diagnostics = escaped.diagnostics;
      end = escaped.end;
    } else {
      end = index + 1;
    }
  }
  diagnostics = addDiagnostic(
    diagnostics,
    source,
    "syntax/002",
    "string literal has no closing quote",
    start,
    end,
  );
  return { diagnostics: diagnostics, end: end };
}

function pairToken(
  text: LexerText,
  index: LexerNumber,
  second: LexerNumber,
  two: TokenKind,
  one: TokenKind,
): { readonly kind: TokenKind; readonly end: LexerNumber } {
  const hasPair = text.charCodeAt(index + 1) === second;
  const end = index + (hasPair ? 2 : 1);
  return { kind: hasPair ? two : one, end: end };
}

function isParserCheckedWord(word: LexerText): LexerStatus {
  return word === "void" || word === "while";
}

/** Scans the whole text. Never throws. */
export function lex(source: LexerText, text: LexerText): Lexed {
  const count = text.length;
  const kinds: number[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const triviaKinds: number[] = [];
  const triviaStarts: number[] = [];
  const triviaEnds: number[] = [];
  const triviaEnd: number[] = [];
  let diagnostics: Diagnostic[] = [];
  let tokenCount = 0;

  function appendToken(
    kind: TokenKind,
    start: LexerNumber,
    end: LexerNumber,
  ): LexerNumber {
    const outputIndex = kinds.length;
    kinds[outputIndex] = kind;
    starts[outputIndex] = start;
    ends[outputIndex] = end;
    triviaEnd[outputIndex] = triviaKinds.length;
    return outputIndex + 1;
  }

  function appendTrivia(
    kind: TriviaKind,
    start: LexerNumber,
    end: LexerNumber,
  ): LexerNumber {
    const outputIndex = triviaKinds.length;
    triviaKinds[outputIndex] = kind;
    triviaStarts[outputIndex] = start;
    triviaEnds[outputIndex] = end;
    return end;
  }

  let index = 0;
  if (count > 0 && text.charCodeAt(0) === 0xfeff) {
    index = appendTrivia(TriviaKind.Whitespace, 0, 1);
  }

  for (const scanCount of indices(count)) {
    if (scanCount > index || index >= count) break;
    const code = text.charCodeAt(index);
    const single = singleToken(code);
    if (single !== undefined) {
      tokenCount = appendToken(single, index, index + 1);
      index = index + 1;
      continue;
    }

    if (code === 0x20 || code === 0x09) {
      let end = index + 1;
      const contentStart = end;
      for (const offset of indices(count - contentStart)) {
        const nextIndex = contentStart + offset;
        const next = text.charCodeAt(nextIndex);
        if (next !== 0x20 && next !== 0x09) break;
        end = nextIndex + 1;
      }
      index = appendTrivia(TriviaKind.Whitespace, index, end);
      continue;
    }

    if (code === 0x0a) {
      tokenCount = appendToken(TokenKind.Newline, index, index + 1);
      index = index + 1;
      continue;
    }
    if (code === 0x0d) {
      const end = index + 1 < count && text.charCodeAt(index + 1) === 0x0a
        ? index + 2
        : index + 1;
      tokenCount = appendToken(TokenKind.Newline, index, end);
      index = end;
      continue;
    }

    if (isIdentStart(code)) {
      const end = scanIdentEnd(text, index + 1);
      const word = text.slice(index, end);
      const keyword = keywordKind(word);
      if (keyword !== undefined) {
        tokenCount = appendToken(keyword, index, end);
      } else {
        if (!isParserCheckedWord(word) && RESERVED_WORDS.includes(word)) {
          diagnostics = addDiagnostic(
            diagnostics,
            source,
            "syntax/007",
            `\`${word}\` is a reserved word and cannot be a name`,
            index,
            end,
          );
        }
        tokenCount = appendToken(TokenKind.Ident, index, end);
      }
      index = end;
      continue;
    }

    if (isDigit(code)) {
      const scanned = scanNumber(source, text, diagnostics, index);
      diagnostics = scanned.diagnostics;
      tokenCount = appendToken(TokenKind.Number, index, scanned.end);
      index = scanned.end;
      continue;
    }

    if (code === 0x22) {
      const scanned = scanString(source, text, diagnostics, index);
      diagnostics = scanned.diagnostics;
      tokenCount = appendToken(TokenKind.String, index, scanned.end);
      index = scanned.end;
      continue;
    }

    const next = index + 1 < count ? text.charCodeAt(index + 1) : -1;
    const afterNext = index + 2 < count ? text.charCodeAt(index + 2) : -1;

    if (code === 0x3f) {
      const scanned = pairToken(
        text,
        index,
        0x3f,
        TokenKind.QuestionQuestion,
        TokenKind.Question,
      );
      tokenCount = appendToken(scanned.kind, index, scanned.end);
      index = scanned.end;
      continue;
    }
    if (code === 0x2f) {
      if (next === 0x2f) {
        const end = lineCommentEnd(text, index + 2);
        index = appendTrivia(TriviaKind.LineComment, index, end);
      } else if (next === 0x2a) {
        const close = text.indexOf("*/", index + 2);
        if (close < 0) {
          diagnostics = addDiagnostic(
            diagnostics,
            source,
            "syntax/004",
            "block comment has no closing `*/`",
            index,
            text.length,
          );
        }
        const end = close < 0 ? text.length : close + 2;
        index = appendTrivia(TriviaKind.BlockComment, index, end);
      } else {
        tokenCount = appendToken(TokenKind.Slash, index, index + 1);
        index = index + 1;
      }
      continue;
    }
    if (code === 0x7c) {
      if (next === 0x7c) {
        tokenCount = appendToken(TokenKind.PipePipe, index, index + 2);
        index = index + 2;
      } else {
        const scanned = pairToken(
          text,
          index,
          0x3e,
          TokenKind.PipeGt,
          TokenKind.Pipe,
        );
        tokenCount = appendToken(scanned.kind, index, scanned.end);
        index = scanned.end;
      }
      continue;
    }
    if (code === 0x26) {
      if (next === 0x26) {
        tokenCount = appendToken(TokenKind.AmpAmp, index, index + 2);
        index = index + 2;
      } else {
        diagnostics = addDiagnostic(
          diagnostics,
          source,
          "syntax/001",
          "unexpected character '&'; the AND operator is `&&`",
          index,
          index + 1,
        );
        tokenCount = appendToken(TokenKind.Unknown, index, index + 1);
        index = index + 1;
      }
      continue;
    }
    if (code === 0x3d) {
      if (next === 0x3d && afterNext === 0x3d) {
        tokenCount = appendToken(TokenKind.EqEqEq, index, index + 3);
        index = index + 3;
      } else if (next === 0x3d) {
        diagnostics = addDiagnostic(
          diagnostics,
          source,
          "syntax/001",
          "unexpected `==`; the equality operator is `===`",
          index,
          index + 2,
        );
        tokenCount = appendToken(TokenKind.Unknown, index, index + 2);
        index = index + 2;
      } else {
        const scanned = pairToken(
          text,
          index,
          0x3e,
          TokenKind.Arrow,
          TokenKind.Eq,
        );
        tokenCount = appendToken(scanned.kind, index, scanned.end);
        index = scanned.end;
      }
      continue;
    }
    if (code === 0x21) {
      if (next === 0x3d && afterNext === 0x3d) {
        tokenCount = appendToken(TokenKind.BangEqEq, index, index + 3);
        index = index + 3;
      } else if (next === 0x3d) {
        diagnostics = addDiagnostic(
          diagnostics,
          source,
          "syntax/001",
          "unexpected `!=`; the inequality operator is `!==`",
          index,
          index + 2,
        );
        tokenCount = appendToken(TokenKind.Unknown, index, index + 2);
        index = index + 2;
      } else {
        tokenCount = appendToken(TokenKind.Bang, index, index + 1);
        index = index + 1;
      }
      continue;
    }
    if (code === 0x3c || code === 0x3e) {
      const scanned = code === 0x3c
        ? pairToken(text, index, 0x3d, TokenKind.LtEq, TokenKind.Lt)
        : pairToken(text, index, 0x3d, TokenKind.GtEq, TokenKind.Gt);
      tokenCount = appendToken(scanned.kind, index, scanned.end);
      index = scanned.end;
      continue;
    }
    if (code === 0x2e) {
      if (next === 0x2e && afterNext === 0x2e) {
        tokenCount = appendToken(TokenKind.DotDotDot, index, index + 3);
        index = index + 3;
      } else {
        tokenCount = appendToken(TokenKind.Dot, index, index + 1);
        index = index + 1;
      }
      continue;
    }

    const width = (text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
    diagnostics = addDiagnostic(
      diagnostics,
      source,
      "syntax/001",
      `unexpected character ${describeChar(text, index)}`,
      index,
      index + width,
    );
    tokenCount = appendToken(TokenKind.Unknown, index, index + width);
    index = index + width;
  }

  tokenCount = appendToken(TokenKind.Eof, count, count);
  return {
    text: text,
    count: tokenCount,
    kinds: byteArrayFrom(kinds),
    starts: uint32ArrayFrom(starts),
    ends: uint32ArrayFrom(ends),
    trivia: {
      kinds: byteArrayFrom(triviaKinds),
      starts: uint32ArrayFrom(triviaStarts),
      ends: uint32ArrayFrom(triviaEnds),
    },
    triviaEnd: uint32ArrayFrom(triviaEnd),
    diagnostics: diagnostics,
  };
}
