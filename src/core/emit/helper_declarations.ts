// The declarations of the generated helpers of a module: `$int`, `$rem`, `$unmatched`,
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
