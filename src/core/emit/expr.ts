import {
  fieldKey,
  needsFieldAdapter,
  prototypeField,
  sensitiveField,
  taggedFields,
} from "./fields.ts";
// The expression scheme: `pure`, `asEffect`, the leaf and hoist rules, the control forms, and the parentheses
// around `yield*`.
import type {
  Arm,
  DefectHandler,
  Expr,
  Field,
  FunctionType,
  Handler,
  LocalId,
  Pattern,
  Step,
  Type,
  ValueId,
} from "../ir.ts";
import {
  isClosedUnitId,
  SCHEMA_ERROR_ID,
  SCHEMA_ISSUE_ID,
  TIMEOUT_ERROR_ID,
} from "../ir.ts";
import { defectMessage } from "./helper_declarations.ts";
import {
  alt,
  assignment,
  braces,
  bracketed,
  type Doc,
  fill,
  group,
  type GroupId,
  hard,
  hasHardLine,
  ifBreak,
  ifBroke,
  ifFits,
  indent,
  join,
  line,
  member,
  property,
  spanEnds,
  spanned,
  through,
} from "./doc.ts";
import { effectLeaf, effectStructural } from "./families/effect.ts";
import { layerLeaf, layerStructural } from "./families/layer.ts";
import { schemaLeaf, schemaStructural } from "./families/schema.ts";
import { scopeLeaf } from "./families/scope.ts";
import { streamStructural } from "./families/stream.ts";
import {
  at,
  callArguments,
  type Chain,
  type ChainHead,
  type ChainTail,
  type CondChain,
  type Emitted,
  emitted,
  flush,
  free,
  type Kid,
  type Mode,
  plainEmitted,
  PREC,
  type Run,
} from "./emitted.ts";
import { internal } from "./failure.ts";
import type { ExprScope, FieldHelperKey } from "./module_state.ts";
import { resolvedAs } from "./type_query.ts";
import { methodOfCapability, serviceOfCapability } from "./identity.ts";
import {
  bracketsBreak,
  channelTypeArguments,
  typeArguments,
  typeDoc,
} from "./types.ts";
import {
  type Callee,
  LEAF_CALLS,
  OPERAND_CALLS,
  type OperandCallKind,
  type Treatment,
  UPDATE_REF_EFFECT,
} from "./calls.ts";
import {
  evaluatedChildren,
  type ExprOf,
  isLeafExpr,
  isStableValue,
} from "./shape.ts";
import { patternBinding } from "./walk.ts";
import {
  asBuiltinInstanceName,
  builtinInstanceName,
  isLocalId,
  knownBuiltinInstanceName,
  shortName,
  tokenOfId,
} from "../ids.ts";
type PrimitiveLiteral =
  & Extract<Expr, {
    readonly kind: "literal";
  }>
  & {
    readonly value: string | number | boolean;
  };
/** A boolean, number, or string literal; a unit literal is excluded. */
function isPrimitiveLiteral(e: Expr): e is PrimitiveLiteral {
  return e.kind === "literal" && e.value !== null;
}
function binaryPrecedence(operator: string): number {
  if (operator === "||") return PREC.or;
  if (operator === "&&") return PREC.and;
  if (operator === "===" || operator === "!==") return PREC.equality;
  if (["<", "<=", ">", ">="].includes(operator)) return PREC.relational;
  if (operator === "+" || operator === "-") return PREC.additive;
  return PREC.multiplicative;
}
// ------------------------------------------------------------------ conditionals
/** The test of a conditional. `tail` is the depth of the lines after the first, if the test breaks. */
function testDoc(test: Emitted, tail: number): Doc {
  return test.run === undefined ? at(test, PREC.or) : runDoc(test.run, tail);
}
/** A test after the first test of a conditional chain. */
type LaterTest = {
  /** The whole test, with the span ends that belong to it. */
  readonly doc: Doc;
  /**
   * Present when the test is `left operator right`. `head` is the text up to
   * and including the operator. `right` is the last operand. The test is
   * `head`, a space, and `right` when it is on one line.
   */
  readonly split: {
    readonly head: Doc;
    readonly right: Doc;
  } | undefined;
};
/**
 * A pair prints at least `x ? y : `, 8 columns. So a joined line of 10 pairs
 * does not fit in 80 columns, and the printer tries no later test.
 */
const MAX_JOINED_PAIRS = 10;
/**
 * The conditional chain `first ? arms[0] : tests[0] ? arms[1] : ... : last`.
 * `deno fmt` prints every `?` and `:` of the chain at one indentation level.
 * When a test does not fit on its `: test` line, `deno fmt` joins the pairs
 * before the test and the left side of the test on the line of `first`, if
 * that line fits. Then the right side of the test sits two levels deeper than
 * the chain. It joins at most one test, and not after a pair with a hard line.
 */
function conditionalChain(
  first: Doc,
  tests: readonly LaterTest[],
  arms: readonly Doc[],
  last: Doc,
): Doc {
  const broken: Doc = [
    first,
    indent([
      line,
      "? ",
      arms[0],
      ...tests.flatMap((test, i) => [
        line,
        ": ",
        test.doc,
        line,
        "? ",
        arms[i + 1],
      ]),
      line,
      ": ",
      last,
    ]),
  ];
  const reach = Math.min(tests.length, MAX_JOINED_PAIRS);
  if (reach === 0) {
    return group(broken, undefined, undefined);
  }
  // `options[k - 1]` is the layout where `tests[k - 1]` joins the first line.
  // The joined line holds the pairs before it, so it is `prefix` and the left
  // side. A hard line in `prefix` blocks the join.
  let prefix: Doc = [first, " ? ", arms[0], " : "];
  let blocked = hasHardLine(first) || hasHardLine(arms[0]);
  const options: Doc[] = [];
  for (const optionIndex of tests.slice(0, reach).keys()) {
    const k = optionIndex + 1;
    const test = tests[k - 1];
    const split = test.split;
    if (split === undefined || blocked) {
      options[options.length] = broken;
    } else {
      const rest: Doc[] = ["? ", arms[k]];
      for (const j of tests.keys()) {
        if (j < k) continue;
        for (
          const part of [
            hard,
            ": ",
            tests[j].doc,
            hard,
            "? ",
            arms[j + 1],
          ]
        ) rest[rest.length] = part;
      }
      for (const part of [hard, ": ", last]) rest[rest.length] = part;
      options[options.length] = alt([
        [
          prefix,
          split.head,
          indent(indent([hard, split.right])),
          group(indent([hard, ...rest]), undefined, undefined),
        ],
        broken,
      ]);
    }
    blocked = blocked || hasHardLine(test.doc) || hasHardLine(arms[k]);
    prefix = [prefix, test.doc, " ? ", arms[k], " : "];
  }
  let decision: Doc = broken;
  for (const reverseIndex of options.keys()) {
    const k = reach - reverseIndex;
    // Check A: the line `: test` of the broken layout is wider than the page.
    const probe: Doc = indent([through, ": ", tests[k - 1].doc]);
    decision = ifFits(probe, decision, options[k - 1]);
  }
  return group(ifBreak(decision, broken), undefined, undefined);
}
function isComparisonOperator(operator: string): boolean {
  return operator === "===" || operator === "!==" || operator === "<" ||
    operator === "<=" || operator === ">" || operator === ">=";
}
/** True when the run is one comparison of two operands, such as `a === b`. */
function isComparison(run: Run | undefined): run is Run {
  return run !== undefined && run.operands.length === 2 &&
    isComparisonOperator(run.operators[0]);
}
/** A test of a conditional after the first. A comparison of two operands can split. */
function laterTest(test: Emitted, open: Doc): LaterTest {
  const doc: Doc = [open, testDoc(test, 2)];
  const run = test.run;
  if (!isComparison(run)) {
    return { doc: doc, split: undefined };
  }
  const operator = run.operators[0];
  const ends = run.top === undefined ? undefined : spanEnds(run.top);
  return {
    doc: doc,
    split: {
      head: [open, ends?.open ?? "", run.operands[0], ` ${operator}`],
      right: [run.operands[1], ends?.close ?? ""],
    },
  };
}
function condDoc(chain: CondChain, tail: number): Doc {
  const ends = chain.nested.map(spanEnds);
  const tests = chain.tests.slice(1).map((test, i) =>
    laterTest(test, ends[i].open)
  );
  const closes = ends.map((e) => e.close).reverse();
  return conditionalChain(testDoc(chain.tests[0], tail), tests, chain.arms, [
    chain.last,
    ...closes,
  ]);
}
// ------------------------------------------------------------------ binary runs
/** The doc of a run. `tail` is the indentation depth of the lines after the first. */
function runDoc(run: Run, tail: number): Doc {
  const ends = run.inner.map(spanEnds);
  const last = run.operands.length - 1;
  const parts: Doc[] = [];
  for (const operandEntry of run.operands.entries()) {
    const k = operandEntry[0];
    const operand = operandEntry[1];
    if (k > 0) {
      parts[parts.length] = line;
    }
    const chunk: Doc[] = [];
    if (k === 0) {
      for (const end of [...ends].reverse()) {
        chunk[chunk.length] = end.open;
      }
    }
    chunk[chunk.length] = operand;
    if (k >= 1 && k - 1 < ends.length) {
      chunk[chunk.length] = ends[k - 1].close;
    }
    if (k < last) {
      chunk[chunk.length] = ` ${run.operators[k]}`;
    }
    parts[parts.length] = chunk;
  }
  const filled = fill(parts, tail);
  return run.top === undefined ? filled : spanned(run.top, filled);
}
/**
 * The arrows `heads[i..]` followed by `last` after the final `=>`. Each arrow
 * carries its span. `separator` comes after each `=>` that is not the last.
 */
function nestHeads(
  heads: readonly ChainHead[],
  last: Doc,
  separator: Doc | undefined,
  i: number | undefined,
): Doc {
  const resolvedSeparator = separator ?? " ";
  const resolvedIndex = i ?? 0;
  const head = heads[resolvedIndex];
  const inner: Doc = resolvedIndex === heads.length - 1
    ? [head.doc, " =>", last]
    : [
      head.doc,
      " =>",
      resolvedSeparator,
      nestHeads(heads, last, resolvedSeparator, resolvedIndex + 1),
    ];
  return head.span === undefined ? inner : spanned(head.span, inner);
}
/**
 * The layouts of an arrow chain. `deno fmt` keeps a chain on one line when it
 * fits. Otherwise it keeps all heads on the first line and moves the body
 * down. When the heads do not fit after `const name =`, it moves the whole
 * chain below the `=`. When the heads do not fit on one line, each head gets
 * a line of its own at the indentation of the chain, after the first. A head
 * whose parameter list does not fit on its line breaks the list.
 */
type ChainOptions =
  & {
    readonly oneLine: Doc;
    /** One head for each line, the body after the last head. */
    readonly split: (separator: Doc) => Doc;
    /** One head for each line, the body on the last line when it fits, else below it. */
    readonly splitAdaptive: (separator: Doc) => Doc;
  }
  & ({
    /** Heads on the first line and the body below. */
    readonly bodyDown: Doc;
    /** One head for each line, the body below the last head. */
    readonly splitDown: (separator: Doc) => Doc;
    readonly broken: undefined;
  } | {
    /** A block or object body has no body-down layout. */
    readonly bodyDown: undefined;
    readonly splitDown: undefined;
    /** `split` with the object body of a brace body broken. Absent for a block. */
    readonly broken: ((separator: Doc) => Doc) | undefined;
  });
function chainOptions(chain: Chain): ChainOptions {
  const heads = chain.heads;
  const tail = chain.tail;
  if (tail.kind === "block" || tail.body.brace) {
    const last: Doc = tail.kind === "block"
      ? [" ", braces(tail.statements)]
      : [" (", tail.body.doc, ")"];
    return {
      oneLine: nestHeads(heads, last, undefined, undefined),
      bodyDown: undefined,
      split: (separator) => nestHeads(heads, last, separator, undefined),
      splitDown: undefined,
      splitAdaptive: (separator) =>
        nestHeads(heads, last, separator, undefined),
      broken: tail.kind === "block" ? undefined : (separator) =>
        nestHeads(
          heads,
          [" (", group(tail.body.doc, true, undefined), ")"],
          separator,
          undefined,
        ),
    };
  }
  const body = tail.body;
  const down: Doc = indent([hard, flush(body)]);
  return {
    oneLine: nestHeads(heads, [" ", body.doc], undefined, undefined),
    bodyDown: nestHeads(heads, down, undefined, undefined),
    split: (separator) =>
      nestHeads(heads, [" ", body.doc], separator, undefined),
    splitDown: (separator) => nestHeads(heads, down, separator, undefined),
    splitAdaptive: (separator) =>
      nestHeads(
        heads,
        group(indent([line, flush(body)]), undefined, undefined),
        separator,
        undefined,
      ),
    broken: undefined,
  };
}
/** A chain of arrows that is not a declaration: on a line, body down, or one head for each line. */
function chainDocOf(chain: Chain): Doc {
  const options = chainOptions(chain);
  const split = options.splitAdaptive(hard);
  if (options.bodyDown === undefined) {
    // An object body breaks inside its braces, so the heads stay on one line
    // when only the object is too long. The printer measures a middle option
    // flat, so this option holds the object broken.
    const broken = options.broken;
    if (broken === undefined) {
      return alt([options.oneLine, split]);
    }
    return alt([options.oneLine, broken(" "), split]);
  }
  return alt([options.oneLine, options.bodyDown, split]);
}
/**
 * `const name = <chain>`. A chain that does not fit moves below the `=`. When
 * some head does not fit there, each head gets a line of its own. When the
 * prefix fits on its line, each layout holds it, so a type annotation in the
 * prefix is measured with the layout. A longer prefix breaks first.
 */
function chainDeclaration(prefix: Doc, chain: Chain): Doc {
  const options = chainOptions(chain);
  return ifFits(
    [prefix, " ="],
    chainLayouts(options, (layout) => [prefix, " =", layout]),
    [
      prefix,
      " =",
      chainLayouts(options, (layout) => layout),
    ],
  );
}
/** The layouts of `chainDeclaration`, each wrapped by `declare`. */
function chainLayouts(
  options: ChainOptions,
  declare: (layout: Doc) => Doc,
): Doc {
  if (options.bodyDown === undefined) {
    // A block or an object body. The object breaks inside its braces when the
    // line is too long, so a flat measure of the whole chain would reject a
    // layout that `deno fmt` keeps. Each layout is tried with the object on
    // the line, then broken.
    const broken = options.broken;
    const layouts: Doc[] = [[" ", options.oneLine]];
    if (broken !== undefined) {
      layouts[layouts.length] = [" ", broken(" ")];
    }
    layouts[layouts.length] = indent([through, options.oneLine]);
    if (broken !== undefined) {
      layouts[layouts.length] = indent([through, broken(" ")]);
    }
    layouts[layouts.length] = indent([through, options.split(through)]);
    if (broken !== undefined) {
      layouts[layouts.length] = indent([through, broken(through)]);
    }
    return layouts.reduceRight<Doc>(
      (otherwise, layout) =>
        ifFits(declare(layout), declare(layout), otherwise),
      declare([" ", options.splitAdaptive(hard)]),
    );
  }
  const choices: Doc[] = [
    [" ", options.oneLine],
    [" ", options.bodyDown],
    indent([through, options.oneLine]),
    indent([through, options.bodyDown]),
    indent([through, options.split(through)]),
    indent([through, options.splitDown(through)]),
    [" ", options.splitAdaptive(hard)],
  ];
  return alt(choices.map(declare));
}
/** True when the doc that `at(e, min)` prints starts with `{`. */
function leadingBrace(e: Emitted, min: number): boolean {
  return e.prec >= min && e.brace;
}
/** `left === right`. When it does not fit, `right` moves down two levels, as `deno fmt` prints it. */
function equality(left: string, right: Doc): Doc {
  return group(
    [left, " ===", indent(indent([line, right]))],
    undefined,
    undefined,
  );
}
/** The test of a match arm, including a comparison's optional split. */
type ArmTest = LaterTest & { readonly first: Doc | undefined };
function armEquality(left: string, right: Doc): ArmTest {
  return {
    doc: equality(left, right),
    split: { head: [left, " ==="], right: right },
    first: undefined,
  };
}
function guardedArmEquality(
  guard: string,
  left: string,
  right: Doc,
  tail: number,
): Doc {
  let rest: Doc = [
    hard,
    group([left, " ===", indent([line, right])], undefined, undefined),
  ];
  for (const _level of [1, 2].slice(0, tail)) rest = indent(rest);
  return alt([[guard, " ", equality(left, right)], [guard, rest]]);
}
/** The `_tag` value of an error: the Effect SchemaError class has a fixed tag. */
function errorTag(id: string): string {
  if (id === SCHEMA_ERROR_ID || id === TIMEOUT_ERROR_ID) {
    return shortName(id);
  }
  return tokenOfId(id);
}
function isIntType(type: Type): boolean {
  return type.kind === "primitive" && type.name === "int";
}
export type ExprEmitter = {
  readonly scope: ExprScope;
  readonly pure: (e: Expr, expected: Type | undefined) => Emitted;
  readonly asEffect: (e: Expr, expected: Type | undefined) => Emitted;
  readonly blockStatements: (
    block: Extract<Expr, {
      kind: "block";
    }>,
    gen: boolean,
    expected: Type | undefined,
  ) => Doc[];
  readonly arrow: (
    parameters: Doc,
    body: Emitted,
    bodyGroup: GroupId | undefined,
  ) => Doc;
  readonly arrowBlock: (parameters: Doc, statements: readonly Doc[]) => Doc;
  readonly arrowDeclaration: (
    prefix: Doc,
    parameters: Doc,
    body: Emitted,
  ) => Doc;
  readonly functionTypeOf: (type: Type) => FunctionType | undefined;
  readonly fit: (e: Expr, expected: Type | undefined, mode: Mode) => Emitted;
  readonly adaptedInput: (
    input: Emitted,
    type: Type,
    direction: "decoded" | "encoded" | "make",
  ) => Emitted;
  readonly objectLiteral: (
    fields: readonly Doc[],
    spreads: readonly Doc[],
  ) => Emitted;
  readonly closure: (
    e: Extract<Expr, {
      kind: "closure";
    }>,
    annotate: boolean,
    forceEffect: boolean | undefined,
  ) => Emitted;
  readonly effectCallback: (arg: Expr) => Emitted;
  readonly suspended: (job: Expr, hoisted: Emitted | undefined) => Emitted;
};
export function ExprEmitter(scope: ExprScope): ExprEmitter {
  const exprEmitterScope = scope;
  function exprEmitterIsEffectfulFunction(type: Type): boolean {
    const resolved = exprEmitterScope.resolve(type);
    return resolved.kind === "function" && resolved.execution === "effect";
  }
  function exprEmitterPure(e: Expr, expected: Type | undefined): Emitted {
    if (e.execution !== "pure") {
      return internal(`pure() received an effect-mode ${e.kind} node`);
    }
    return exprEmitterTag(e, exprEmitterStructural(e, "pure", expected));
  }
  function exprEmitterInGen(e: Expr, expected: Type | undefined): Emitted {
    if (e.execution === "pure") {
      return exprEmitterPure(e, expected);
    }
    return exprEmitterTag(
      e,
      exprEmitterIsLeaf(e)
        ? exprEmitterLeafEffect(e, true)
        : exprEmitterStructural(e, "gen", expected),
    );
  }
  function exprEmitterAsEffect(e: Expr, expected: Type | undefined): Emitted {
    return exprEmitterTag(e, exprEmitterEffectNode(e, expected));
  }
  function exprEmitterBlockStatements(
    block: Extract<Expr, {
      kind: "block";
    }>,
    gen: boolean,
    expected: Type | undefined,
  ): Doc[] {
    const mode: Mode = gen ? "gen" : "pure";
    const statements: Doc[] = [];
    for (const step of block.steps) {
      statements[statements.length] = exprEmitterStep(step, mode);
    }
    statements[statements.length] = exprEmitterReturnStatement(
      block.result,
      exprEmitterSlotOf(expected, block.type),
      mode,
    );
    return statements;
  }
  function exprEmitterReturnStatement(
    result: Expr,
    expected: Type | undefined,
    mode: Mode,
  ): Doc {
    return ["return ", free(exprEmitterFit(result, expected, mode)), ";"];
  }
  function exprEmitterGenCall(statements: readonly Doc[]): Emitted {
    const effect = exprEmitterScope.effect("Effect");
    return plainEmitted([
      `${effect}.gen(function* () `,
      braces(statements),
      ")",
    ]);
  }
  function exprEmitterArrow(
    parameters: Doc,
    body: Emitted,
    bodyGroup: GroupId | undefined,
  ): Doc {
    if (body.chain !== undefined) {
      return chainDocOf(
        exprEmitterChainOf(parameters, { kind: "expr", body: body }),
      );
    }
    // An object literal body stays on the line of the arrow: `=> ({`.
    if (body.brace) {
      return [parameters, " => (", body.doc, ")"];
    }
    // So does an array or tuple literal body: `=> [`.
    if (body.bracket) {
      return [parameters, " => ", body.doc];
    }
    return [
      parameters,
      " =>",
      group(indent([line, flush(body)]), false, bodyGroup),
    ];
  }
  function exprEmitterArrowBlock(
    parameters: Doc,
    statements: readonly Doc[],
  ): Doc {
    return [parameters, " => ", braces(statements)];
  }
  function exprEmitterChainOf(parameters: Doc, tail: ChainTail): Chain {
    const head: ChainHead = { doc: parameters, span: undefined };
    if (tail.kind === "expr" && tail.body.chain !== undefined) {
      return {
        heads: [head, ...tail.body.chain.heads],
        tail: tail.body.chain.tail,
      };
    }
    return { heads: [head], tail: tail };
  }
  function exprEmitterArrowEmitted(parameters: Doc, tail: ChainTail): Emitted {
    const chain = exprEmitterChainOf(parameters, tail);
    const bodyGroup: GroupId = {};
    const single = chain.heads.length === 1 && tail.kind === "expr" &&
      !tail.body.brace;
    let doc: Doc;
    if (chain.heads.length > 1) {
      doc = chainDocOf(chain);
    } else if (tail.kind === "block") {
      doc = exprEmitterArrowBlock(parameters, tail.statements);
    } else {
      doc = exprEmitterArrow(parameters, tail.body, bodyGroup);
    }
    const options = single
      ? { huggable: true, chain: chain, bodyGroup: bodyGroup }
      : { huggable: true, chain: chain };
    return emitted(doc, PREC.yield, options);
  }
  function exprEmitterArrowDeclaration(
    prefix: Doc,
    parameters: Doc,
    body: Emitted,
  ): Doc {
    if (body.chain === undefined) {
      return assignment(
        prefix,
        exprEmitterArrow(parameters, body, undefined),
        undefined,
      );
    }
    return chainDeclaration(
      prefix,
      exprEmitterChainOf(parameters, { kind: "expr", body: body }),
    );
  }
  function exprEmitterTag(e: Expr, result: Emitted): Emitted {
    if (result.run !== undefined) {
      const run: Run = { ...result.run, top: e.span };
      return {
        ...result,
        run: run,
        doc: runDoc(run, 1),
        flush: runDoc(run, 0),
      };
    }
    const doc = spanned(e.span, result.doc);
    const taggedFlush = result.flush === undefined
      ? undefined
      : spanned(e.span, result.flush);
    if (result.condChain !== undefined) {
      const condChain: CondChain = { ...result.condChain, self: e.span };
      return taggedFlush === undefined
        ? { ...result, doc: doc, condChain: condChain }
        : { ...result, flush: taggedFlush, doc: doc, condChain: condChain };
    }
    if (result.chain === undefined) {
      return taggedFlush === undefined
        ? { ...result, doc: doc }
        : { ...result, flush: taggedFlush, doc: doc };
    }
    const first = result.chain.heads[0];
    const rest = result.chain.heads.slice(1);
    const chain: Chain = {
      heads: [{ doc: first.doc, span: e.span }, ...rest],
      tail: result.chain.tail,
    };
    return taggedFlush === undefined
      ? { ...result, doc: doc, chain: chain }
      : { ...result, flush: taggedFlush, doc: doc, chain: chain };
  }
  function exprEmitterKid(mode: Mode): Kid {
    return (e, expected) => exprEmitterFit(e, expected, mode);
  }
  function exprEmitterFunctionTypeOf(type: Type): FunctionType | undefined {
    const resolved = exprEmitterScope.resolve(type);
    return resolved.kind === "function" ? resolved : undefined;
  }
  function exprEmitterSlotOf(expected: Type | undefined, own: Type): Type {
    return expected !== undefined &&
        exprEmitterFunctionTypeOf(expected) !== undefined
      ? expected
      : own;
  }
  function exprEmitterLiftedFrom(
    e: Expr,
    expected: Type | undefined,
  ): FunctionType | undefined {
    if (expected === undefined) {
      return undefined;
    }
    const from = exprEmitterFunctionTypeOf(e.type);
    const to = exprEmitterFunctionTypeOf(expected);
    return from !== undefined && to !== undefined &&
        from.execution === "pure" && to.execution === "effect"
      ? from
      : undefined;
  }
  function exprEmitterFit(
    e: Expr,
    expected: Type | undefined,
    mode: Mode,
  ): Emitted {
    const from = exprEmitterLiftedFrom(e, expected);
    if (from === undefined) {
      return mode === "gen"
        ? exprEmitterInGen(e, expected)
        : exprEmitterPure(e, expected);
    }
    if (e.execution !== "pure") {
      const plain = mode === "gen"
        ? exprEmitterInGen(e, expected)
        : exprEmitterPure(e, undefined);
      if (e.kind === "block" || e.kind === "if" || e.kind === "match") {
        return plain;
      }
      return exprEmitterBindLifted(from, plain);
    }
    const plain = mode === "gen"
      ? exprEmitterInGen(e, undefined)
      : exprEmitterPure(e, undefined);
    if (e.kind === "closure") {
      return exprEmitterTag(e, exprEmitterClosure(e, true, true));
    }
    if (isStableValue(e)) {
      return exprEmitterLift(from, at(plain, PREC.member));
    }
    return exprEmitterBindLifted(from, plain);
  }
  function exprEmitterBindLifted(from: FunctionType, plain: Emitted): Emitted {
    const bound = exprEmitterScope.temp();
    const lifted = exprEmitterLift(from, bound);
    return emitted(
      [
        "(",
        exprEmitterArrow(`(${bound})`, lifted, undefined),
        ")",
        callArguments([plain]),
      ],
      PREC.member,
      undefined,
    );
  }
  function exprEmitterLift(from: FunctionType, callee: Doc): Emitted {
    const names = from.parameters.map(() => exprEmitterScope.temp());
    const parameters = bracketed(
      "(",
      ")",
      names.map((
        n,
        i,
      ) => [n, ": ", typeDoc(exprEmitterScope, from.parameters[i], undefined)]),
      false,
    );
    const effect = exprEmitterScope.effect("Effect");
    const call = plainEmitted([callee, "(", join(", ", names), ")"]);
    const body = plainEmitted([`${effect}.succeed`, callArguments([call])]);
    return exprEmitterArrowEmitted(parameters, { kind: "expr", body: body });
  }
  function exprEmitterStructural(
    e: Expr,
    mode: Mode,
    expected: Type | undefined,
  ): Emitted {
    if (isLeafExpr(e)) {
      return internal(`${e.kind} node in a structural position`);
    }
    const kid = exprEmitterKid(mode);
    if (e.kind === "null") {
      return plainEmitted("null");
    }
    if (e.kind === "literal") {
      // TypeScript widens a literal that a generated function returns, such
      // as a match arm or an `Effect.gen` body, unless it is `as const`.
      return expected !== undefined && e.value !== null &&
          exprEmitterAdmitsLiteral(expected)
        ? emitted(
          [exprEmitterLiteral(e.value), " as const"],
          PREC.relational,
          undefined,
        )
        : plainEmitted(exprEmitterLiteral(e.value));
    }
    if (e.kind === "reference") {
      return plainEmitted(exprEmitterReference(e.target));
    }
    if (e.kind === "record") {
      const shape = expected ?? e.type;
      const object = exprEmitterObjectLiteral(
        e.fields.map((f) =>
          exprEmitterField(
            f.name,
            f.value,
            kid,
            exprEmitterFieldType(expected ?? e.type, f.name),
          )
        ),
        [],
      );
      return exprEmitterSafeRecord(object, shape);
    }
    if (e.kind === "array" || e.kind === "tuple") {
      return emitted(
        bracketed(
          "[",
          "]",
          e.elements.map((x, i) =>
            flush(kid(x, exprEmitterElementType(expected ?? e.type, i)))
          ),
          false,
        ),
        PREC.member,
        { huggable: true, bracket: true },
      );
    }
    if (e.kind === "get") {
      return exprEmitterGetField(e, kid);
    }
    if (e.kind === "update") {
      const base = kid(e.record, undefined);
      const spread: Doc = ["...", at(base, PREC.member)];
      return exprEmitterSafeRecord(
        exprEmitterObjectLiteral(
          e.fields.map((f) =>
            exprEmitterField(
              f.name,
              f.value,
              kid,
              exprEmitterFieldType(e.type, f.name),
            )
          ),
          [spread],
        ),
        expected ?? e.type,
      );
    }
    if (e.kind === "nominal") {
      // A `Duration` or an `Instant` erases to its millisecond value.
      if (isClosedUnitId(e.nominal)) {
        return kid(e.value, undefined);
      }
      const declaration = exprEmitterScope.typeLevelDeclaration(e.nominal);
      // An untagged non-record nominal type is erased: its value is the base value.
      if (
        declaration?.kind === "type" &&
        declaration.definition.kind === "alias"
      ) {
        return kid(e.value, undefined);
      }
      const fields = declaration?.kind === "type"
        ? taggedFields(declaration)
        : undefined;
      const record: Type | undefined = fields === undefined
        ? undefined
        : { kind: "record", fields: fields };
      // A widened record value keeps its `_tag`, which `make` rejects. A
      // record literal has none. Every other argument gets the copy.
      const argument = record !== undefined && e.value.kind !== "record"
        ? plainEmitted([
          exprEmitterScope.fieldHelper("untagged"),
          "<",
          typeDoc(exprEmitterScope, record, undefined),
          ">",
          callArguments([kid(e.value, undefined)]),
        ])
        : kid(e.value, undefined);
      // `make` reads a missing optional field through the prototype chain,
      // so a nested data value with such a field needs a copy without one.
      const value = fields?.some((f) =>
          needsFieldAdapter(exprEmitterScope, f.type)
        )
        ? exprEmitterAdaptedInput(argument, {
          kind: "record",
          fields: fields,
        }, "make")
        : argument;
      return plainEmitted(member(
        exprEmitterScope.nameOf(e.nominal),
        "make",
        callArguments([value]),
      ));
    }
    if (e.kind === "some") {
      const option = exprEmitterScope.effect("Option");
      const resolved = resolvedAs(
        exprEmitterScope,
        e.type,
        "option",
        "a Some expression has a non-option type",
      );
      // Keep the checked context through generic wrappers and lifted callbacks.
      // Inferring `some` can widen tuple payloads and record discriminants.
      return plainEmitted([
        `${option}.some<`,
        typeDoc(exprEmitterScope, resolved.element, undefined),
        ">",
        callArguments([kid(e.value, resolved.element)]),
      ]);
    }
    if (e.kind === "none") {
      const option = exprEmitterScope.effect("Option");
      return plainEmitted(`${option}.none()`);
    }
    if (e.kind === "error") {
      const declaration = exprEmitterScope.typeLevelDeclaration(e.error);
      const shape: Type | undefined = declaration?.kind === "error"
        ? { kind: "record", fields: declaration.fields }
        : undefined;
      const object = exprEmitterObjectLiteral(
        e.fields.map((f) =>
          exprEmitterField(
            f.name,
            f.value,
            kid,
            declaration?.kind === "error"
              ? declaration.fields.find((g) => g.name === f.name)?.type
              : undefined,
          )
        ),
        [],
      );
      return plainEmitted([
        "new ",
        exprEmitterScope.nameOf(e.error),
        callArguments([
          shape === undefined ? object : exprEmitterSafeRecord(object, shape),
        ]),
      ]);
    }
    if (e.kind === "closure") {
      return exprEmitterClosure(e, true, undefined);
    }
    if (
      e.kind === "defer" || e.kind === "retry-schedule" || e.kind === "race-all"
    ) {
      return effectStructural(exprEmitterSelf, e, kid, mode);
    }
    if (
      e.kind === "unfold" || e.kind === "map-effect" ||
      e.kind === "take-sink" || e.kind === "transduce-stream" ||
      e.kind === "buffer-stream"
    ) {
      return streamStructural(exprEmitterSelf, e, kid);
    }
    if (e.kind === "layer") {
      return layerStructural(exprEmitterSelf, e);
    }
    if (e.kind === "schema") {
      return schemaStructural(exprEmitterSelf, e, kid);
    }
    if (e.kind === "call") {
      return exprEmitterNonLeafCall(e, kid);
    }
    if (e.kind === "block") {
      return exprEmitterNestedBlock(e, mode, expected);
    }
    if (e.kind === "if") {
      return exprEmitterConditional(e, kid, expected);
    }
    if (e.kind === "match") {
      return exprEmitterMatch(e, expected);
    }
    if (e.kind === "binary") {
      return exprEmitterBinary(e, kid);
    }
    // The remaining kinds print as a simple call. A kind that has neither
    // a case above nor a row in OPERAND_CALLS fails to compile here.
    return exprEmitterOperandCall(e.kind, e, kid);
  }
  function exprEmitterOperandCall<K extends OperandCallKind>(
    kind: K,
    e: ExprOf<K>,
    kid: Kid,
  ): Emitted {
    const row = OPERAND_CALLS[kind];
    const callee = exprEmitterCalleeText(row.callee);
    const operands = row.operands(e).map((operand) =>
      exprEmitterOperand(operand[0], operand[1], kid)
    );
    return plainEmitted([callee, callArguments(operands)]);
  }
  function exprEmitterOperand(
    e: Expr,
    treatment: Treatment,
    kid: Kid,
  ): Emitted {
    if (treatment === "value") return kid(e, undefined);
    if (treatment === "callback") return exprEmitterCallback(e, kid);
    return exprEmitterEffectCallback(e);
  }
  function exprEmitterCalleeText(callee: Callee): string {
    return `${exprEmitterScope.effect(callee.module)}.${callee.method}`;
  }
  function exprEmitterAdmitsLiteral(type: Type): boolean {
    const resolved = exprEmitterScope.resolve(type);
    return resolved.kind === "literal" ||
      (resolved.kind === "union" &&
        resolved.members.some((m) => exprEmitterAdmitsLiteral(m)));
  }
  function exprEmitterNarrowsOnDeclaration(type: Type): boolean {
    const resolved = exprEmitterScope.resolve(type);
    return resolved.kind === "union" ||
      (resolved.kind === "primitive" && resolved.name === "boolean");
  }
  function exprEmitterLiteral(value: string | number | boolean | null): Doc {
    if (value === null) {
      return "undefined";
    }
    if (typeof value === "string") {
      return JSON.stringify(value);
    }
    return String(value);
  }
  function exprEmitterReference(target: LocalId | ValueId): Doc {
    if (isLocalId(target)) {
      const name = exprEmitterScope.locals.get(target);
      if (name === undefined) {
        return internal(`unbound local ${target}`);
      }
      return name;
    }
    const host = exprEmitterScope.hostBinding(target);
    if (host !== undefined) {
      return host.hostName;
    }
    if (builtinInstanceName(target) !== undefined) {
      return internal(`the builtin ${target} is not in callee position`);
    }
    return exprEmitterScope.nameOf(target);
  }
  function exprEmitterField(
    name: string,
    value: Expr,
    kid: Kid,
    expected: Type | undefined,
  ): Doc {
    if (
      value.kind === "reference" && isLocalId(value.target) &&
      exprEmitterScope.locals.get(value.target) === name
    ) {
      return name === "__proto__" ? property(fieldKey(name), name) : name;
    }
    return property(fieldKey(name), free(kid(value, expected)));
  }
  function exprEmitterElementType(type: Type, index: number): Type | undefined {
    const resolved = exprEmitterScope.resolve(type);
    if (resolved.kind === "array") {
      return resolved.element;
    }
    return resolved.kind === "tuple" ? resolved.elements[index] : undefined;
  }
  function exprEmitterFieldType(type: Type, name: string): Type | undefined {
    return exprEmitterRecordFieldsOf(type)?.find((f) => f.name === name)?.type;
  }
  function exprEmitterRecordFieldsOf(type: Type): readonly Field[] | undefined {
    const resolved = exprEmitterScope.resolve(type);
    if (resolved.kind === "record") {
      return resolved.fields;
    }
    if (resolved.kind !== "named") {
      return undefined;
    }
    const declaration = exprEmitterScope.typeLevelDeclaration(resolved.id);
    return declaration?.kind === "type" ? taggedFields(declaration) : undefined;
  }
  function exprEmitterSafeRecord(object: Emitted, type: Type): Emitted {
    if (!exprEmitterRecordFieldsOf(type)?.some((f) => prototypeField(f.name))) {
      return object;
    }
    return exprEmitterHelperCall("record", type, [object]);
  }
  function exprEmitterHelperCall(
    key: FieldHelperKey,
    type: Type,
    args: readonly Emitted[],
  ): Emitted {
    return plainEmitted([
      exprEmitterScope.fieldHelper(key),
      "<",
      typeDoc(exprEmitterScope, type, undefined),
      ">",
      callArguments(args),
    ]);
  }
  function exprEmitterAdaptedInput(
    input: Emitted,
    type: Type,
    direction: "decoded" | "encoded" | "make",
  ): Emitted {
    if (!needsFieldAdapter(exprEmitterScope, type)) {
      return input;
    }
    const adapter = exprEmitterScope.fieldAdapter(type, direction);
    return direction === "encoded"
      ? plainEmitted([adapter, callArguments([input])])
      : exprEmitterHelperCall("record", type, [
        input,
        plainEmitted(adapter),
      ]);
  }
  function exprEmitterObjectLiteral(
    fields: readonly Doc[],
    spreads: readonly Doc[],
  ): Emitted {
    const items = [...spreads, ...fields];
    if (items.length === 0) {
      return emitted("{}", PREC.member, { brace: true, huggable: true });
    }
    return emitted(bracketed("{", "}", items, true), PREC.member, {
      brace: true,
      huggable: true,
    });
  }
  function exprEmitterGetField(
    e: Extract<Expr, {
      kind: "get";
    }>,
    kid: Kid,
  ): Emitted {
    const record = kid(e.record, undefined);
    const access = member(at(record, PREC.member), e.field, undefined);
    if (exprEmitterIsOptionalField(e.record.type, e.field, undefined)) {
      const option = exprEmitterScope.effect("Option");
      if (!sensitiveField(e.field)) {
        return plainEmitted([
          `${option}.fromUndefinedOr`,
          callArguments([emitted(access, undefined, undefined)]),
        ]);
      }
      const resultType = resolvedAs(
        exprEmitterScope,
        e.type,
        "option",
        "optional read has a non-option type",
      );
      return exprEmitterHelperCall("optionalField", resultType.element, [
        record,
        plainEmitted(JSON.stringify(e.field)),
      ]);
    }
    return emitted(access, PREC.member, {
      brace: leadingBrace(record, PREC.member),
    });
  }
  function exprEmitterIsOptionalField(
    type: Type,
    field: string,
    depth: number | undefined,
  ): boolean {
    const resolvedDepth = depth ?? 0;
    if (resolvedDepth >= 64) {
      return false;
    }
    const resolved = exprEmitterScope.resolve(type);
    if (resolved.kind === "union") {
      return resolved.members.some((member) =>
        exprEmitterIsOptionalField(member, field, resolvedDepth + 1)
      );
    }
    if (resolved.kind === "named") {
      const declaration = exprEmitterScope.typeLevelDeclaration(resolved.id);
      if (declaration?.kind === "error") {
        return declaration.fields.some((f) => f.name === field && f.optional);
      }
    }
    return exprEmitterRecordFieldsOf(resolved)?.some((f) =>
      f.name === field && f.optional
    ) ?? false;
  }
  function exprEmitterBinary(
    e: Extract<Expr, {
      kind: "binary";
    }>,
    kid: Kid,
  ): Emitted {
    const isInt = isIntType(exprEmitterScope.resolve(e.type));
    // An `int` remainder never joins a run of `*`: the helper call is an operand.
    if (e.operator === "%" && isInt) {
      return plainEmitted([
        exprEmitterScope.remainder(),
        callArguments([kid(e.left, undefined), kid(e.right, undefined)]),
      ]);
    }
    const prec = binaryPrecedence(e.operator);
    // TypeScript rejects a comparison of two literals with no overlap (TS2367),
    // so the left literal widens to its primitive type.
    const widen = (e.operator === "===" || e.operator === "!==") &&
      isPrimitiveLiteral(e.right);
    const left = widen && isPrimitiveLiteral(e.left)
      ? plainEmitted([
        "(",
        exprEmitterLiteral(e.left.value),
        " as ",
        typeof e.left.value,
        ")",
      ])
      : kid(e.left, undefined);
    const right = at(kid(e.right, undefined), prec + 1);
    // A left operand of the same level joins the run; `at` adds no parentheses.
    const run: Run = left.run !== undefined && left.prec === prec &&
        left.run.top !== undefined
      ? {
        operands: [...left.run.operands, right],
        operators: [...left.run.operators, e.operator],
        inner: [...left.run.inner, left.run.top],
        top: undefined,
      }
      : {
        operands: [at(left, prec), right],
        operators: [e.operator],
        inner: [],
        top: undefined,
      };
    const arithmetic = e.operator === "+" || e.operator === "-" ||
      e.operator === "*";
    if (arithmetic && isInt) {
      return exprEmitterIntCall(emitted(runDoc(run, 1), prec, undefined));
    }
    // Only `Duration / int` divides to an `int`: it truncates toward zero.
    if (e.operator === "/" && isInt) {
      return exprEmitterIntCall(
        plainEmitted([
          "Math.trunc",
          callArguments([emitted(runDoc(run, 1), prec, undefined)]),
        ]),
      );
    }
    return emitted(runDoc(run, 1), prec, {
      brace: leadingBrace(left, prec),
      run: run,
    });
  }
  function exprEmitterIntCall(body: Emitted): Emitted {
    return plainEmitted([
      exprEmitterScope.intFunction(),
      callArguments([body]),
    ]);
  }
  function exprEmitterConditional(
    e: Extract<Expr, {
      kind: "if";
    }>,
    kid: Kid,
    expected: Type | undefined,
  ): Emitted {
    const slot = exprEmitterSlotOf(expected, e.type);
    const condition = kid(e.condition, undefined);
    const then = at(kid(e.then, slot), PREC.conditional);
    const otherwise = kid(e.else, slot);
    const rest = otherwise.condChain;
    // A test that breaks keeps its lines one level deeper than the `?` line.
    // After a `return` or `=` that is two levels, as the body of an arrow one.
    // A comparison of two operands keeps two levels in a flush body too.
    const chain: CondChain = rest === undefined
      ? {
        tests: [condition],
        arms: [then],
        last: at(otherwise, PREC.conditional),
        nested: [],
        self: undefined,
      }
      : {
        tests: [condition, ...rest.tests],
        arms: [then, ...rest.arms],
        last: rest.last,
        nested: rest.self === undefined
          ? rest.nested
          : [rest.self, ...rest.nested],
        self: undefined,
      };
    const brace = { brace: leadingBrace(condition, PREC.or), condChain: chain };
    if (condition.run === undefined) {
      return emitted(condDoc(chain, 2), PREC.conditional, brace);
    }
    return emitted(condDoc(chain, 2), PREC.conditional, {
      ...brace,
      flush: condDoc(chain, isComparison(condition.run) ? 2 : 1),
    });
  }
  function exprEmitterClosure(
    e: Extract<Expr, {
      kind: "closure";
    }>,
    annotate: boolean,
    forceEffect: boolean | undefined,
  ): Emitted {
    const resolvedForceEffect = forceEffect ?? false;
    const parameters = bracketed(
      "(",
      ")",
      e.parameters.map((p) =>
        annotate
          ? [p.name, ": ", typeDoc(exprEmitterScope, p.type, undefined)]
          : p.name
      ),
      false,
    );
    const type = e.type;
    if (type.kind !== "function") {
      return internal("a closure node has a type that is not a function type");
    }
    if (type.execution === "effect" || resolvedForceEffect) {
      return exprEmitterArrowEmitted(parameters, {
        kind: "expr",
        body: exprEmitterAsEffect(e.body, type.result),
      });
    }
    if (e.body.kind === "block" && e.body.steps.length > 0) {
      return exprEmitterArrowEmitted(parameters, {
        kind: "block",
        statements: exprEmitterBlockStatements(e.body, false, type.result),
      });
    }
    return exprEmitterArrowEmitted(parameters, {
      kind: "expr",
      body: exprEmitterFit(e.body, type.result, "pure"),
    });
  }
  function exprEmitterCallParameterTypes(type: Type): readonly Type[] {
    const fn = exprEmitterFunctionTypeOf(type);
    if (fn === undefined) return [];
    return fn.parameters.map((parameter, index) => {
      const checked = fn.checked;
      const isChecked = checked === undefined ? false : checked[index];
      return isChecked ? { kind: "primitive", name: "unknown" } : parameter;
    });
  }
  function exprEmitterNonLeafCall(
    e: Extract<Expr, {
      kind: "call";
    }>,
    kid: Kid,
  ): Emitted {
    if (e.callee.kind === "reference") {
      const builtin = builtinInstanceName(e.callee.target);
      if (builtin !== undefined) {
        return exprEmitterBuiltinCall(e, builtin, kid);
      }
    }
    if (exprEmitterIsEffectfulFunction(e.callee.type)) {
      return internal("a leaf call reached the structural emitter");
    }
    const parameters = exprEmitterCallParameterTypes(e.callee.type);
    const callee = kid(e.callee, undefined);
    return emitted(
      [
        at(callee, PREC.member),
        callArguments(e.arguments.map((a, i) => kid(a, parameters[i]))),
      ],
      PREC.member,
      { brace: leadingBrace(callee, PREC.member) },
    );
  }
  function exprEmitterCallback(arg: Expr, kid: Kid): Emitted {
    return arg.kind === "closure"
      ? exprEmitterTag(arg, exprEmitterClosure(arg, false, undefined))
      : kid(arg, undefined);
  }
  function exprEmitterEffectCallback(arg: Expr): Emitted {
    const from = exprEmitterFunctionTypeOf(arg.type);
    if (from === undefined) {
      return internal("a stream callback is not a function");
    }
    return exprEmitterFit(arg, { ...from, execution: "effect" }, "pure");
  }
  function exprEmitterBuiltinCall(
    e: Extract<Expr, {
      kind: "call";
    }>,
    builtinName: string,
    kid: Kid,
  ): Emitted {
    const args = e.arguments;
    const name = asBuiltinInstanceName(builtinName);
    if (name === undefined) {
      return internal(`the builtin ${builtinName} has no emission form`);
    }
    if (name === "map" || name === "filter") {
      if (args.length !== 2) {
        return internal(`${name} needs two arguments`);
      }
      return plainEmitted([
        at(kid(args[0], undefined), PREC.member),
        `.${name}`,
        callArguments([exprEmitterCallback(args[1], kid)]),
      ]);
    }
    if (name === "fold") {
      if (args.length !== 3) {
        return internal("fold needs three arguments");
      }
      const generic = e.type.kind === "primitive"
        ? ""
        : typeArguments([typeDoc(exprEmitterScope, e.type, undefined)]);
      return plainEmitted([
        at(kid(args[0], undefined), PREC.member),
        ".reduce",
        generic,
        callArguments([
          exprEmitterCallback(args[2], kid),
          kid(args[1], undefined),
        ]),
      ]);
    }
    if (name === "div") {
      if (args.length !== 2) {
        return internal("div needs two arguments");
      }
      return plainEmitted([
        exprEmitterScope.divide(),
        callArguments([kid(args[0], undefined), kid(args[1], undefined)]),
      ]);
    }
    if (name === "round") {
      if (args.length !== 1) {
        return internal("round needs one argument");
      }
      return exprEmitterIntCall(plainEmitted([
        exprEmitterScope.round(),
        callArguments([kid(args[0], undefined)]),
      ]));
    }
    if (name === "trunc" || name === "floor" || name === "ceil") {
      if (args.length !== 1) {
        return internal(`${name} needs one argument`);
      }
      // `+ 0` turns the `-0` of `Math.ceil(-0.5)` into `0`.
      return exprEmitterIntCall(emitted(
        [
          `Math.${name}`,
          callArguments([kid(args[0], undefined)]),
          " + 0",
        ],
        PREC.additive,
        undefined,
      ));
    }
    if (name === "text") {
      if (args.length !== 1) {
        return internal("text needs one argument");
      }
      return plainEmitted([
        "String",
        callArguments([kid(args[0], undefined)]),
      ]);
    }
    if (name === "at") {
      if (args.length !== 2) {
        return internal("at needs two arguments");
      }
      return plainEmitted([
        exprEmitterScope.at(),
        callArguments([kid(args[0], undefined), kid(args[1], undefined)]),
      ]);
    }
    if (name === "concat") {
      // A list literal with a spread prints as one array literal.
      if (args.length === 0) {
        return internal("concat needs an argument");
      }
      const parts = args.flatMap((arg): Doc[] =>
        arg.kind === "array"
          ? arg.elements.map((x) =>
            flush(kid(x, exprEmitterElementType(arg.type, 0)))
          )
          : [["...", at(kid(arg, undefined), PREC.member)]]
      );
      return emitted(bracketed("[", "]", parts, false), PREC.member, {
        huggable: true,
        bracket: true,
      });
    }
    if (name === "len") {
      if (args.length !== 1) {
        return internal("len needs one argument");
      }
      return plainEmitted([
        at(kid(args[0], undefined), PREC.member),
        ".length",
      ]);
    }
    if (name === "sort") {
      if (args.length !== 1 && args.length !== 2) {
        return internal("sort needs one or two arguments");
      }
      return plainEmitted([
        exprEmitterScope.sort(),
        callArguments([
          kid(args[0], undefined),
          ...(args.length === 2 ? [exprEmitterCallback(args[1], kid)] : []),
        ]),
      ]);
    }
    return internal(`the builtin ${name} has no emission form`);
  }
  function exprEmitterStep(step: Step, mode: Mode): Doc {
    const value = exprEmitterKid(mode);
    if (step.kind === "bind") {
      const prefix: Doc = [
        "const ",
        step.binding.name,
        ": ",
        typeDoc(exprEmitterScope, step.binding.type, true),
      ];
      const bound = isPrimitiveLiteral(step.value) &&
          exprEmitterNarrowsOnDeclaration(step.binding.type)
        ? plainEmitted([
          exprEmitterLiteral(step.value.value),
          " as ",
          typeDoc(exprEmitterScope, step.binding.type, true),
        ])
        : value(step.value, step.binding.type);
      // A curried closure lays out like a declaration of the module.
      return [
        bound.chain !== undefined
          ? chainDeclaration(prefix, bound.chain)
          : assignment(prefix, free(bound), bracketsBreak(step.binding.type)),
        ";",
      ];
    }
    // A statement that starts with `{` would parse as a block, so it gets parentheses.
    const statement = value(step.value, undefined);
    return [
      statement.brace ? ["(", statement.doc, ")"] : statement.doc,
      ";",
    ];
  }
  function exprEmitterNestedBlock(
    e: Extract<Expr, {
      kind: "block";
    }>,
    mode: Mode,
    expected: Type | undefined,
  ): Emitted {
    const slot = exprEmitterSlotOf(expected, e.type);
    if (e.steps.length === 0) {
      return exprEmitterKid(mode)(e.result, slot);
    }
    if (mode === "gen") {
      return exprEmitterYieldOf(
        exprEmitterGenCall(exprEmitterBlockStatements(e, true, slot)),
      );
    }
    return plainEmitted([
      "(() => ",
      braces(exprEmitterBlockStatements(e, false, slot)),
      ")()",
    ]);
  }
  function exprEmitterYieldOf(effect: Emitted): Emitted {
    return emitted(
      ["yield* ", at(effect, PREC.conditional)],
      PREC.yield,
      undefined,
    );
  }
  function exprEmitterMatch(
    e: Extract<Expr, {
      kind: "match";
    }>,
    expected: Type | undefined,
  ): Emitted {
    const effectful = e.execution === "effect";
    const slot = exprEmitterSlotOf(expected, e.type);
    const subject = effectful
      ? exprEmitterInGen(e.subject, undefined)
      : exprEmitterPure(e.subject, undefined);
    function body(arm: Arm): Emitted {
      return effectful
        ? exprEmitterAsEffect(arm.body, slot)
        : exprEmitterFit(arm.body, slot, "pure");
    }
    if (!effectful && exprEmitterIsCoalesce(e, slot)) {
      return exprEmitterCoalesce(subject, body(e.arms[0]));
    }
    const optionLike =
      e.arms.every((a) =>
        a.pattern.kind === "some" || a.pattern.kind === "none" ||
        a.pattern.kind === "wildcard"
      ) && e.arms.some((a) =>
        a.pattern.kind === "some" || a.pattern.kind === "none"
      );
    const result = optionLike
      ? exprEmitterOptionMatch(e.arms, subject, body)
      : exprEmitterSelectorMatch(e.arms, subject, e.subject.type, body);
    return effectful ? exprEmitterYieldOf(result) : result;
  }
  function exprEmitterIsCoalesce(
    e: Extract<Expr, {
      kind: "match";
    }>,
    slot: Type | undefined,
  ): boolean {
    if (e.arms.length !== 2) {
      return false;
    }
    const absent = e.arms[0];
    const taken = e.arms[1];
    const binding = taken.pattern.kind === "bind"
      ? taken.pattern.binding.id
      : undefined;
    return absent.pattern.kind === "literal" && absent.pattern.value === null &&
      binding !== undefined && taken.body.kind === "reference" &&
      taken.body.target === binding &&
      exprEmitterLiftedFrom(taken.body, slot) === undefined;
  }
  function exprEmitterCoalesce(subject: Emitted, fallback: Emitted): Emitted {
    const run: Run = {
      operands: [at(subject, PREC.equality), at(fallback, PREC.equality)],
      operators: ["??"],
      inner: [],
      top: undefined,
    };
    return emitted(runDoc(run, 1), PREC.conditional, {
      brace: leadingBrace(subject, PREC.equality),
    });
  }
  function exprEmitterOptionMatch(
    arms: readonly Arm[],
    subject: Emitted,
    body: (arm: Arm) => Emitted,
  ): Emitted {
    const option = exprEmitterScope.effect("Option");
    const none = arms.find((a) => a.pattern.kind === "none") ??
      arms.find((a) => a.pattern.kind === "wildcard");
    const some = arms.find((a) => a.pattern.kind === "some") ??
      arms.find((a) => a.pattern.kind === "wildcard");
    if (none === undefined || some === undefined) {
      return internal("an option match lacks an arm");
    }
    const someBinding = some.pattern.kind === "some"
      ? some.pattern.binding.name
      : "_";
    const handlers = bracketed("{", "}", [
      ["onNone: ", exprEmitterArrow("()", body(none), undefined)],
      [
        "onSome: ",
        exprEmitterArrow(`(${someBinding})`, body(some), undefined),
      ],
    ], true);
    return plainEmitted([
      `${option}.match`,
      callArguments([
        subject,
        emitted(handlers, PREC.member, { huggable: true }),
      ]),
    ]);
  }
  function exprEmitterSelectorMatch(
    arms: readonly Arm[],
    subject: Emitted,
    subjectType: Type,
    body: (arm: Arm) => Emitted,
  ): Emitted {
    const selector = exprEmitterScope.temp();
    function armDoc(arm: Arm): Doc {
      if (arm.pattern.kind === "some") {
        return internal(
          "a Some pattern in a match that is not an option match",
        );
      }
      const binding = patternBinding(arm.pattern);
      const inner = body(arm);
      if (binding === null) {
        return at(inner, PREC.conditional);
      }
      return [
        "(",
        exprEmitterArrow(`(${binding.name})`, inner, undefined),
        ")(",
        selector,
        ")",
      ];
    }
    // The chain is `test ? arm : test ? arm : last`. `deno fmt` prints the
    // nested conditionals of the else branch at the indentation of the first.
    // A last arm other than `_` has a test too, and the else branch throws, so
    // a value outside the type (from unsound host code) takes no arm.
    const final = arms.length - 1;
    if (final < 0) {
      return internal("a match has no arm");
    }
    // The last arm builds its body before its test, as the other arms do not.
    const finalDoc = armDoc(arms[final]);
    const finalWildcard = arms[final].pattern.kind === "wildcard" ||
      arms[final].pattern.kind === "bind";
    let last: Doc = finalWildcard
      ? finalDoc
      : [exprEmitterScope.unmatched(), "(", selector, ")"];
    let pairs: {
      readonly test: ArmTest;
      readonly arm: Doc;
    }[] = [];
    const firstIndex = finalWildcard ? final - 1 : final;
    const reversedArms = [...arms.slice(0, firstIndex + 1).entries()].reverse();
    for (const armEntry of reversedArms) {
      const i = armEntry[0];
      const arm = arms[i];
      const test = exprEmitterArmTest(arm.pattern, selector, subjectType);
      if (test === undefined) {
        // A wildcard before the last arm makes the later arms unreachable.
        last = armDoc(arm);
        pairs = [];
        continue;
      }
      pairs[pairs.length] = {
        test: test,
        arm: i === final ? finalDoc : armDoc(arm),
      };
    }
    pairs = pairs.reverse();
    const chain: Doc = pairs.length === 0 ? last : conditionalChain(
      pairs[0].test.first ?? pairs[0].test.doc,
      pairs.slice(1).map((pair) => pair.test),
      pairs.map((pair) => pair.arm),
      last,
    );
    // When the body of the selector moves down, `deno fmt` also indents the
    // arguments of the call by one more level.
    const bodyGroup: GroupId = {};
    // A binding arm reads the narrowed selector, so the parameter has the type of
    // the subject: a narrowed block constant would make the binding `never`.
    const parameter: Doc = arms.some((a) => a.pattern.kind === "bind")
      ? bracketed("(", ")", [
        property(selector, typeDoc(exprEmitterScope, subjectType, undefined)),
      ], false)
      : `(${selector})`;
    const callee = exprEmitterArrow(
      parameter,
      emitted(chain, PREC.conditional, undefined),
      bodyGroup,
    );
    const args = callArguments([subject]);
    return plainEmitted([
      "(",
      callee,
      ")",
      ifBroke(bodyGroup, indent(args), args),
    ]);
  }
  function exprEmitterArmTest(
    pattern: Pattern,
    selector: string,
    subject: Type,
  ): ArmTest | undefined {
    if (pattern.kind === "wildcard" || pattern.kind === "bind") {
      return undefined;
    }
    if (pattern.kind === "literal") {
      return armEquality(
        selector,
        pattern.value === null ? "null" : exprEmitterLiteral(pattern.value),
      );
    }
    if (pattern.kind === "duration") {
      return armEquality(selector, exprEmitterLiteral(pattern.millis));
    }
    if (pattern.kind === "error") {
      if (pattern.error === SCHEMA_ISSUE_ID) {
        return armEquality(
          `${exprEmitterScope.effect("SchemaIssue")}.isIssue(${selector})`,
          "true",
        );
      }
      return armEquality(
        `${selector}._tag`,
        JSON.stringify(errorTag(pattern.error)),
      );
    }
    if (pattern.kind === "nominal") {
      return armEquality(
        `${selector}._tag`,
        JSON.stringify(tokenOfId(pattern.nominal)),
      );
    }
    if (pattern.kind === "tag") {
      const left = `${selector}.${pattern.field}`;
      const right = JSON.stringify(pattern.value);
      if (exprEmitterRecordMemberLacksField(subject, pattern.field)) {
        const guard = `${JSON.stringify(pattern.field)} in ${selector} &&`;
        return {
          doc: guardedArmEquality(guard, left, right, 2),
          first: guardedArmEquality(guard, left, right, 1),
          split: undefined,
        };
      }
      return armEquality(left, right);
    }
    if (pattern.kind === "none" || pattern.kind === "some") {
      return internal(
        "an option pattern in a match that is not an option match",
      );
    }
  }
  function exprEmitterRecordMemberLacksField(
    type: Type,
    field: string,
  ): boolean {
    const resolved = exprEmitterScope.resolve(type);
    if (resolved.kind === "union") {
      return resolved.members.some((m) =>
        exprEmitterRecordMemberLacksField(m, field)
      );
    }
    return resolved.kind === "record" &&
      !resolved.fields.some((f) => f.name === field);
  }
  function exprEmitterEffectNode(e: Expr, expected: Type | undefined): Emitted {
    if (e.execution === "pure") {
      const effect = exprEmitterScope.effect("Effect");
      return plainEmitted([
        `${effect}.succeed`,
        callArguments([exprEmitterFit(e, expected, "pure")]),
      ]);
    }
    if (
      exprEmitterIsLeaf(e) && exprEmitterLiftedFrom(e, expected) === undefined
    ) {
      return exprEmitterLeafEffect(e, false);
    }
    if (e.kind === "block" && e.steps.length > 0) {
      return exprEmitterGenCall(exprEmitterBlockStatements(e, true, expected));
    }
    return exprEmitterGenCall([exprEmitterReturnStatement(e, expected, "gen")]);
  }
  function exprEmitterIsLeaf(e: Expr): boolean {
    if (e.kind === "call") {
      return exprEmitterIsEffectfulFunction(e.callee.type);
    }
    return isLeafExpr(e);
  }
  function exprEmitterEvaluatedChildren(e: Expr): Expr[] {
    return e.kind === "call" && e.callee.kind === "reference" &&
        knownBuiltinInstanceName(e.callee.target) !== undefined
      ? [...e.arguments]
      : evaluatedChildren(e);
  }
  function exprEmitterExpectedChildren(e: Expr): (Type | undefined)[] {
    if (e.kind === "call") {
      return e.callee.kind === "reference" &&
          knownBuiltinInstanceName(e.callee.target) !== undefined
        ? [...(exprEmitterFunctionTypeOf(e.callee.type)?.parameters ?? [])]
        : [
          undefined,
          ...exprEmitterCallParameterTypes(e.callee.type),
        ];
    }
    if (e.kind === "perform") {
      const service = exprEmitterScope.typeLevelDeclaration(
        serviceOfCapability(e.capability),
      );
      if (service?.kind !== "service") {
        return [];
      }
      const method = service.methods.find((m) => m.id === e.capability);
      return method === undefined ? [] : [...method.type.parameters];
    }
    return [];
  }
  function exprEmitterIsTrivial(e: Expr): boolean {
    if (
      e.kind === "null" || e.kind === "literal" || e.kind === "reference" ||
      e.kind === "none" || e.kind === "closure"
    ) {
      return true;
    }
    if (e.kind === "record" || e.kind === "error") {
      return e.fields.every((f) => exprEmitterIsTrivial(f.value));
    }
    if (e.kind === "update") {
      return exprEmitterIsTrivial(e.record) &&
        e.fields.every((f) => exprEmitterIsTrivial(f.value));
    }
    if (e.kind === "array" || e.kind === "tuple") {
      return e.elements.every((x) => exprEmitterIsTrivial(x));
    }
    if (e.kind === "get") {
      return exprEmitterIsTrivial(e.record);
    }
    if (e.kind === "nominal" || e.kind === "some") {
      return exprEmitterIsTrivial(e.value);
    }
    return false;
  }
  function exprEmitterLeafEffect(e: Expr, yielded: boolean): Emitted {
    const children = exprEmitterEvaluatedChildren(e);
    let last = -1;
    for (const childEntry of children.entries()) {
      const i = childEntry[0];
      const c = childEntry[1];
      if (c.execution === "effect") {
        last = i;
      }
    }
    const expected = exprEmitterExpectedChildren(e);
    if (last < 0) {
      const leaf = exprEmitterLeaf(
        e,
        children.map((c, i) => exprEmitterFit(c, expected[i], "pure")),
      );
      return yielded ? exprEmitterYieldOf(leaf) : leaf;
    }
    const statements: Doc[] = [];
    const emittedChildren: Emitted[] = children.map((child, i) => {
      if (
        i > last || (child.execution === "pure" && exprEmitterIsTrivial(child))
      ) {
        return exprEmitterFit(child, expected[i], "pure");
      }
      const name = exprEmitterScope.temp();
      const want = expected[i];
      statements[statements.length] = [
        "const ",
        name,
        ": ",
        typeDoc(exprEmitterScope, want ?? child.type, undefined),
        " = ",
        free(exprEmitterFit(child, want, "gen")),
        ";",
      ];
      return plainEmitted(name);
    });
    statements[statements.length] = [
      "return ",
      free(exprEmitterYieldOf(exprEmitterLeaf(e, emittedChildren))),
      ";",
    ];
    const gen = exprEmitterGenCall(statements);
    return yielded ? exprEmitterYieldOf(gen) : gen;
  }
  function exprEmitterLeaf(e: Expr, children: readonly Emitted[]): Emitted {
    const effect = exprEmitterScope.effect("Effect");
    if (e.kind !== "call" && !isLeafExpr(e)) {
      return internal(`${e.kind} is not a leaf`);
    }
    if (e.kind === "call") {
      if (e.callee.kind === "reference") {
        const builtin = knownBuiltinInstanceName(e.callee.target);
        if (builtin !== undefined) {
          if (
            builtin === "div" || builtin === "trunc" || builtin === "floor" ||
            builtin === "round" || builtin === "ceil" || builtin === "text" ||
            builtin === "len" || builtin === "at" || builtin === "sort" ||
            builtin === "concat"
          ) {
            // A pure builtin is not a leaf: `builtinCall` prints it.
            return internal(`the builtin ${builtin} is not an effect leaf`);
          }
          const counts: Record<typeof builtin, readonly number[]> = {
            all: [1, 2],
            traverse: [2, 3],
            map: [2],
            filter: [2],
            fold: [3],
          };
          if (!counts[builtin].includes(children.length)) {
            return internal(`${builtin} has an invalid argument count`);
          }
          const first = children[0];
          const second = children[1];
          const third = children[2];
          if (builtin === "filter") {
            // Effect 4 has only the curried form for an effectful
            // predicate. Its element type is not inferable, so name it.
            const fn = exprEmitterFunctionTypeOf(e.callee.type);
            const items = fn && exprEmitterScope.resolve(fn.parameters[0]);
            if (fn === undefined || items?.kind !== "array") {
              return internal("filter has no array parameter");
            }
            return plainEmitted([
              `${effect}.filter`,
              typeArguments([
                typeDoc(exprEmitterScope, items.element, undefined),
                ...channelTypeArguments(exprEmitterScope, fn.effects),
              ]),
              "(",
              free(second),
              ")(",
              free(first),
              ")",
            ]);
          }
          if (builtin === "fold") {
            // The source evaluates the initial value at the call, which
            // runs at once. Effectful children are already bound to
            // temporaries, so the thunk only wraps a pure expression.
            return plainEmitted([
              `${effect}.reduce(`,
              free(first),
              ", ",
              exprEmitterArrow("()", second, undefined),
              ", ",
              free(third),
              ")",
            ]);
          }
          if (builtin === "all") {
            return plainEmitted([
              `${effect}.all(`,
              free(first),
              ...(second === undefined ? [] : [", ", free(second)]),
              ")",
            ]);
          }
          if (builtin === "map" || builtin === "traverse") {
            return plainEmitted([
              `${effect}.forEach(`,
              free(first),
              ", ",
              free(second),
              ...(third === undefined ? [] : [", ", free(third)]),
              ")",
            ]);
          }
        }
      }
      return plainEmitted([
        at(children[0], PREC.member),
        callArguments(children.slice(1)),
      ]);
    }
    if (e.kind === "perform") {
      const service = exprEmitterScope.nameOf(
        serviceOfCapability(e.capability),
      );
      const parameter = exprEmitterScope.serviceParameter();
      const call = plainEmitted([
        parameter,
        ".",
        methodOfCapability(e.capability),
        callArguments(children),
      ]);
      const bodyGroup: GroupId = {};
      const arrow = emitted(
        exprEmitterArrow(`(${parameter})`, call, bodyGroup),
        PREC.yield,
        { huggable: true, bodyGroup: bodyGroup },
      );
      return plainEmitted(member(service, "use", callArguments([arrow])));
    }
    if (
      e.kind === "schema-make" || e.kind === "schema-decode" ||
      e.kind === "schema-encode"
    ) {
      return schemaLeaf(exprEmitterSelf, e, children);
    }
    if (
      e.kind === "retry" || e.kind === "retry-with-schedule" ||
      e.kind === "timeout" || e.kind === "repeat" || e.kind === "sleep" ||
      e.kind === "now" || e.kind === "log" || e.kind === "random" ||
      e.kind === "random-int" || e.kind === "uninterruptible" ||
      e.kind === "run"
    ) {
      return effectLeaf(exprEmitterSelf, e, children);
    }
    if (e.kind === "fork-scoped" || e.kind === "with-resource") {
      return scopeLeaf(exprEmitterSelf, e, children);
    }
    if (e.kind === "provide") {
      return layerLeaf(exprEmitterSelf, e, children);
    }
    if (e.kind === "catch") {
      return exprEmitterCatchEffect(e);
    }
    if (e.kind === "ensure") {
      return exprEmitterEnsureEffect(e);
    }
    if (e.kind === "update-ref") {
      return plainEmitted([
        exprEmitterCalleeText(
          exprEmitterIsEffectfulFunction(e.transform.type)
            ? UPDATE_REF_EFFECT
            : LEAF_CALLS["update-ref"],
        ),
        callArguments(children),
      ]);
    }
    // The remaining leaf kinds call a function on their children. A kind
    // that has neither a case above nor a row in LEAF_CALLS fails to
    // compile here.
    return plainEmitted([
      exprEmitterCalleeText(LEAF_CALLS[e.kind]),
      callArguments(children),
    ]);
  }
  function exprEmitterSuspended(
    job: Expr,
    hoisted: Emitted | undefined,
  ): Emitted {
    const effect = exprEmitterScope.effect("Effect");
    const from = exprEmitterFunctionTypeOf(job.type);
    const pureJob = from !== undefined && from.execution === "pure";
    let value: Emitted;
    if (hoisted !== undefined) {
      value = pureJob
        ? exprEmitterLift(from, at(hoisted, PREC.member))
        : hoisted;
    } else if (pureJob) {
      value = exprEmitterFit(job, { ...from, execution: "effect" }, "pure");
    } else {
      value = exprEmitterPure(job, undefined);
    }
    return plainEmitted([`${effect}.suspend`, callArguments([value])]);
  }
  function exprEmitterHandlerEntry(
    key: string,
    parameters: string,
    body: Emitted,
  ): Doc {
    const arrow = exprEmitterArrow(parameters, body, undefined);
    if (body.chain !== undefined || body.brace) {
      return [key, ": ", arrow];
    }
    return alt([
      [key, ": ", arrow],
      [key, ": ", parameters, " =>", indent([hard, flush(body)])],
      [key, ":", indent([hard, arrow])],
    ]);
  }
  function exprEmitterEnsureEffect(
    e: Extract<Expr, {
      kind: "ensure";
    }>,
  ): Emitted {
    const effect = exprEmitterScope.effect("Effect");
    const body = exprEmitterAsEffect(e.body, undefined);
    if (e.finalizer.parameters.length === 0) {
      return plainEmitted([
        `${effect}.ensuring`,
        callArguments([
          body,
          exprEmitterAsEffect(e.finalizer.body, undefined),
        ]),
      ]);
    }
    const exit = exprEmitterScope.temp();
    const call = plainEmitted([
      at(exprEmitterClosure(e.finalizer, true, true), PREC.member),
      callArguments([
        emitted(
          `${exprEmitterScope.outcome().make}(${exit})`,
          undefined,
          undefined,
        ),
      ]),
    ]);
    return plainEmitted([
      `${effect}.onExit`,
      callArguments([
        body,
        exprEmitterArrowEmitted(`(${exit})`, {
          kind: "expr",
          body: call,
        }),
      ]),
    ]);
  }
  function exprEmitterCatchEffect(
    e: Extract<Expr, {
      kind: "catch";
    }>,
  ): Emitted {
    const effect = exprEmitterScope.effect("Effect");
    const defect = e.defect === undefined
      ? []
      : [exprEmitterDefectRecovery(e.defect)];
    if (e.handlers.length === 0 && e.defect !== undefined) {
      return plainEmitted([
        at(exprEmitterAsEffect(e.body, undefined), PREC.member),
        ".pipe",
        callArguments(defect),
      ]);
    }
    const issueHandler = e.handlers.find((h) => h.error === SCHEMA_ISSUE_ID);
    const tagged = e.handlers.filter((h) => h.error !== SCHEMA_ISSUE_ID);
    const handlers = tagged.map((h: Handler) =>
      exprEmitterHandlerEntry(
        JSON.stringify(errorTag(h.error)),
        `(${h.binding.name})`,
        exprEmitterAsEffect(h.body, undefined),
      )
    );
    const table = emitted(bracketed("{", "}", handlers, true), PREC.member, {
      huggable: true,
    });
    const catchTags = plainEmitted([
      `${effect}.catchTags`,
      callArguments([table]),
    ]);
    const rest = issueHandler === undefined || tagged.length === 0
      ? ""
      : exprEmitterScope.temp();
    const predicate = issueHandler === undefined ? "" : exprEmitterScope.temp();
    const recovery = issueHandler === undefined ? catchTags : plainEmitted([
      `${effect}.catchIf`,
      callArguments([
        emitted(
          `(${predicate}): ${predicate} is typeof ${predicate} & ${
            exprEmitterScope.effect("SchemaIssue")
          }.Issue => ${
            exprEmitterScope.effect("SchemaIssue")
          }.isIssue(${predicate})`,
          undefined,
          undefined,
        ),
        exprEmitterArrowEmitted(`(${issueHandler.binding.name})`, {
          kind: "expr",
          body: exprEmitterAsEffect(issueHandler.body, undefined),
        }),
        ...(tagged.length === 0 ? [] : [
          exprEmitterArrowEmitted(`(${rest})`, {
            kind: "expr",
            body: emitted(
              [
                `${effect}.fail(${rest}).pipe`,
                callArguments([catchTags]),
              ],
              undefined,
              undefined,
            ),
          }),
        ]),
      ]),
    ]);
    return plainEmitted([
      at(exprEmitterAsEffect(e.body, undefined), PREC.member),
      ".pipe",
      callArguments([recovery, ...defect]),
    ]);
  }
  function exprEmitterDefectRecovery(h: DefectHandler): Emitted {
    const d = exprEmitterScope.temp();
    return plainEmitted([
      `${exprEmitterScope.effect("Effect")}.catchDefect`,
      callArguments([
        exprEmitterArrowEmitted(`(${d})`, {
          kind: "block",
          statements: [
            `const ${h.binding.name} = { message: ${defectMessage(d)} };`,
            ["return ", flush(exprEmitterAsEffect(h.body, undefined)), ";"],
          ],
        }),
      ]),
    ]);
  }
  const exprEmitterSelf: ExprEmitter = {
    scope: exprEmitterScope,
    pure: exprEmitterPure,
    asEffect: exprEmitterAsEffect,
    blockStatements: exprEmitterBlockStatements,
    arrow: exprEmitterArrow,
    arrowBlock: exprEmitterArrowBlock,
    arrowDeclaration: exprEmitterArrowDeclaration,
    functionTypeOf: exprEmitterFunctionTypeOf,
    fit: exprEmitterFit,
    adaptedInput: exprEmitterAdaptedInput,
    objectLiteral: exprEmitterObjectLiteral,
    closure: exprEmitterClosure,
    effectCallback: exprEmitterEffectCallback,
    suspended: exprEmitterSuspended,
  };
  return exprEmitterSelf;
}
