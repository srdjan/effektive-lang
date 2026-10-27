// The helper that maps an Exit to the outcome record of a `finally` binding.
// A typed failure wins over a defect, and a defect wins over an interruption.
import { type Doc, hard, join } from "./doc.ts";
import type { Scope } from "./scope.ts";

export function outcomeDeclaration(scope: Scope): Doc {
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
    "    message: value instanceof Error ? value.message : String(value),",
    "  };",
    "}",
  ]);
}
