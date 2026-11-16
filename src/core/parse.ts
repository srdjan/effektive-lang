// Recursive-descent parser. It never throws and never stops at the first error.
// It builds a lossless tree: every token becomes a leaf, and a missing token or
// construct becomes a zero-width Missing node. See docs/archive/plans/2026-10-16-phase-a.md
// for the grammar addendum and the recovery design.
//
// Newline handling. The parser keeps a flag `sig`. In a module, a block, or a
// service body, a newline token separates items and the parser leaves it in
// place. Inside parentheses, brackets, record braces, match arms, and catch
// handlers the flag is off and `kind()` consumes newline tokens on its own.
// Before `fails`, `with`, `=>`, `|>`, `else`, and `catch` the parser looks past
// newlines (`la()`) and continues the item.
//
// Recovery. At a declaration keyword at the start of a line, a construct whose
// opening bracket has no match ends early (`kind()` reports a virtual Eof), so
// one broken declaration never swallows the next. Inside a list or block the
// parser skips junk up to a newline, a comma, or a closing bracket.

import {
  type Diagnostic,
  type DiagnosticCode,
  makeDiagnostic,
  normalizeDiagnostics,
} from "./diagnostics.ts";
import {
  type ContextualWord,
  describeTokenKind,
  isDeclarationStartWord,
  isDurationText,
  isKeywordKind,
  isWord,
  lex,
  type Lexed,
  PARSER_CHECKED_WORDS,
  type ParserCheckedWord,
  TokenKind,
  tokenKind,
} from "./lex.ts";
import { fileModeOf } from "./paths.ts";
import {
  byteArrayFrom,
  int32Array,
  int32ArrayFrom,
  uint32ArrayFrom,
} from "./runtime.ts";
import { panic } from "./source.ts";
import {
  type FileMode,
  type NodeId,
  SyntaxKind,
  type SyntaxTree,
  type TypeSlotKind,
  typeWord,
} from "./syntax.ts";

export type ParseResult = {
  readonly tree: SyntaxTree;
  /** Lexer and parser diagnostics, sorted and without duplicates. */
  readonly diagnostics: readonly Diagnostic[];
};

export type ParseSource = string;
export type ParseText = string;

export function parse(
  source: ParseSource,
  text: ParseText,
  mode: FileMode | undefined,
): ParseResult {
  const resolvedMode = mode ?? fileModeOf(source);
  const lexed = lex(source, text);
  const parser = createParser(source, text, resolvedMode, lexed);
  const tree = parser.run();
  const diagnostics = normalizeDiagnostics([
    ...lexed.diagnostics,
    ...parser.diagnostics(),
  ]);
  return { tree: tree, diagnostics: diagnostics };
}

type Group = { readonly sig: boolean; readonly unmatched: number };

/** Deepest nesting of expressions and types that the parser accepts. A parenthesis counts twice. */
const MAX_NESTING = 512;

type Parser = {
  readonly diagnostics: () => readonly Diagnostic[];
  readonly run: () => SyntaxTree;
};

function createParser(
  source: ParseSource,
  text: ParseText,
  mode: FileMode,
  lexed: Lexed,
): Parser {
  const parserDiagnostics: Diagnostic[] = [];
  const parserKinds = lexed.kinds;
  const parserStarts = lexed.starts;
  const parserEnds = lexed.ends;
  let parserPos = 0;
  let parserSig = true;
  let parserUnmatched = 0;
  let parserDepth = 0;
  let parserLastErrorPos = -1;
  let parserLastErrorStart = -1;
  let parserLastErrorEnd = -1;
  const parserNodeKinds: number[] = [];
  const parserNodeStarts: number[] = [];
  const parserNodeEnds: number[] = [];
  const parserNodeParents: number[] = [];
  const parserNodeTokens: number[] = [];
  const parserNodeChildStart: number[] = [];
  const parserNodeChildEnd: number[] = [];
  const parserFlat: number[] = [];
  const parserStack: NodeId[][] = [];
  const parserSource = source;
  const parserText = text;
  const parserMode = mode;
  const parserLexed = lexed;
  let owner: Parser;

  function binaryPrecedence(k: TokenKind | undefined): number {
    if (k === TokenKind.PipePipe) return 1;
    if (k === TokenKind.AmpAmp) return 2;
    if (k === TokenKind.EqEqEq || k === TokenKind.BangEqEq) return 3;
    if (
      k === TokenKind.Lt || k === TokenKind.LtEq || k === TokenKind.Gt ||
      k === TokenKind.GtEq
    ) return 4;
    if (k === TokenKind.Plus || k === TokenKind.Minus) return 5;
    if (
      k === TokenKind.Star || k === TokenKind.Slash || k === TokenKind.Percent
    ) return 6;
    return 0;
  }

  function isLogicalToken(kind: number): boolean {
    return kind === TokenKind.AmpAmp || kind === TokenKind.PipePipe;
  }

  /** For each opening bracket, the index of its closing token, or -1. */
  function matchBrackets(kinds: Uint8Array, count: number): Int32Array {
    const match = int32Array(count).fill(-1);
    const parens: number[] = [];
    const braces: number[] = [];
    const brackets: number[] = [];
    let index = 0;
    for (const kind of kinds) {
      if (kind === TokenKind.LParen) {
        parens[parens.length] = index;
      } else if (kind === TokenKind.LBrace) {
        braces[braces.length] = index;
      } else if (kind === TokenKind.LBracket) {
        brackets[brackets.length] = index;
      } else if (kind === TokenKind.RParen) {
        const open = parens.pop();
        if (open !== undefined) match[open] = index;
      } else if (kind === TokenKind.RBrace) {
        const open = braces.pop();
        if (open !== undefined) match[open] = index;
      } else if (kind === TokenKind.RBracket) {
        const open = brackets.pop();
        if (open !== undefined) match[open] = index;
      }
      index = index + 1;
    }
    return match;
  }

  const parserMatch = matchBrackets(lexed.kinds, lexed.count);

  function parserRun(): SyntaxTree {
    const root = parserParseModule();
    parserNodeStarts[root] = 0;
    parserNodeEnds[root] = parserText.length;
    return {
      source: parserSource,
      text: parserText,
      mode: parserMode,
      lexed: parserLexed,
      root: root,
      count: parserNodeKinds.length,
      kinds: byteArrayFrom(parserNodeKinds),
      starts: uint32ArrayFrom(parserNodeStarts),
      ends: uint32ArrayFrom(parserNodeEnds),
      parents: int32ArrayFrom(parserNodeParents),
      tokens: int32ArrayFrom(parserNodeTokens),
      childStart: uint32ArrayFrom(parserNodeChildStart),
      childEnd: uint32ArrayFrom(parserNodeChildEnd),
      children: uint32ArrayFrom(parserFlat),
    };
  }

  function parserTop(): NodeId[] {
    return parserStack[parserStack.length - 1];
  }

  function parserNewNode(
    kind: SyntaxKind,
    start: number,
    end: number,
    token: number,
  ): NodeId {
    const id = parserNodeKinds.length;
    parserNodeKinds[parserNodeKinds.length] = kind;
    parserNodeStarts[parserNodeStarts.length] = start;
    parserNodeEnds[parserNodeEnds.length] = end;
    parserNodeParents[parserNodeParents.length] = -1;
    parserNodeTokens[parserNodeTokens.length] = token;
    parserNodeChildStart[parserNodeChildStart.length] = 0;
    parserNodeChildEnd[parserNodeChildEnd.length] = 0;
    return id;
  }

  function parserBegin(): Parser {
    parserStack[parserStack.length] = [];

    return owner;
  }

  function parserEnd(kind: SyntaxKind): Parser {
    const list = parserStack.pop();
    if (list === undefined) {
      return panic("internal: end() without begin()");
    }
    let start = -1;
    let stop = -1;
    let missingAt = -1;
    for (const child of list) {
      const ck = parserNodeKinds[child];
      if (ck === SyntaxKind.Missing) {
        if (missingAt < 0) missingAt = parserNodeStarts[child];
        continue;
      }
      if (
        ck === SyntaxKind.Token &&
        parserKinds[parserNodeTokens[child]] === TokenKind.Newline
      ) {
        continue;
      }
      if (start < 0) start = parserNodeStarts[child];
      stop = parserNodeEnds[child];
    }
    if (start < 0) {
      start = missingAt >= 0 ? missingAt : parserPrevEnd();
      stop = start;
    }
    const id = parserNewNode(kind, start, stop, -1);
    parserNodeChildStart[id] = parserFlat.length;
    for (const child of list) {
      parserFlat[parserFlat.length] = child;
      parserNodeParents[child] = id;
    }
    parserNodeChildEnd[id] = parserFlat.length;
    if (parserStack.length > 0) {
      const top = parserTop();
      top[top.length] = id;
    }
    return owner;
  }

  function parserCheckpoint(): number {
    return parserTop().length;
  }

  function parserWrap(cp: number, kind: SyntaxKind): Parser {
    const items = parserTop().splice(cp);
    parserStack[parserStack.length] = items;
    return parserEnd(kind);
  }

  function parserLeaf(): Parser {
    const t = parserPos;
    const id = parserNewNode(
      SyntaxKind.Token,
      parserStarts[t],
      parserEnds[t],
      t,
    );
    const top = parserTop();
    top[top.length] = id;
    parserPos = parserPos + 1;
    return owner;
  }

  function parserTok(): Parser {
    if (parserKinds[parserPos] === TokenKind.Eof) {
      return panic("internal: consumed Eof token");
    }
    return parserLeaf();
  }

  function parserSkipNl(): Parser {
    if (parserKinds[parserPos] !== TokenKind.Newline) return owner;
    const p = parserLaPos();
    const k = parserKinds[p];
    if (
      k === TokenKind.KwConst || k === TokenKind.KwImport ||
      k === TokenKind.KwExport ||
      (parserIsDeclarationWord(p) && parserKinds[p + 1] === TokenKind.Ident)
    ) {
      return owner;
    }
    return parserLeafNewlines();
  }

  function parserLeafNewlines(): Parser {
    for (const _kind of parserKinds) {
      if (parserKinds[parserPos] !== TokenKind.Newline) break;
      owner = parserLeaf();
    }

    return owner;
  }

  function parserSkipSeps(): Parser {
    for (const _kind of parserKinds) {
      if (
        parserKinds[parserPos] !== TokenKind.Newline &&
        parserKinds[parserPos] !== TokenKind.Semicolon
      ) break;
      owner = parserLeaf();
    }

    return owner;
  }

  function parserKind(): TokenKind | undefined {
    if (!parserSig) owner = parserLeafNewlines();
    if (parserUnmatched > 0 && parserAtDeclarationStart(false)) {
      return TokenKind.Eof;
    }
    return tokenKind(parserKinds[parserPos]);
  }

  function parserLaPos(): number {
    let p = parserPos;
    for (const _kind of parserKinds) {
      if (parserKinds[p] !== TokenKind.Newline) break;
      p = p + 1;
    }
    return p;
  }

  function parserLa(): TokenKind | undefined {
    return tokenKind(parserKinds[parserLaPos()]);
  }

  function parserAtDeclarationStart(constAnyColumn: boolean): boolean {
    const p = parserPos;
    if (p === 0 || parserKinds[p - 1] !== TokenKind.Newline) return false;
    if (
      parserKinds[p] === TokenKind.KwImport ||
      parserKinds[p] === TokenKind.KwExport
    ) return true;
    if (parserKinds[p] === TokenKind.KwConst) {
      return constAnyColumn ||
        parserLexed.triviaEnd[p - 1] === parserLexed.triviaEnd[p];
    }
    if (parserKinds[p] === TokenKind.Ident) {
      return (parserIsDeclarationWord(p) || parserIsServiceImportAt(p)) &&
        parserKinds[p + 1] === TokenKind.Ident;
    }
    return false;
  }

  function parserIsDeclarationWord(p: number): boolean {
    return isDeclarationStartWord(parserLexed, p);
  }

  function parserIsServiceImportAt(p: number): boolean {
    return parserKinds[p] === TokenKind.Ident &&
      parserIsWordAt(p, "imports") &&
      parserKinds[p + 1] === TokenKind.Ident;
  }

  function parserIsWordAt(
    p: number,
    word: ContextualWord | ParserCheckedWord | "_",
  ): boolean {
    return isWord(parserLexed, p, word);
  }

  function parserParserCheckedWordAt(p: number): ParserCheckedWord | undefined {
    return PARSER_CHECKED_WORDS.find((word) => parserIsWordAt(p, word));
  }

  function parserClauseAhead(word: ContextualWord): boolean {
    const p = parserLaPos();
    return parserIsWordAt(p, word) && parserKinds[p + 1] === TokenKind.Ident;
  }

  function parserOpen(inner: "sig" | "free"): Group {
    const index = parserPos;
    owner = parserTok();
    const group: Group = {
      sig: parserSig,
      unmatched: parserMatch[index] < 0 ? 1 : 0,
    };
    parserSig = inner === "sig";
    parserUnmatched = parserUnmatched + group.unmatched;
    return group;
  }

  function parserClose(group: Group, closer: TokenKind, label: string): Parser {
    owner = parserExpect(closer, label);
    parserSig = group.sig;
    parserUnmatched = parserUnmatched - group.unmatched;

    return owner;
  }

  function parserPrevEnd(): number {
    let p = parserPos - 1;
    for (const _kind of parserKinds) {
      if (!(p >= 0 && parserKinds[p] === TokenKind.Newline)) break;
      p = p - 1;
    }
    return p < 0 ? 0 : parserEnds[p];
  }

  function parserFoundDescription(): string {
    const raw = tokenKind(parserKinds[parserPos]);
    if (raw === undefined) {
      return `internal token kind ${parserKinds[parserPos]}`;
    }
    if (raw === TokenKind.Eof) return "end of file";
    if (raw === TokenKind.Newline) return "end of line";
    if (parserUnmatched > 0 && parserAtDeclarationStart(false)) {
      return "the start of the next declaration";
    }
    if (
      raw === TokenKind.Ident || raw === TokenKind.Number ||
      raw === TokenKind.String || isKeywordKind(raw)
    ) {
      const t = parserText.slice(
        parserStarts[parserPos],
        parserEnds[parserPos],
      );
      return `\`${t.length > 24 ? t.slice(0, 24) + "..." : t}\``;
    }
    return describeTokenKind(raw);
  }

  function parserErrorSpan(
    atPreviousEnd: boolean,
  ): { start: number; end: number } {
    const raw = parserKinds[parserPos];
    const afterNewline = parserPos > 0 &&
      parserKinds[parserPos - 1] === TokenKind.Newline;
    if (
      raw === TokenKind.Eof || raw === TokenKind.Newline ||
      (atPreviousEnd && afterNewline)
    ) {
      const at = parserPrevEnd();
      return { start: at, end: at };
    }
    return {
      start: parserStarts[parserPos],
      end: parserEnds[parserPos],
    };
  }

  function parserReport(
    code: DiagnosticCode,
    message: string,
    start: number,
    end: number,
  ): Parser {
    parserDiagnostics[parserDiagnostics.length] = makeDiagnostic(
      code,
      message,
      { source: parserSource, start: start, end: end },
    );

    return owner;
  }

  function parserReportAtToken(code: DiagnosticCode, message: string): Parser {
    return parserReport(
      code,
      message,
      parserStarts[parserPos],
      parserEnds[parserPos],
    );
  }

  function parserProblem(
    code: DiagnosticCode,
    message: string,
    atPreviousEnd: boolean,
  ): Parser {
    if (parserKinds[parserPos] === TokenKind.Unknown) return owner;
    const span = parserErrorSpan(atPreviousEnd);
    if (
      parserLastErrorPos === parserPos ||
      (span.start === parserLastErrorStart && span.end === parserLastErrorEnd)
    ) {
      return owner;
    }
    parserLastErrorPos = parserPos;
    parserLastErrorStart = span.start;
    parserLastErrorEnd = span.end;
    return parserReport(code, message, span.start, span.end);
  }

  function parserExpectedAt(label: string): Parser {
    return parserProblem(
      "syntax/008",
      `expected ${label}, found ${parserFoundDescription()}`,
      true,
    );
  }

  function parserUnexpectedAt(context: string): Parser {
    return parserProblem(
      "syntax/009",
      `unexpected ${parserFoundDescription()}${context}`,
      false,
    );
  }

  function parserExpectThenNl(kind: TokenKind, label: string): Parser {
    if (parserKind() !== kind) return parserMissing(label);
    owner = parserTok();
    return parserSkipNl();
  }

  function parserExpectArrow(): Parser {
    if (parserLa() !== TokenKind.Arrow) return parserMissing("`=>`");
    owner = parserSkipNl();
    return parserTok();
  }

  function parserMissing(label: string): Parser {
    owner = parserExpectedAt(label);
    return parserAppendMissing();
  }

  function parserAppendMissing(): Parser {
    const at = parserPrevEnd();
    const top = parserTop();
    top[top.length] = parserNewNode(
      SyntaxKind.Missing,
      at,
      at,
      -1,
    );

    return owner;
  }

  function parserExpect(kind: TokenKind, label: string): Parser {
    if (parserKind() === kind) {
      return parserTok();
    }
    return parserMissing(label);
  }

  function parserSkipJunk(
    stop: (k: TokenKind | undefined) => boolean,
    context: string,
  ): Parser {
    owner = parserBegin();
    let skipped = 0;
    for (const _kind of parserKinds) {
      const k = parserKind();
      if (k === TokenKind.Eof) break;
      if (skipped > 0 && stop(k)) break;
      if (skipped === 0) owner = parserUnexpectedAt(context);
      const open = parserPos;
      const close = k === TokenKind.LParen || k === TokenKind.LBrace ||
          k === TokenKind.LBracket
        ? parserMatch[open]
        : -1;
      if (close >= 0) {
        for (const _nestedKind of parserKinds) {
          if (parserPos > close) break;
          owner = parserLeaf();
        }
      } else {
        owner = parserTok();
      }
      skipped = skipped + 1;
    }
    if (skipped === 0) {
      parserStack.length = parserStack.length - 1;
    } else {
      owner = parserEnd(SyntaxKind.Error);
    }

    return owner;
  }

  function parserEnter(): boolean {
    if (parserDepth >= MAX_NESTING) {
      owner = parserSkipJunk(() => true, "; nesting is too deep");
      return false;
    }
    parserDepth = parserDepth + 1;
    return true;
  }

  function parserLeave(): Parser {
    parserDepth = parserDepth - 1;

    return owner;
  }

  function parserEnterLink(): boolean {
    if (!parserEnter()) return false;
    if (parserEnter()) return true;
    owner = parserLeave();
    return false;
  }

  function parserLeaveLinks(links: number): Parser {
    parserDepth = parserDepth - 2 * links;

    return owner;
  }

  function parserRecoverTop(): Parser {
    owner = parserBegin();
    let skipped = 0;
    for (const _kind of parserKinds) {
      if (parserKinds[parserPos] === TokenKind.Eof) break;
      if (skipped > 0 && parserAtDeclarationStart(true)) break;
      if (skipped === 0) owner = parserUnexpectedAt("; expected a declaration");
      owner = parserLeaf();
      skipped = skipped + 1;
    }
    if (skipped === 0) {
      parserStack.length = parserStack.length - 1;
    } else {
      owner = parserEnd(SyntaxKind.Error);
    }

    return owner;
  }

  function parserParseCommaList(closer: TokenKind, item: () => Parser): Parser {
    for (const _kind of parserKinds) {
      const k = parserKind();
      if (k === closer || k === TokenKind.Eof) break;
      const startPos = parserPos;
      owner = item();
      if (parserKind() === TokenKind.Comma) {
        owner = parserTok();
        continue;
      }
      const k2 = parserKind();
      if (k2 === closer || k2 === TokenKind.Eof) break;
      owner = parserMissing("`,`");
      if (parserPos === startPos) {
        owner = parserSkipJunk(
          (x) =>
            x === TokenKind.Comma || x === TokenKind.RParen ||
            x === TokenKind.RBracket ||
            x === TokenKind.RBrace,
          "",
        );
      }
    }

    return owner;
  }

  function parserParseDelimited(closer: TokenKind, item: () => Parser): Parser {
    const group = parserOpen("free");
    owner = parserParseCommaList(closer, item);
    return parserClose(group, closer, describeTokenKind(closer));
  }

  function parserParseSeparated(item: () => Parser): Parser {
    for (const _kind of parserKinds) {
      owner = parserSkipSeps();
      const k = parserKind();
      if (k === TokenKind.RBrace || k === TokenKind.Eof) break;
      owner = item();
      const k2 = parserKind();
      if (
        k2 === TokenKind.Newline || k2 === TokenKind.Semicolon ||
        k2 === TokenKind.RBrace ||
        k2 === TokenKind.Eof
      ) {
        continue;
      }
      owner = parserExpectedAt("end of line or `;`");
      owner = parserSkipJunk(
        (x) =>
          x === TokenKind.Newline || x === TokenKind.Semicolon ||
          x === TokenKind.RBrace,
        "",
      );
    }

    return owner;
  }

  function parserParseModule(): NodeId {
    owner = parserBegin();
    let serviceHeadersAllowed = true;
    for (const _kind of parserKinds) {
      owner = parserSkipSeps();
      const k = parserKind();
      if (k === TokenKind.Eof) break;
      if (parserIsServiceImportAt(parserPos)) {
        owner = parserParseServiceImport(!serviceHeadersAllowed);
        owner = parserFinishTopItem();
      } else {
        serviceHeadersAllowed = false;
        owner = parserParseTopItem(k);
      }
    }
    owner = parserLeaf();
    owner = parserEnd(SyntaxKind.Module);
    return parserNodeKinds.length - 1;
  }

  function parserParseTopItem(k: TokenKind | undefined): Parser {
    if (k === TokenKind.KwImport) {
      owner = parserParseImport();
    } else if (
      k === TokenKind.KwExport || k === TokenKind.KwConst ||
      parserIsDeclarationWord(parserPos)
    ) {
      owner = parserParseDeclaration();
    } else {
      return parserRecoverTop();
    }
    return parserFinishTopItem();
  }

  function parserFinishTopItem(): Parser {
    const k2 = parserKind();
    if (
      k2 === TokenKind.Newline || k2 === TokenKind.Semicolon ||
      k2 === TokenKind.Eof
    ) return owner;
    if (parserAtDeclarationStart(true)) return owner;
    owner = parserExpectedAt("end of line or `;`");
    return parserRecoverTop();
  }

  function parserParseImport(): Parser {
    owner = parserBegin();
    owner = parserTok();
    if (parserKind() === TokenKind.LBrace) {
      owner = parserParseDelimited(
        TokenKind.RBrace,
        () => parserParseName("binding"),
      );
    } else {
      owner = parserMissing("`{`");
    }
    return parserParseImportSource();
  }

  function parserParseImportSource(): Parser {
    if (parserKind() === TokenKind.Ident && parserIsWordAt(parserPos, "from")) {
      owner = parserTok();
    } else {
      owner = parserMissing("`from`");
    }
    if (parserKind() === TokenKind.String) owner = parserTok();
    else owner = parserMissing("a string");
    return parserEnd(SyntaxKind.ImportDecl);
  }

  function parserParseServiceImport(misplaced: boolean): Parser {
    owner = parserBegin();
    const start = parserStarts[parserPos];
    const end = parserEnds[parserPos];
    if (misplaced) {
      owner = parserReport(
        "syntax/008",
        "a service import must precede ordinary imports and declarations",
        start,
        end,
      );
    }
    if (parserMode === "effi") {
      owner = parserReport(
        "syntax/008",
        "a host interface file cannot contain a service import",
        start,
        end,
      );
    }
    owner = parserTok();
    owner = parserParseName("binding");
    return parserParseImportSource();
  }

  function parserParseDeclaration(): Parser {
    owner = parserBegin();
    if (parserKind() === TokenKind.KwExport) owner = parserTok();
    const k = parserKind();
    let kind: SyntaxKind = SyntaxKind.Error;
    if (k === TokenKind.KwConst) {
      kind = SyntaxKind.ConstDecl;
      owner = parserParseConstBody(true);
    } else if (k === TokenKind.Ident && parserIsDeclarationWord(parserPos)) {
      const word = parserText.slice(
        parserStarts[parserPos],
        parserEnds[parserPos],
      );
      if (word === "type") {
        kind = SyntaxKind.TypeDecl;
        owner = parserParseTypeBody();
      } else if (word === "opaque") {
        kind = SyntaxKind.TypeDecl;
        owner = parserParseOpaqueTypeBody();
      } else if (word === "sealed") {
        kind = SyntaxKind.TypeDecl;
        owner = parserParseSealedTypeBody();
      } else if (word === "error") {
        kind = SyntaxKind.ErrorDecl;
        owner = parserParseErrorBody();
      } else if (word === "service") {
        kind = SyntaxKind.ServiceDecl;
        owner = parserParseServiceBody();
      } else {
        kind = SyntaxKind.ProviderDecl;
        owner = parserParseProviderBody();
      }
    } else {
      owner = parserMissing("a declaration");
    }
    return parserEnd(kind);
  }

  function parserParseConstBody(topLevel: boolean): Parser {
    if (topLevel && parserMode === "effi") {
      owner = parserReportAtToken(
        "syntax/012",
        "a host interface file cannot contain `const`",
      );
    }
    owner = parserTok();
    if (!topLevel && parserKind() === TokenKind.LBrace) {
      owner = parserParseRecordBinding();
    } else owner = parserParseName("binding");
    if (parserKind() === TokenKind.Colon) {
      owner = parserTok();
      owner = parserSkipNl();
      owner = parserParseType();
    }
    owner = parserExpectThenNl(TokenKind.Eq, "`=`");
    return parserParseExpr();
  }

  function parserParseRecordBinding(): Parser {
    owner = parserBegin();
    let fields = 0;
    owner = parserParseDelimited(TokenKind.RBrace, () => {
      fields = fields + 1;
      owner = parserBegin();
      owner = parserParseName("binding");
      if (parserKind() === TokenKind.Colon) {
        owner = parserTok();
        owner = parserSkipNl();
        owner = parserParseName("binding");
        owner = parserEnd(SyntaxKind.BindingField);
      } else owner = parserEnd(SyntaxKind.ShorthandBinding);

      return owner;
    });
    if (fields === 0) {
      owner = parserExpectedAt("at least one record binding field");
    }
    return parserEnd(SyntaxKind.RecordBinding);
  }

  function parserParseTypeBody(): Parser {
    owner = parserTok();
    owner = parserParseName("binding");
    owner = parserExpectThenNl(TokenKind.Eq, "`=`");
    owner = parserParseType();
    if (
      parserKind() === TokenKind.Ident && parserIsWordAt(parserPos, "where")
    ) {
      owner = parserBegin();
      owner = parserTok();
      owner = parserParseExpr();
      owner = parserEnd(SyntaxKind.RefinementClause);
    }

    return owner;
  }

  function parserParseSealedTypeBody(): Parser {
    const start = parserStarts[parserPos];
    const end = parserEnds[parserPos];
    owner = parserTok();
    if (parserMode === "effi") {
      owner = parserReport(
        "syntax/008",
        "a sealed type declaration is not allowed in a host interface file",
        start,
        end,
      );
    }
    if (parserKind() === TokenKind.Ident && parserIsWordAt(parserPos, "type")) {
      owner = parserParseTypeBody();
    } else {
      owner = parserMissing("`type`");
    }

    return owner;
  }

  function parserParseOpaqueTypeBody(): Parser {
    if (parserMode !== "effi") {
      owner = parserReportAtToken(
        "syntax/012",
        "an opaque type belongs in a host interface file",
      );
    }
    owner = parserTok();
    if (parserKind() === TokenKind.Ident && parserIsWordAt(parserPos, "type")) {
      owner = parserTok();
    } else owner = parserMissing("`type`");
    return parserParseName("binding");
  }

  function parserParseErrorBody(): Parser {
    owner = parserTok();
    owner = parserParseName("binding");
    owner = parserExpectThenNl(TokenKind.Eq, "`=`");
    if (parserKind() === TokenKind.LBrace) owner = parserParseRecordType();
    else owner = parserMissing("a record type");

    return owner;
  }

  function parserParseServiceBody(): Parser {
    owner = parserTok();
    owner = parserParseName("binding");
    if (parserKind() === TokenKind.LBrace) {
      const group = parserOpen("sig");
      owner = parserParseSeparated(() => parserParseServiceMethod());
      owner = parserClose(group, TokenKind.RBrace, "`}`");
    } else {
      owner = parserMissing("`{`");
    }

    return owner;
  }

  function parserParseServiceMethod(): Parser {
    owner = parserBegin();
    owner = parserParseName("member");
    owner = parserParseParamList();
    owner = parserExpectThenNl(TokenKind.Colon, "`:`");
    owner = parserParseType();
    if (parserClauseAhead("fails")) {
      owner = parserParseKeywordClause(SyntaxKind.FailsClause, false);
    }
    return parserEnd(SyntaxKind.ServiceMethod);
  }

  function parserParseProviderBody(): Parser {
    if (parserMode !== "effi") {
      owner = parserReportAtToken(
        "syntax/013",
        "a provider declaration is allowed only in a host interface file (.effi)",
      );
    }
    owner = parserTok();
    owner = parserParseName("binding");
    if (
      parserKind() === TokenKind.Ident && parserIsWordAt(parserPos, "provides")
    ) {
      owner = parserBegin();
      owner = parserTok();
      owner = parserParseNameSet(true);
      owner = parserEnd(SyntaxKind.ProvidesClause);
    } else {
      owner = parserMissing("`provides`");
    }
    return parserParseEffects();
  }

  function parserParseEffects(): Parser {
    if (parserClauseAhead("fails")) {
      owner = parserParseKeywordClause(SyntaxKind.FailsClause, false);
    }
    // A `with` clause starts here, possibly after newlines.
    const p = parserLaPos();
    if (
      parserKinds[p] === TokenKind.KwWith &&
      parserKinds[p + 1] === TokenKind.Ident
    ) owner = parserParseKeywordClause(SyntaxKind.WithClause, true);

    return owner;
  }

  function parserParseKeywordClause(
    clause: SyntaxKind,
    qualified: boolean,
  ): Parser {
    owner = parserSkipNl();
    owner = parserBegin();
    owner = parserTok();
    owner = parserParseNameSet(qualified);
    return parserEnd(clause);
  }

  function parserParseNameSet(qualified: boolean): Parser {
    for (const _kind of parserKinds) {
      if (qualified) owner = parserParseQualifiedName();
      else owner = parserParseName("member");
      if (parserKind() !== TokenKind.Pipe) break;
      owner = parserTok();
      owner = parserSkipNl();
    }

    return owner;
  }

  function parserParseQualifiedName(): Parser {
    owner = parserBegin();
    owner = parserParseName("member");
    for (const _kind of parserKinds) {
      if (parserKind() !== TokenKind.Dot) break;
      owner = parserTok();
      owner = parserParseName("member");
    }
    return parserEnd(SyntaxKind.QualifiedName);
  }

  function parserParseName(role: "binding" | "member" | "type"): Parser {
    owner = parserBegin();
    const k = parserKind();
    if (k === TokenKind.Ident) {
      const word = parserParserCheckedWordAt(parserPos);
      if (role === "binding" && word !== undefined) {
        owner = parserReportAtToken(
          "syntax/007",
          `\`${word}\` is a reserved word and cannot be a name`,
        );
      }
      owner = parserTok();
    } else if (isKeywordKind(k)) {
      owner = parserExpectedAt("a name");
      owner = parserTok();
    } else {
      owner = parserMissing("a name");
    }
    return parserEnd(SyntaxKind.Name);
  }

  function parserParseParamList(): Parser {
    owner = parserBegin();
    if (parserKind() === TokenKind.LParen) {
      owner = parserParseDelimited(TokenKind.RParen, () => parserParseParam());
    } else {
      owner = parserMissing("`(`");
    }
    return parserEnd(SyntaxKind.ParamList);
  }

  function parserParseParam(): Parser {
    owner = parserBegin();
    if (
      parserKind() === TokenKind.Ident && parserIsWordAt(parserPos, "borrow") &&
      parserKinds[parserPos + 1] === TokenKind.Ident
    ) {
      owner = parserTok();
    }
    owner = parserParseName("binding");
    if (parserKind() === TokenKind.Colon) {
      owner = parserTok();
      owner = parserSkipNl();
      owner = parserParseType();
    }
    return parserEnd(SyntaxKind.Param);
  }

  function parserParseType(): Parser {
    const cp = parserCheckpoint();
    owner = parserParsePostfixType();
    if (parserKind() !== TokenKind.Pipe) return owner;
    for (const _kind of parserKinds) {
      if (parserKind() !== TokenKind.Pipe) break;
      owner = parserTok();
      owner = parserSkipNl();
      owner = parserParsePostfixType();
    }
    return parserWrap(cp, SyntaxKind.UnionType);
  }

  function parserParsePostfixType(): Parser {
    const cp = parserCheckpoint();
    owner = parserParsePrimaryType();
    let links = 0;
    for (const _kind of parserKinds) {
      if (
        parserKind() !== TokenKind.LBracket ||
        parserKinds[parserPos + 1] !== TokenKind.RBracket
      ) break;
      if (!parserEnterLink()) break;
      links = links + 1;
      owner = parserTok();
      owner = parserTok();
      owner = parserWrap(cp, SyntaxKind.ArrayType);
    }
    return parserLeaveLinks(links);
  }

  function parserParsePrimaryType(): Parser {
    if (!parserEnter()) return owner;
    owner = parserParsePrimaryTypeInner();
    return parserLeave();
  }

  function parserParsePrimaryTypeInner(): Parser {
    const k = parserKind();
    if (k === TokenKind.Ident) {
      const name = parserText.slice(
        parserStarts[parserPos],
        parserEnds[parserPos],
      );
      if (name === "pure") {
        let open = parserPos + 1;
        for (const _kind of parserKinds) {
          if (parserKinds[open] !== TokenKind.Newline) break;
          open = open + 1;
        }
        if (
          parserKinds[open] === TokenKind.LParen &&
          parserParenFollowedBy(open, false)
        ) {
          owner = parserBegin();
          owner = parserTok();
          owner = parserSkipNl();
          return parserParseFunctionType();
        }
      }
      const word = typeWord(name);
      if (word !== undefined && parserKinds[parserPos + 1] === TokenKind.Lt) {
        owner = parserBegin();
        owner = parserTok();
        const group = parserOpen("free");
        for (const index of word.slots.keys()) {
          const slot = word.slots[index];
          if (index > 0) {
            if (parserKind() === TokenKind.Comma) owner = parserTok();
            else if (slot.required) owner = parserMissing("`,`");
            else break;
          }
          owner = parserParseSlot(slot.kind);
        }
        owner = parserClose(group, TokenKind.Gt, "`>`");
        return parserEnd(word.kind);
      }
      owner = parserBegin();
      owner = parserParseName("type");
      if (parserKind() === TokenKind.Lt) {
        owner = parserBegin();
        owner = parserParseDelimited(TokenKind.Gt, () => parserParseType());
        owner = parserEnd(SyntaxKind.TypeArgs);
      }
      return parserEnd(SyntaxKind.NamedType);
    } else if (
      k === TokenKind.String || k === TokenKind.Number ||
      k === TokenKind.KwTrue || k === TokenKind.KwFalse ||
      k === TokenKind.KwNull
    ) {
      owner = parserBegin();
      owner = parserTok();
      return parserEnd(SyntaxKind.LiteralType);
    } else if (k === TokenKind.LBrace) {
      return parserParseRecordType();
    } else if (k === TokenKind.LBracket) {
      owner = parserBegin();
      owner = parserParseDelimited(
        TokenKind.RBracket,
        () => parserParseType(),
      );
      return parserEnd(SyntaxKind.TupleType);
    } else if (k === TokenKind.LParen) {
      if (parserParenFollowedBy(parserPos, false)) {
        owner = parserBegin();
        owner = parserParseFunctionType();
      } else {
        owner = parserBegin();
        const group = parserOpen("free");
        owner = parserParseType();
        owner = parserClose(group, TokenKind.RParen, "`)`");
        owner = parserEnd(SyntaxKind.ParenType);
      }
      return owner;
    } else {
      owner = parserMissing("a type");
    }

    return owner;
  }

  function parserParseFunctionType(): Parser {
    owner = parserParseParamList();
    owner = parserExpectArrow();
    owner = parserSkipNl();
    owner = parserParseType();
    owner = parserParseEffects();
    return parserEnd(SyntaxKind.FunctionType);
  }

  function parserParseSlot(kind: TypeSlotKind): Parser {
    if (kind === "type") {
      return parserParseType();
    }
    if (kind === "provides") {
      return parserParseNameSetClause(SyntaxKind.ProvidesClause, true);
    }
    if (kind === "fails") {
      return parserParseNameSetClause(SyntaxKind.FailsClause, false);
    }
    if (kind === "with") {
      return parserParseNameSetClause(SyntaxKind.WithClause, true);
    }
    const unreachable: never = kind;
    return unreachable;
  }

  function parserParseNameSetClause(
    clause: SyntaxKind,
    qualified: boolean,
  ): Parser {
    owner = parserBegin();
    owner = parserParseNameSet(qualified);
    return parserEnd(clause);
  }

  function parserParseRecordType(): Parser {
    owner = parserBegin();
    owner = parserParseDelimited(TokenKind.RBrace, () => {
      owner = parserBegin();
      owner = parserParseName("member");
      if (parserKind() === TokenKind.Question) owner = parserTok();
      owner = parserExpectThenNl(TokenKind.Colon, "`:`");
      owner = parserParseType();
      return parserEnd(SyntaxKind.FieldType);
    });
    return parserEnd(SyntaxKind.RecordType);
  }

  function parserParenFollowedBy(p: number, allowColon: boolean): boolean {
    const m = parserMatch[p];
    if (m < 0) return false;
    let q = m + 1;
    for (const _kind of parserKinds) {
      if (parserKinds[q] !== TokenKind.Newline) break;
      q = q + 1;
    }
    const k = parserKinds[q];
    return k === TokenKind.Arrow || (allowColon && k === TokenKind.Colon);
  }

  function parserParseExpr(): Parser {
    if (!parserEnter()) return owner;
    owner = parserParseExprInner();
    return parserLeave();
  }

  function parserParseExprInner(): Parser {
    const cp = parserCheckpoint();
    owner = parserParseFallback();
    let links = 0;
    for (const _kind of parserKinds) {
      if (parserLa() !== TokenKind.PipeGt) break;
      if (!parserEnterLink()) break;
      links = links + 1;
      owner = parserSkipNl();
      owner = parserTok();
      owner = parserSkipNl();
      owner = parserBegin();
      if (parserKind() === TokenKind.Ident) {
        owner = parserParseQualifiedName();
        if (parserKind() === TokenKind.LParen) owner = parserParseArgList();
      } else {
        owner = parserMissing("a pipeline stage");
      }
      owner = parserEnd(SyntaxKind.PipeStage);
      owner = parserWrap(cp, SyntaxKind.PipeExpr);
    }
    return parserLeaveLinks(links);
  }

  function parserParseFallback(): Parser {
    const cp = parserCheckpoint();
    owner = parserParseBinary(1);
    if (parserKind() === TokenKind.QuestionQuestion) {
      if (!parserEnterLink()) return owner;
      owner = parserTok();
      owner = parserSkipNl();
      owner = parserParseFallback();
      owner = parserWrap(cp, SyntaxKind.OptionFallbackExpr);
      const node = parserNodeKinds.length - 1;
      for (
        const operand of parserFlat.slice(
          parserNodeChildStart[node],
          parserNodeChildEnd[node],
        )
      ) {
        if (parserNodeKinds[operand] !== SyntaxKind.BinaryExpr) continue;
        const logical = parserFlat.slice(
          parserNodeChildStart[operand],
          parserNodeChildEnd[operand],
        ).some((child) =>
          parserNodeKinds[child] === SyntaxKind.Token &&
          isLogicalToken(parserKinds[parserNodeTokens[child]])
        );
        if (logical) {
          owner = parserReport(
            "syntax/015",
            "parenthesize logical operands when mixing `??` with `&&` or `||`",
            parserNodeStarts[operand],
            parserNodeEnds[operand],
          );
        }
      }
      owner = parserLeaveLinks(1);
    }

    return owner;
  }

  function parserParseBinary(minPrecedence: number): Parser {
    const cp = parserCheckpoint();
    owner = parserParseUnary();
    let links = 0;
    for (const _kind of parserKinds) {
      const k = parserKind();
      const p = binaryPrecedence(k);
      if (p === 0 || p < minPrecedence) break;
      if (!parserEnterLink()) break;
      links = links + 1;
      owner = parserTok();
      owner = parserSkipNl();
      owner = parserParseBinary(p + 1);
      owner = parserWrap(cp, SyntaxKind.BinaryExpr);
    }
    return parserLeaveLinks(links);
  }

  function parserParseUnary(): Parser {
    const k = parserKind();
    if (k !== TokenKind.Minus && k !== TokenKind.Bang) {
      return parserParsePostfix();
    }
    if (!parserEnter()) return owner;
    owner = parserBegin();
    owner = parserTok();
    owner = parserSkipNl();
    owner = parserParseUnary();
    owner = parserEnd(SyntaxKind.UnaryExpr);
    return parserLeave();
  }

  function parserParsePostfix(): Parser {
    const cp = parserCheckpoint();
    owner = parserParsePrimary();
    let links = 0;
    for (const _kind of parserKinds) {
      const k = parserKind();
      if (k !== TokenKind.LParen && k !== TokenKind.Dot) break;
      if (!parserEnterLink()) break;
      links = links + 1;
      if (k === TokenKind.LParen) {
        owner = parserParseArgList();
        owner = parserWrap(cp, SyntaxKind.CallExpr);
      } else {
        owner = parserTok();
        owner = parserParseName("member");
        owner = parserWrap(cp, SyntaxKind.FieldExpr);
      }
    }
    return parserLeaveLinks(links);
  }

  function parserParseArgList(): Parser {
    owner = parserBegin();
    owner = parserParseDelimited(TokenKind.RParen, () => parserParseExpr());
    return parserEnd(SyntaxKind.ArgList);
  }

  function parserParsePrimary(): Parser {
    if (!parserEnter()) return owner;
    owner = parserParsePrimaryInner();
    return parserLeave();
  }

  function parserParsePrimaryInner(): Parser {
    const k = parserKind();
    if (
      k === TokenKind.Number || k === TokenKind.String ||
      k === TokenKind.KwTrue || k === TokenKind.KwFalse ||
      k === TokenKind.KwNull
    ) {
      owner = parserBegin();
      owner = parserTok();
      return parserEnd(SyntaxKind.LiteralExpr);
    }
    if (k === TokenKind.Ident) {
      if (
        parserIsWordAt(parserPos, "using") &&
        parserKinds[parserPos + 1] === TokenKind.LParen &&
        parserKinds[parserPos + 2] === TokenKind.Ident &&
        parserKinds[parserPos + 3] === TokenKind.Eq
      ) {
        return parserParseUsing();
      }
      let next = parserPos + 1;
      for (const _kind of parserKinds) {
        if (parserKinds[next] !== TokenKind.Newline) break;
        next = next + 1;
      }
      if (parserKinds[next] === TokenKind.Arrow) {
        return parserParseArrow();
      }
      owner = parserBegin();
      const word = parserParserCheckedWordAt(parserPos);
      if (word !== undefined) {
        owner = parserReportAtToken(
          "syntax/007",
          `\`${word}\` is a reserved word and cannot be a name`,
        );
      }
      owner = parserTok();
      return parserEnd(SyntaxKind.NameExpr);
    }
    if (k === TokenKind.LParen) {
      if (parserParenFollowedBy(parserPos, true)) {
        owner = parserParseArrow();
      } else {
        owner = parserBegin();
        const group = parserOpen("free");
        owner = parserParseExpr();
        owner = parserClose(group, TokenKind.RParen, "`)`");
        owner = parserEnd(SyntaxKind.ParenExpr);
      }
      return owner;
    }
    if (k === TokenKind.LBrace) {
      return parserParseRecordExpr();
    }
    if (k === TokenKind.LBracket) {
      owner = parserBegin();
      owner = parserParseDelimited(TokenKind.RBracket, () => {
        if (parserKind() !== TokenKind.DotDotDot) return parserParseExpr();
        owner = parserBegin();
        owner = parserTok();
        owner = parserParseExpr();
        return parserEnd(SyntaxKind.SpreadElement);
      });
      return parserEnd(SyntaxKind.ListExpr);
    }
    if (k === TokenKind.KwMatch) {
      return parserParseMatch();
    }
    if (k === TokenKind.KwIf) {
      return parserParseIf();
    }
    if (k === TokenKind.KwTry) {
      return parserParseTry();
    }
    if (k === TokenKind.Plus) {
      return parserParseRefusedUnary("unary operator `+` is not supported");
    }
    return parserMissing("an expression");
  }

  function parserParseRefusedUnary(message: string): Parser {
    owner = parserBegin();
    owner = parserReportAtToken("syntax/010", message);
    owner = parserTok();
    owner = parserParsePostfix();
    return parserEnd(SyntaxKind.Error);
  }

  function parserParseUsing(): Parser {
    owner = parserBegin();
    owner = parserTok();
    const group = parserOpen("free");
    owner = parserParseName("binding");
    owner = parserExpect(TokenKind.Eq, "`=`");
    owner = parserSkipNl();
    owner = parserBegin();
    owner = parserParseBody();
    owner = parserEnd(SyntaxKind.ResourceAcquire);
    owner = parserClose(group, TokenKind.RParen, "`)`");
    owner = parserSkipNl();
    owner = parserBegin();
    owner = parserParseBlockExpected();
    owner = parserEnd(SyntaxKind.ResourceUse);
    if (parserLa() === TokenKind.KwFinally) {
      owner = parserSkipNl();
      owner = parserTok();
    } else owner = parserMissing("`finally`");
    owner = parserSkipNl();
    owner = parserBegin();
    owner = parserParseOutcomeBinding();
    owner = parserParseBlockExpected();
    owner = parserEnd(SyntaxKind.ResourceRelease);
    return parserEnd(SyntaxKind.UsingExpr);
  }

  function parserParseArrow(): Parser {
    owner = parserBegin();
    if (parserKind() === TokenKind.Ident) {
      owner = parserBegin(); // A bare parameter has the same structure, without invented tokens.
      owner = parserBegin();
      owner = parserParseName("binding");
      owner = parserEnd(SyntaxKind.Param);
      owner = parserEnd(SyntaxKind.ParamList);
    } else {
      owner = parserParseParamList();
    }
    if (parserLa() === TokenKind.Colon) {
      owner = parserSkipNl();
      owner = parserTok();
      owner = parserSkipNl();
      owner = parserParseType();
      owner = parserParseEffects();
    }
    owner = parserExpectArrow();
    owner = parserSkipNl();
    owner = parserParseBody();
    return parserEnd(SyntaxKind.ArrowExpr);
  }

  function parserParseBody(): Parser {
    if (parserKind() !== TokenKind.LBrace) {
      owner = parserParseExpr();
    } else if (parserStartsRecordLiteral()) {
      owner = parserReportAtToken(
        "syntax/016",
        "a record literal body needs parentheses: `({ ... })`",
      );
      owner = parserParseRecordExpr();
    } else {
      owner = parserParseBlock();
    }

    return owner;
  }

  function parserStartsRecordLiteral(): boolean {
    let p = parserPos + 1;
    for (const _kind of parserKinds) {
      if (parserKinds[p] !== TokenKind.Newline) break;
      p = p + 1;
    }
    return parserKinds[p] === TokenKind.DotDotDot ||
      (parserKinds[p] === TokenKind.Ident &&
        parserKinds[p + 1] === TokenKind.Colon);
  }

  function parserParseBlock(): Parser {
    owner = parserBegin();
    const group = parserOpen("sig");
    let first = true;
    owner = parserParseSeparated(() => {
      const leading = first;
      first = false;
      if (parserKind() === TokenKind.KwConst) {
        owner = parserBegin();
        owner = parserParseConstBody(false);
        owner = parserEnd(SyntaxKind.ConstDecl);
      } else if (!leading && parserKind() === TokenKind.Minus) {
        // A newline ends the previous item, so this `-` would read as two statements.
        owner = parserParseRefusedUnary(
          "a block item cannot start with `-`; put `-` at the end of the previous line, or write `(-x)`",
        );
      } else {
        owner = parserParseExpr();
      }
      return owner;
    });
    owner = parserClose(group, TokenKind.RBrace, "`}`");
    return parserEnd(SyntaxKind.Block);
  }

  function parserParseBlockExpected(): Parser {
    if (parserKind() === TokenKind.LBrace) owner = parserParseBlock();
    else owner = parserMissing("`{`");

    return owner;
  }

  function parserParseRecordExpr(): Parser {
    owner = parserBegin();
    let index = 0;
    owner = parserParseDelimited(TokenKind.RBrace, () => {
      const k = parserKind();
      if (k === TokenKind.DotDotDot) {
        if (index > 0) {
          owner = parserReportAtToken(
            "syntax/014",
            "a spread must be the first field and appear only once",
          );
        }
        owner = parserBegin();
        owner = parserTok();
        owner = parserParseExpr();
        owner = parserEnd(SyntaxKind.SpreadField);
      } else if (k === TokenKind.Ident) {
        owner = parserBegin();
        if (parserKinds[parserPos + 1] === TokenKind.Colon) {
          owner = parserParseName("member");
          owner = parserTok();
          owner = parserSkipNl();
          owner = parserParseExpr();
          owner = parserEnd(SyntaxKind.RecordField);
        } else {
          owner = parserParseName("binding");
          owner = parserEnd(SyntaxKind.ShorthandField);
        }
      } else {
        owner = parserMissing("a field name");
      }
      index = index + 1;

      return owner;
    });
    return parserEnd(SyntaxKind.RecordExpr);
  }

  function parserParseIf(): Parser {
    if (!parserEnter()) return owner;
    owner = parserParseIfInner();
    return parserLeave();
  }

  function parserParseIfInner(): Parser {
    owner = parserBegin();
    owner = parserTok();
    if (parserKind() === TokenKind.LParen) {
      const group = parserOpen("free");
      owner = parserParseExpr();
      owner = parserClose(group, TokenKind.RParen, "`)`");
    } else {
      owner = parserMissing("`(`");
    }
    owner = parserParseBlockExpected();
    if (parserLa() === TokenKind.KwElse) {
      owner = parserSkipNl();
      owner = parserTok();
      if (parserKind() === TokenKind.KwIf) owner = parserParseIf();
      else owner = parserParseBlockExpected();
    } else {
      owner = parserMissing("`else`");
    }
    return parserEnd(SyntaxKind.IfExpr);
  }

  function parserParseMatch(): Parser {
    owner = parserBegin();
    owner = parserTok();
    owner = parserParseExpr();
    if (parserKind() === TokenKind.LBrace) {
      owner = parserParseDelimited(TokenKind.RBrace, () => parserParseArm());
    } else {
      owner = parserMissing("`{`");
    }
    return parserEnd(SyntaxKind.MatchExpr);
  }

  function parserParseArm(): Parser {
    owner = parserBegin();
    owner = parserParsePattern();
    owner = parserExpectThenNl(TokenKind.Arrow, "`=>`");
    owner = parserParseBody();
    return parserEnd(SyntaxKind.MatchArm);
  }

  function parserParseTry(): Parser {
    owner = parserBegin();
    owner = parserTok();
    owner = parserParseBlockExpected();
    const caught = parserLa() === TokenKind.KwCatch;
    if (caught) {
      owner = parserSkipNl();
      owner = parserBegin();
      owner = parserTok();
      if (parserKind() === TokenKind.LBrace) {
        owner = parserParseDelimited(
          TokenKind.RBrace,
          () => parserParseHandler(),
        );
      } else {
        owner = parserMissing("`{`");
      }
      owner = parserEnd(SyntaxKind.CatchClause);
    }
    if (parserLa() === TokenKind.KwFinally) {
      owner = parserSkipNl();
      owner = parserBegin();
      owner = parserTok();
      owner = parserSkipNl();
      owner = parserParseOutcomeBinding();
      owner = parserParseBlockExpected();
      owner = parserEnd(SyntaxKind.FinallyClause);
    } else if (!caught) {
      owner = parserMissing("`catch` or `finally`");
    }
    return parserEnd(SyntaxKind.TryExpr);
  }

  function parserParseOutcomeBinding(): Parser {
    if (parserKind() !== TokenKind.LParen) return owner;
    const group = parserOpen("free");
    owner = parserParseName("binding");
    owner = parserClose(group, TokenKind.RParen, "`)`");
    return parserSkipNl();
  }

  function parserParseHandler(): Parser {
    owner = parserBegin();
    owner = parserParseName("member");
    if (parserKind() === TokenKind.LParen) {
      const group = parserOpen("free");
      owner = parserParseName("binding");
      owner = parserClose(group, TokenKind.RParen, "`)`");
    } else {
      owner = parserMissing("`(`");
    }
    owner = parserExpectThenNl(TokenKind.Arrow, "`=>`");
    owner = parserParseBody();
    return parserEnd(SyntaxKind.Handler);
  }

  function parserIsLiteralKind(k: TokenKind | undefined): boolean {
    return k === TokenKind.String || k === TokenKind.Number ||
      k === TokenKind.KwTrue ||
      k === TokenKind.KwFalse || k === TokenKind.KwNull;
  }

  function parserInvalidPattern(message: string): Parser {
    return parserProblem("syntax/011", message, false);
  }

  function parserParseLiteralPattern(): Parser {
    owner = parserBegin();
    if (parserKind() === TokenKind.Minus) {
      owner = parserTok();
      const next = parserKind();
      if (
        next === TokenKind.Number &&
        !isDurationText(
          parserText.slice(parserStarts[parserPos], parserEnds[parserPos]),
        )
      ) {
        owner = parserTok();
      } else {
        owner = parserInvalidPattern(
          "a negative pattern must be a number literal, as in `-1` or `-1.5`",
        );
        if (next === TokenKind.Ident || parserIsLiteralKind(next)) {
          owner = parserTok();
        }
      }
    } else {
      owner = parserTok();
    }
    return parserEnd(SyntaxKind.LiteralPattern);
  }

  function parserParsePattern(): Parser {
    const k = parserKind();
    if (k === TokenKind.Ident) {
      owner = parserBegin();
      if (parserIsWordAt(parserPos, "_")) {
        owner = parserTok();
        owner = parserEnd(SyntaxKind.WildcardPattern);
      } else if (parserKinds[parserPos + 1] === TokenKind.LParen) {
        owner = parserParseName("member");
        const group = parserOpen("free");
        if (
          parserKind() === TokenKind.Ident &&
          parserKinds[parserPos + 1] === TokenKind.RParen
        ) {
          owner = parserParseName("binding");
        } else if (parserKind() !== TokenKind.RParen) {
          owner = parserInvalidPattern(
            "nested patterns are not supported; bind one name",
          );
          owner = parserSkipJunk((x) => x === TokenKind.RParen, "");
        } else {
          owner = parserMissing("a name");
        }
        owner = parserClose(group, TokenKind.RParen, "`)`");
        owner = parserEnd(SyntaxKind.CtorPattern);
      } else {
        owner = parserParseName("member");
        owner = parserEnd(SyntaxKind.NamePattern);
      }
    } else if (parserIsLiteralKind(k) || k === TokenKind.Minus) {
      owner = parserParseLiteralPattern();
    } else if (k === TokenKind.LBrace) {
      owner = parserBegin();
      owner = parserParseDelimited(
        TokenKind.RBrace,
        () => parserParsePatternField(),
      );
      owner = parserEnd(SyntaxKind.RecordPattern);
    } else {
      owner = parserInvalidPattern(
        `expected a pattern, found ${parserFoundDescription()}`,
      );
      owner = parserAppendMissing();
    }

    return owner;
  }

  function parserParsePatternField(): Parser {
    const k = parserKind();
    if (k === TokenKind.DotDotDot) {
      owner = parserBegin();
      owner = parserTok();
      owner = parserParseName("binding");
      owner = parserEnd(SyntaxKind.SpreadPattern);
    } else if (k === TokenKind.Ident) {
      owner = parserBegin();
      owner = parserParseName("member");
      owner = parserExpectThenNl(TokenKind.Colon, "`:`");
      if (
        parserIsLiteralKind(parserKind()) || parserKind() === TokenKind.Minus
      ) {
        owner = parserParseLiteralPattern();
      } else {
        owner = parserInvalidPattern(
          "a field in a record pattern must match a literal",
        );
        owner = parserSkipJunk(
          (x) => x === TokenKind.Comma || x === TokenKind.RBrace,
          "",
        );
      }
      owner = parserEnd(SyntaxKind.PatternField);
    } else {
      owner = parserInvalidPattern(
        `expected a field name or a spread, found ${parserFoundDescription()}`,
      );
      owner = parserAppendMissing();
    }

    return owner;
  }
  function parserGetDiagnostics(): readonly Diagnostic[] {
    return parserDiagnostics;
  }

  owner = { diagnostics: parserGetDiagnostics, run: parserRun };
  return owner;
}
