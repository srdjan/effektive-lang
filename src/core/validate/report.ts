// The report of one validation run. The validator emits one diagnostic per
// disagreement. The code names the validation area (spec, "Equations and
// validation"). A message starts with the IR path of the node.

import { emptySet } from "../runtime.ts";
import { type Diagnostic, makeDiagnostic } from "../diagnostics.ts";
import type { ModuleIR } from "../ir.ts";
import type { Span } from "../source.ts";
import { fallbackSpan } from "./prelude.ts";

/** The eight validation areas and their codes. */
export const AREA = {
  identity: "validation/001",
  types: "validation/002",
  contracts: "validation/003",
  execution: "validation/004",
  recovery: "validation/005",
  control: "validation/006",
  initialization: "validation/007",
  serialization: "validation/008",
} as const;

export type AreaCode = typeof AREA[keyof typeof AREA];
export type ValidationPath = string;
export type ValidationMessage = string;
export type ValidationText = string;
export type ValidationTexts = readonly ValidationText[];
export type ValidationFlag = boolean;
export type ValidationCount = number;
export type DepthLimit = number;

/** The span of a finding that has no source position: the start of the first source. */
export function moduleSpan(ir: ModuleIR): Span {
  return fallbackSpan(ir.sources[0] ?? ir.module);
}

export type Report = {
  readonly items: () => readonly Diagnostic[];
  readonly add: (
    code: AreaCode,
    path: ValidationPath,
    what: ValidationMessage,
    span: Span,
  ) => Report;
  readonly addDepth: (
    path: ValidationPath,
    limit: DepthLimit,
    span: Span,
  ) => Report;
};

export function createReport(): Report {
  const diagnostics: Diagnostic[] = [];
  let deep = emptySet<string>();

  function items(): readonly Diagnostic[] {
    return diagnostics;
  }

  function add(
    code: AreaCode,
    path: ValidationPath,
    what: ValidationMessage,
    span: Span,
  ): Report {
    diagnostics[diagnostics.length] = makeDiagnostic(
      code,
      `${path}: ${what}`,
      span,
    );
    return report;
  }

  function addDepth(
    path: ValidationPath,
    limit: DepthLimit,
    span: Span,
  ): Report {
    const declaration = path.split(".", 1)[0];
    if (deep.has(declaration)) return report;
    deep = deep.add(declaration);
    return add(AREA.types, path, `type nesting exceeds ${limit} levels`, span);
  }

  const report: Report = {
    items: items,
    add: add,
    addDepth: addDepth,
  };
  return report;
}
