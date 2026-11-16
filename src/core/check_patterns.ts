// Pattern checking for `match`. These functions check the pattern of one arm
// against the domain of the subject, track which values the arms cover, and
// report coverage and reachability errors. `BodyChecker` calls `pattern` for
// each arm and `checkCoverage` once after the last arm.

import type { DiagnosticCode } from "./diagnostics.ts";
import { isErrorId } from "./ids.ts";
import type { ErrorId, LocalId, TypeId } from "./ir.ts";
import {
  describeLiteral,
  type Domain,
  narrowTagged,
  taggedValues,
} from "./patterns.ts";
import { optionConstructorOf, type Target, targetText } from "./resolve.ts";
import { kindOf, type NodeId, SyntaxKind, type SyntaxTree } from "./syntax.ts";
import { literalOf, nameTextOf, numberTextOf } from "./syntax_queries.ts";
import { isDurationText } from "./lex.ts";
import type { BodyTable, NodeFact, PatternFact } from "./tables.ts";
import { literalFitsPrimitive, type TypeRef, type TypeTable } from "./types.ts";
import { showTypes } from "./type_show.ts";
import { emptySet } from "./runtime.ts";

export type PatternContext = {
  readonly tree: SyntaxTree;
  readonly table: TypeTable;
  readonly targets: ReadonlyMap<NodeId, Target>;
  readonly body: Pick<BodyTable, "locals">;
  recordLocal(local: LocalId, type: TypeRef): PatternContext;
  kids(node: NodeId): NodeId[];
  kidsOfKind(node: NodeId, kind: SyntaxKind): NodeId[];
  report(code: DiagnosticCode, message: string, node: NodeId): PatternContext;
  fact(node: NodeId, fact: NodeFact): PatternContext;
};

export type MatchState = {
  readonly wildcard: () => boolean;
  readonly markWildcard: () => MatchState;
  /**
   * A binding arm of a nullable match: "bound" when it matches every value except
   * null, "misplaced" when it came before the `null` arm and a diagnostic rejected it.
   */
  readonly binding: () => "bound" | "misplaced" | undefined;
  readonly markBinding: (value: "bound" | "misplaced") => MatchState;
  readonly covered: () => ReadonlySet<string>;
  readonly cover: (key: string) => MatchState;
  /** The discriminator field of a tagged match, once an arm names it. */
  readonly tagField: () => string | undefined;
  readonly markTagField: (field: string) => MatchState;
};

export function createMatchState(): MatchState {
  let wildcard = false;
  let binding: "bound" | "misplaced" | undefined;
  let covered = emptySet<string>();
  let tagField: string | undefined;

  function readWildcard(): boolean {
    return wildcard;
  }

  function markWildcard(): MatchState {
    wildcard = true;
    return state;
  }

  function readBinding(): "bound" | "misplaced" | undefined {
    return binding;
  }

  function markBinding(value: "bound" | "misplaced"): MatchState {
    binding = value;
    return state;
  }

  function readCovered(): ReadonlySet<string> {
    return covered;
  }

  function cover(key: string): MatchState {
    covered = covered.add(key);
    return state;
  }

  function readTagField(): string | undefined {
    return tagField;
  }

  function markTagField(field: string): MatchState {
    tagField = field;
    return state;
  }

  const state: MatchState = {
    wildcard: readWildcard,
    markWildcard: markWildcard,
    binding: readBinding,
    markBinding: markBinding,
    covered: readCovered,
    cover: cover,
    tagField: readTagField,
    markTagField: markTagField,
  };
  return state;
}

/**
 * The values that a match still needs, or undefined when the domain has no
 * coverage rule (the error type and unsupported types).
 */
function missingOf(
  table: TypeTable,
  domain: Domain,
  state: MatchState,
): string[] | undefined {
  const missing: string[] = [];
  if (domain.kind === "option") {
    if (!state.covered().has("some")) missing[missing.length] = "Some(_)";
    if (!state.covered().has("none")) missing[missing.length] = "None";
    return missing;
  }
  if (domain.kind === "nominal") {
    for (const entry of namesOf(table, domain.ids).entries()) {
      const index = entry[0];
      const name = entry[1];
      if (!state.covered().has(`N:${domain.ids[index]}`)) {
        missing[missing.length] = `${name}(_)`;
      }
    }
    return missing;
  }
  if (domain.kind === "literals") {
    for (const value of domain.values) {
      if (!state.covered().has(`L:${JSON.stringify(value)}`)) {
        missing[missing.length] = describeLiteral(value);
      }
    }
    return missing;
  }
  if (domain.kind === "nullable") {
    if (!state.covered().has("L:null")) missing[missing.length] = "null";
    missing[missing.length] = "_";
    return missing;
  }
  if (domain.kind === "open") return ["_"];
  if (domain.kind === "tagged") {
    const field = state.tagField();
    if (field === undefined) {
      return domain.members.length > 0 ? ["a tagged arm"] : [];
    }
    if (domain.members.some((member) => !member.literals.has(field))) {
      return ["_"];
    }
    for (const value of taggedValues(domain.members, field)) {
      if (!state.covered().has(`T:${field}:${JSON.stringify(value)}`)) {
        missing[missing.length] = `{ ${field}: ${describeLiteral(value)} }`;
      }
    }
    return missing;
  }
  return undefined;
}

export type PatternArmCount = number;

export function checkCoverage(
  c: PatternContext,
  node: NodeId,
  domain: Domain,
  state: MatchState,
  armCount: PatternArmCount,
): PatternContext {
  const missing = missingOf(c.table, domain, state);
  if (missing === undefined) return c;
  if (missing.length === 0 && armCount > 0) return c;
  c = c.report(
    "pattern/001",
    missing.length === 0
      ? "the match has no arms"
      : `the match is not exhaustive; it needs ${missing.join(", ")}`,
    node,
  );
  return c;
}

type ReachResult = {
  readonly context: PatternContext;
  readonly reachable: boolean;
};

/** Reports a duplicate or unreachable arm. */
function reach(
  c: PatternContext,
  node: NodeId,
  state: MatchState,
  key: string | undefined,
): ReachResult {
  if (state.wildcard()) {
    c = c.report(
      "pattern/002",
      "this arm is unreachable, because an earlier `_` arm matches every value",
      node,
    );
    return { context: c, reachable: false };
  }
  if (state.binding() === "bound") {
    c = c.report(
      "pattern/002",
      "this arm is unreachable, because an earlier binding arm matches every value except null",
      node,
    );
    return { context: c, reachable: false };
  }
  if (key !== undefined) {
    if (state.covered().has(key)) {
      c = c.report(
        "pattern/002",
        "this arm is unreachable, because an earlier arm matches the same value",
        node,
      );
      return { context: c, reachable: false };
    }
    state = state.cover(key);
  }
  return { context: c, reachable: true };
}

/** A subject that an earlier diagnostic rejected: its arms report nothing more. */
function isSilent(domain: Domain): boolean {
  return domain.kind === "error" || domain.kind === "mixed" ||
    domain.kind === "unsupported";
}

function foreign(
  c: PatternContext,
  node: NodeId,
  what: string,
  domain: Domain,
): PatternContext {
  if (isSilent(domain)) return c;
  c = c.report(
    "pattern/003",
    `${what} does not belong to the subject (${
      describeDomain(c.table, domain)
    })`,
    node,
  );
  return c;
}

type BoundLocal = {
  readonly context: PatternContext;
  readonly binding: LocalId | undefined;
};

function bindLocal(
  c: PatternContext,
  nameNode: NodeId | undefined,
  type: TypeRef,
): BoundLocal {
  if (nameNode === undefined) return { context: c, binding: undefined };
  const target = c.targets.get(nameNode);
  if (target?.kind !== "local") {
    return { context: c, binding: undefined };
  }
  c = c.recordLocal(target.id, type);
  return { context: c, binding: target.id };
}

function patternFact(
  c: PatternContext,
  node: NodeId,
  pattern: PatternFact,
): PatternContext {
  return c.fact(node, { kind: "pattern", pattern: pattern });
}

export function pattern(
  c: PatternContext,
  node: NodeId,
  domain: Domain,
  state: MatchState,
): PatternContext {
  const kind = kindOf(c.tree, node);
  const names = c.kidsOfKind(node, SyntaxKind.Name);
  if (kind === SyntaxKind.WildcardPattern) {
    const reached = reach(c, node, state, undefined);
    c = reached.context;
    if (reached.reachable) {
      const needed = missingOf(c.table, domain, state);
      if (needed !== undefined && needed.length === 0) {
        c = c.report(
          "pattern/002",
          "this arm is unreachable, because the earlier arms already cover every value",
          node,
        );
      }
    }
    state = state.markWildcard();
    c = patternFact(c, node, { kind: "wildcard" });
    return c;
  }
  if (kind === SyntaxKind.NamePattern) {
    const target = names[0] === undefined ? undefined : c.targets.get(names[0]);
    if (optionConstructorOf(target) === "none") {
      if (domain.kind === "option") {
        c = reach(c, node, state, "none").context;
      } else {
        c = foreign(c, node, "`None`", domain);
      }
      c = patternFact(c, node, { kind: "none" });
    } else if (target?.kind === "local") {
      c = bindingArm(c, node, names[0], domain, state);
    } else {
      if (target !== undefined && target.kind !== "unresolved") {
        c = c.report(
          "pattern/004",
          "a constructor pattern needs a binding, as in `Some(x)` or `E(x)`",
          node,
        );
      }
      c = patternFact(c, node, { kind: "invalid" });
    }
    return c;
  }
  if (kind === SyntaxKind.CtorPattern) {
    const target = names[0] === undefined ? undefined : c.targets.get(names[0]);
    const bindingNode = names[1];
    if (optionConstructorOf(target) === "some") {
      let element = c.table.error;
      if (domain.kind === "option") {
        element = domain.element;
        c = reach(c, node, state, "some").context;
      } else {
        c = foreign(c, node, "`Some`", domain);
      }
      const bound = bindLocal(c, bindingNode, element);
      c = bound.context;
      c = patternFact(c, node, { kind: "some", binding: bound.binding });
    } else if (target?.kind === "builtin") {
      c = c.report(
        "pattern/004",
        `\`${target.name}\` cannot be a constructor pattern with a binding`,
        node,
      );
      c = bindLocal(c, bindingNode, c.table.error).context;
      c = patternFact(c, node, { kind: "invalid" });
    } else if (
      target?.kind === "error" ||
      (target?.kind === "type" &&
        c.table.taggedRecordOf(target.id) !== undefined)
    ) {
      let type = c.table.error;
      if (domain.kind === "nominal" && domain.ids.includes(target.id)) {
        type = c.table.named(target.id);
        c = reach(c, node, state, `N:${target.id}`).context;
      } else {
        c = foreign(
          c,
          node,
          `\`${namesOf(c.table, [target.id])[0]}\``,
          domain,
        );
      }
      const bound = bindLocal(c, bindingNode, type);
      c = bound.context;
      c = patternFact(
        c,
        node,
        target.kind === "error"
          ? { kind: "error", error: target.id, binding: bound.binding }
          : { kind: "tagged", tagged: target.id, binding: bound.binding },
      );
    } else {
      // The resolver already reported a missing or wrong-kind name.
      if (target !== undefined && target.kind !== "unresolved") {
        c = c.report("pattern/004", ctorMessage(c, target), node);
      }
      c = bindLocal(c, bindingNode, c.table.error).context;
      c = patternFact(c, node, { kind: "invalid" });
    }
    return c;
  }
  if (kind === SyntaxKind.LiteralPattern) {
    const value = literalOf(c.tree, node);
    if (value === undefined) {
      c = patternFact(c, node, { kind: "invalid" });
      return c;
    }
    const text = numberTextOf(c.tree, node);
    if (
      text !== undefined && isDurationText(text) &&
      typeof value === "number"
    ) {
      const fitsDuration = domain.kind === "open" && domain.duration;
      if (fitsDuration) {
        c = reach(c, node, state, `L:${JSON.stringify(value)}`).context;
      } else {
        c = foreign(c, node, text, domain);
      }
      c = patternFact(c, node, {
        kind: "duration",
        millis: value,
        text: text,
      });
      return c;
    }
    let fits = false;
    if (domain.kind === "nullable") {
      fits = value === null;
    } else if (domain.kind === "literals") {
      fits = domain.values.includes(value);
    } else if (domain.kind === "open" && !domain.duration) {
      fits = literalFitsPrimitive(value, domain.primitive);
    }
    if (fits) {
      c = reach(c, node, state, `L:${JSON.stringify(value)}`).context;
    } else {
      c = foreign(c, node, describeLiteral(value), domain);
    }
    c = patternFact(c, node, { kind: "literal", value: value });
    return c;
  }
  if (kind === SyntaxKind.RecordPattern) {
    return recordPattern(c, node, domain, state);
  }
  return patternFact(c, node, { kind: "invalid" });
}

/** A bare name arm. It binds the subject without `null`, after the `null` arm of a nullable union. */
function bindingArm(
  c: PatternContext,
  node: NodeId,
  nameNode: NodeId,
  domain: Domain,
  state: MatchState,
): PatternContext {
  if (domain.kind !== "nullable") {
    if (!isSilent(domain)) {
      c = c.report(
        "pattern/004",
        `\`${
          nameTextOf(c.tree, nameNode)
        }\` is not a constructor; a binding arm applies only after the \`null\` arm of a nullable union`,
        node,
      );
    }
    c = bindLocal(c, nameNode, c.table.error).context;
    return patternFact(c, node, { kind: "invalid" });
  }
  if (!state.covered().has("L:null")) {
    c = c.report(
      "pattern/004",
      "a binding arm must come after the `null` arm",
      node,
    );
    state = state.markBinding("misplaced");
    c = bindLocal(c, nameNode, c.table.error).context;
    return patternFact(c, node, { kind: "invalid" });
  }
  const reached = reach(c, node, state, undefined);
  c = reached.context;
  if (reached.reachable) state = state.markBinding("bound");
  const bound = bindLocal(c, nameNode, domain.rest);
  c = bound.context;
  return patternFact(c, node, { kind: "bind", binding: bound.binding });
}

function recordPattern(
  c: PatternContext,
  node: NodeId,
  domain: Domain,
  state: MatchState,
): PatternContext {
  const parts = c.kids(node);
  const fields = parts.filter((k) =>
    kindOf(c.tree, k) === SyntaxKind.PatternField
  );
  const spread = parts.find((k) =>
    kindOf(c.tree, k) === SyntaxKind.SpreadPattern
  );
  const spreadName = spread === undefined
    ? undefined
    : c.kidsOfKind(spread, SyntaxKind.Name)[0];
  function invalid(message: string | undefined): PatternContext {
    if (message !== undefined) c = c.report("pattern/004", message, node);
    c = bindLocal(c, spreadName, c.table.error).context;
    return patternFact(c, node, { kind: "invalid" });
  }
  if (domain.kind === "nominal") {
    return invalid(
      `a record pattern does not apply to ${
        describeDomain(c.table, domain)
      }; match each by name, as in \`Name(x)\``,
    );
  }
  if (domain.kind !== "tagged") {
    c = foreign(c, node, "a tagged record pattern", domain);
    return invalid(undefined);
  }
  if (fields.length !== 1) {
    return invalid(
      'a tagged record pattern needs exactly one discriminator field, as in `{ kind: "circle", ...c }`',
    );
  }
  const fieldParts = c.kids(fields[0]);
  const labelNode = fieldParts.find((k) =>
    kindOf(c.tree, k) === SyntaxKind.Name
  );
  const literalNode = fieldParts.find((k) =>
    kindOf(c.tree, k) === SyntaxKind.LiteralPattern
  );
  const label = labelNode === undefined
    ? undefined
    : nameTextOf(c.tree, labelNode);
  const value = literalNode === undefined
    ? undefined
    : literalOf(c.tree, literalNode);
  if (label === undefined || value === undefined) return invalid(undefined);
  if (typeof value !== "string") {
    return invalid(
      "the discriminator of a tagged record pattern must be a string literal",
    );
  }
  if (state.tagField() !== undefined && state.tagField() !== label) {
    return invalid(
      `an earlier arm matches on the field \`${state.tagField()}\`; every arm must use the same discriminator field`,
    );
  }
  state = state.markTagField(label);
  const known = taggedValues(domain.members, label);
  const narrowed = narrowTagged(c.table, domain.members, label, value).map(
    (m) => m.type,
  );
  if (narrowed.length === 0) {
    c = foreign(
      c,
      node,
      known.length === 0
        ? `the field \`${label}\``
        : `${label}: ${describeLiteral(value)}`,
      domain,
    );
    return invalid(undefined);
  }
  c = reach(c, node, state, `T:${label}:${JSON.stringify(value)}`).context;
  const bound = bindLocal(c, spreadName, c.table.union(narrowed));
  c = bound.context;
  return patternFact(c, node, {
    kind: "tag",
    field: label,
    value: value,
    binding: bound.binding ?? null,
  });
}

/** The names of types or errors, with module names where two share a short name. */
function namesOf(
  table: TypeTable,
  ids: readonly (TypeId | ErrorId)[],
): readonly string[] {
  return showTypes(table, ids.map((id) => table.named(id)));
}

/** Why a name that is not a tagged record or an error cannot be a constructor pattern. */
function ctorMessage(c: PatternContext, target: Target): string {
  if (target.kind !== "type") {
    return `\`${targetText(target)}\` cannot be a constructor pattern`;
  }
  const name = namesOf(c.table, [target.id])[0];
  if (c.table.isOpaque(target.id)) {
    return `\`${name}\` is an opaque type, not a tagged record; a constructor pattern names a tagged record or an error`;
  }
  const base = c.table.identityBaseOf(target.id);
  if (base === undefined) {
    return `\`${name}\` is a type alias, not a tagged record; a constructor pattern names a tagged record or an error`;
  }
  return c.table.node(c.table.unfold(base)).kind === "record"
    ? `\`${name}\` has no runtime tag; no union alias of its module lists it`
    : `\`${name}\` is a type with a non-record body; a constructor pattern names a tagged record or an error`;
}

function describeDomain(table: TypeTable, domain: Domain): string {
  if (domain.kind === "option") return "an option";
  if (domain.kind === "nominal") {
    const category = domain.ids.every(isErrorId) ? "the errors" : "the names";
    return `${category} ${namesOf(table, domain.ids).join(" | ")}`;
  }
  if (domain.kind === "nullable") {
    return `the nullable union ${showTypes(table, [domain.subject])[0]}`;
  }
  if (domain.kind === "tagged") return "a tagged record union";
  if (domain.kind === "literals") {
    return `the values ${domain.values.map(describeLiteral).join(" | ")}`;
  }
  if (domain.kind === "open") {
    return domain.duration ? "a Duration" : `a ${domain.primitive}`;
  }
  return "an unsupported type";
}
