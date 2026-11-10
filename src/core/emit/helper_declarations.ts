// The declarations of the generated helpers of a module: `$int`, `$rem`, `$div`, `$round`, `$unmatched`,
// `$Int`, `$hostCheck`, and `$outcome`. Each one reads the name of its helper
// from the module state, so the call registers the name and its imports.
import {
  braces,
  type Doc,
  group,
  hard,
  ifBreak,
  indent,
  join,
  soft,
} from "./doc.ts";
import type { ModuleState } from "./module_state.ts";

/** `const $int = ...` */
export function intFunctionDeclaration(scope: ModuleState): Doc {
  const name = scope.intFunction();
  return [
    `const ${name} = (value: number): number => `,
    braces([
      'if (!Number.isSafeInteger(value)) throw new RangeError("int overflow");',
      "return value;",
    ]),
    ";",
  ];
}

/** `const $rem = ...`: the remainder of an `int`, which gives no `-0` and no `NaN`. */
export function remainderDeclaration(scope: ModuleState): Doc {
  const name = scope.remainder();
  return [
    `const ${name} = (left: number, right: number): number => `,
    braces([
      'if (right === 0) throw new RangeError("division by zero");',
      "return left % right + 0;",
    ]),
    ";",
  ];
}

/** `const $div = ...`: the quotient of two `int` values, truncated toward zero and exact. */
export function divideDeclaration(scope: ModuleState): Doc {
  const name = scope.divide();
  return [
    `const ${name} = (left: number, right: number): number => `,
    braces([
      'if (right === 0) throw new RangeError("division by zero");',
      "return Number(BigInt(left) / BigInt(right));",
    ]),
    ";",
  ];
}

/** `const $round = ...`: `Math.round` with the half rounded away from zero and no `-0`. */
export function roundDeclaration(scope: ModuleState): Doc {
  const name = scope.round();
  return [
    `const ${name} = (value: number): number => `,
    braces([
      "if (value < 0) return -Math.round(-value) + 0;",
      "return Math.round(value) + 0;",
    ]),
    ";",
  ];
}

/** `const $at = ...`: `Some` of the element at an index in range, else `None`. An element can be `null`. */
export function atDeclaration(scope: ModuleState): Doc {
  const name = scope.at();
  const option = scope.effect("Option");
  return [
    `const ${name} = <T>(xs: ReadonlyArray<T>, i: number): ${option}.Option<T> => `,
    braces([
      `return i >= 0 && i < xs.length ? ${option}.some(xs[i]!) : ${option}.none();`,
    ]),
    ";",
  ];
}

/**
 * `function $sort`: a stable copy of an array in ascending order of the element or of
 * its key, which is a number or a string. NaN sorts after every number, and two NaN are equal.
 */
export function sortDeclaration(scope: ModuleState): Doc {
  const name = scope.sort();
  return [
    `function ${name}<T extends number | string>(xs: ReadonlyArray<T>): T[];`,
    hard,
    `function ${name}<T, K extends number | string>(`,
    indent([hard, "xs: ReadonlyArray<T>,", hard, "key: (x: T) => K,"]),
    hard,
    "): T[];",
    hard,
    `function ${name}<T, K extends number | string>(`,
    indent([hard, "xs: ReadonlyArray<T>,", hard, "key?: (x: T) => K,"]),
    hard,
    "): T[] ",
    braces([
      "const of = key ?? ((x: T) => x as unknown as K);",
      [
        "return [...xs].sort((a, b) => ",
        braces([
          "const x = of(a);",
          "const y = of(b);",
          "if (x < y) return -1;",
          "if (x > y) return 1;",
          "if (x === y || (x !== x && y !== y)) return 0;",
          "return x !== x ? 1 : -1;",
        ]),
        ");",
      ],
    ]),
  ];
}

/** `const $unmatched = ...` */
export function unmatchedDeclaration(scope: ModuleState): Doc {
  const name = scope.unmatched();
  return [
    `const ${name} = (_value: never): never => `,
    braces([
      'throw new TypeError("a match received a value outside its type");',
    ]),
    ";",
  ];
}

/** `const $Int = Schema.Finite.check(...)`, the `Int` schema of the book. */
export function intSchemaDeclaration(scope: ModuleState): Doc {
  const name = scope.intSchemaName();
  const schema = scope.effect("Schema");
  const filter: Doc = group([
    `${schema}.makeFilter(`,
    indent([
      soft,
      '(value) => Number.isSafeInteger(value) || "expected a safe integer"',
    ]),
    ifBreak(","),
    soft,
    ")",
  ]);
  return [
    `const ${name} = ${schema}.Finite.check(`,
    group([
      indent([soft, filter]),
      ifBreak(","),
      soft,
    ]),
    ");",
  ];
}

/** `const $hostCheck = ...`: the synchronous check of a wrapped host provider. */
export function hostCheckDeclaration(scope: ModuleState): Doc {
  const name = scope.hostCheck();
  const schema = scope.effect("Schema");
  const exit = scope.effect("Exit");
  const cause = scope.effect("Cause");
  return [
    `const ${name} = <T>(`,
    indent([
      hard,
      `schema: ${schema}.Top & { readonly Type: T },`,
      hard,
      "label: string,",
      hard,
      "adapt: (value: unknown) => unknown = (value) => value,",
    ]),
    hard,
    ") => ",
    braces([
      `const is = ${schema}.is(schema);`,
      `const decode = ${schema}.decodeUnknownExit(${schema}.toType(schema));`,
      [
        "return (value: T): T => ",
        braces([
          "const fields = adapt(value);",
          "if (is(fields)) return value;",
          "const exit = decode(fields);",
          `const failure = ${exit}.isFailure(exit) ? ${cause}.squash(exit.cause) : undefined;`,
          [
            "const issue = failure instanceof Error",
            indent([
              hard,
              '? failure.message.replace(/\\s*\\n\\s*/g, " ")',
              hard,
              ': "unknown issue";',
            ]),
          ],
          [
            "throw new TypeError(",
            indent([
              hard,
              "`host value of ${label} does not match its type: ${issue}`,",
            ]),
            hard,
            ");",
          ],
        ]),
        ";",
      ],
    ]),
    ";",
  ];
}

/** The message of a defect value. The Defect arm of `catch` uses the same rule. */
export function defectMessage(value: string): string {
  return `${value} instanceof Error ? ${value}.message : String(${value})`;
}

export function outcomeDeclaration(scope: ModuleState): Doc {
  const names = scope.outcome();
  const exit = scope.effect("Exit");
  return join(hard, [
    `type ${names.type}<A, E> =`,
    '  | { readonly _tag: "Success"; readonly success: A }',
    "  | ([E] extends [never] ? never",
    '    : { readonly _tag: "Failure"; readonly failure: E })',
    '  | { readonly _tag: "Defect"; readonly message: string }',
    '  | { readonly _tag: "Interrupted" };',
    `function ${names.make}<A, E>(exit: ${exit}.Exit<A, E>): ${names.type}<A, E> {`,
    '  if (exit._tag === "Success") return { _tag: "Success", success: exit.value };',
    "  let defect: { readonly value: unknown } | undefined;",
    "  for (const reason of exit.cause.reasons) {",
    '    if (reason._tag === "Fail") {',
    `      return { _tag: "Failure", failure: reason.error } as ${names.type}<A, E>;`,
    "    }",
    '    if (reason._tag === "Die") defect ??= { value: reason.defect };',
    "  }",
    '  if (defect === undefined) return { _tag: "Interrupted" };',
    "  const value = defect.value;",
    "  return {",
    '    _tag: "Defect",',
    `    message: ${defectMessage("value")},`,
    "  };",
    "}",
  ]);
}
