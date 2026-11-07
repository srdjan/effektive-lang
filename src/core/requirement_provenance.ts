import type { ModuleResolution } from "./resolve.ts";
import type { CapabilityId, LocalId } from "./ir.ts";
import {
  argNodes,
  arrowBody,
  initOf,
  kidsOf,
  memberAccessParts,
  nameTextOf,
  pipeParts,
  unparen,
} from "./syntax_queries.ts";
import { kindOf, type NodeId, SyntaxKind, type SyntaxTree } from "./syntax.ts";
import type { BodyTable } from "./tables.ts";
import type { TypeReader, TypeRef } from "./types.ts";
import { isTypeId } from "./ids.ts";

/** Adds requirements carried by values that a type produces. */
export function producedRequirements(
  table: TypeReader,
  ref: TypeRef,
  into: Set<CapabilityId>,
  seen = new Set<TypeRef>(),
): void {
  if (seen.has(ref)) return;
  seen.add(ref);
  const node = table.node(ref);
  const visit = (child: TypeRef): void =>
    producedRequirements(table, child, into, seen);
  const add = (requirements: readonly CapabilityId[]): void => {
    for (const requirement of requirements) into.add(requirement);
  };
  switch (node.kind) {
    case "named": {
      const target = isTypeId(node.id) ? table.aliasOf(node.id) : undefined;
      if (target !== undefined) visit(target);
      return;
    }
    case "record":
      for (const field of node.fields) visit(field.type);
      return;
    case "array":
    case "option":
    case "ref":
      visit(node.element);
      return;
    case "tuple":
      for (const element of node.elements) visit(element);
      return;
    case "union":
      for (const member of node.members) visit(member);
      return;
    case "schema":
      add(node.decodeRequirements);
      add(node.encodeRequirements);
      visit(node.decoded);
      visit(node.encoded);
      return;
    case "effect":
      add(node.requirements);
      visit(node.result);
      return;
    case "stream":
      add(node.requirements);
      visit(node.element);
      return;
    case "sink":
      add(node.requirements);
      visit(node.result);
      visit(node.leftover);
      return;
    case "function":
      add(node.requirements);
      visit(node.result);
      return;
    case "provider":
      add(node.requirements);
      return;
    case "primitive":
    case "literal":
    case "retry-schedule":
    case "error":
      return;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

interface TransferInputs {
  readonly table: TypeReader;
  readonly tree: SyntaxTree;
  readonly resolution: ModuleResolution;
  readonly body: BodyTable;
  readonly parameters: readonly (LocalId | undefined)[];
}

interface Initializer {
  readonly node: NodeId;
  readonly field?: string;
}

/** Adds locally produced requirements passed to calls or stored through references. */
export function transferredRequirements(
  inputs: TransferInputs,
  into: Set<CapabilityId>,
): void {
  const { table, tree, resolution, body } = inputs;
  const parameters = new Set(
    inputs.parameters.filter((id): id is LocalId => id !== undefined),
  );
  const initializers = new Map<LocalId, Initializer>();
  for (const [node, fact] of body.facts) {
    if (fact.kind === "arrow") {
      for (const parameter of fact.parameters) {
        if (parameter.id !== undefined) parameters.add(parameter.id);
      }
      continue;
    }
    if (fact.kind !== "binding" && fact.kind !== "record-binding") continue;
    const init = initOf(tree, node, undefined);
    if (init === undefined) continue;
    if (fact.kind === "binding") {
      if (fact.id !== undefined) initializers.set(fact.id, { node: init });
      continue;
    }
    for (const field of fact.fields) {
      if (field.binding.id !== undefined) {
        initializers.set(field.binding.id, { node: init, field: field.name });
      }
    }
  }

  const argsOf = (node: NodeId): NodeId[] => {
    const args = argNodes(tree, node);
    if (kindOf(tree, node) === SyntaxKind.PipeStage) {
      const { left } = pipeParts(tree, tree.parents[node]);
      if (left !== undefined) args.unshift(left);
    }
    return args;
  };

  const originOf = (start: NodeId): NodeId | undefined => {
    let node: NodeId | undefined = start;
    const seen = new Set<NodeId>();
    const fields: string[] = [];
    while (node !== undefined) {
      node = unparen(tree, node);
      if (seen.has(node)) return undefined;
      seen.add(node);
      const target = resolution.targets.get(node);
      const init = target?.kind === "local"
        ? initializers.get(target.id)
        : undefined;
      if (init !== undefined) {
        if (init.field !== undefined) fields.push(init.field);
        node = init.node;
        continue;
      }
      if (kindOf(tree, node) === SyntaxKind.FieldExpr) {
        const { base, member: label } = memberAccessParts(tree, node);
        const name = label === undefined ? undefined : nameTextOf(tree, label);
        if (name === undefined) return node;
        fields.push(name);
        node = base;
        continue;
      }
      if (fields.length > 0 && kindOf(tree, node) === SyntaxKind.RecordExpr) {
        const entries = kidsOf(tree, node);
        const name = fields[fields.length - 1];
        const field = entries.find((entry) => {
          const label = kidsOf(tree, entry)[0];
          return label !== undefined && nameTextOf(tree, label) === name;
        });
        if (field !== undefined) {
          fields.pop();
          const children = kidsOf(tree, field);
          node = kindOf(tree, field) === SyntaxKind.ShorthandField
            ? children[0]
            : children.at(-1);
          continue;
        }
        const spread = entries.find((entry) =>
          kindOf(tree, entry) === SyntaxKind.SpreadField
        );
        if (spread === undefined) return node;
        node = kidsOf(tree, spread)[0];
        continue;
      }
      return node;
    }
    return undefined;
  };

  const inputOnly = (start: NodeId): boolean => {
    let node: NodeId | undefined = start;
    const seen = new Set<NodeId>();
    while (node !== undefined) {
      node = originOf(node);
      if (node === undefined || seen.has(node)) return false;
      seen.add(node);
      const target = resolution.targets.get(node);
      if (target?.kind === "local" && parameters.has(target.id)) return true;
      if (kindOf(tree, node) === SyntaxKind.FieldExpr) {
        node = kidsOf(tree, node)[0];
      } else if (body.facts.get(node)?.kind === "get-ref") {
        node = argsOf(node)[0];
      } else {
        return false;
      }
    }
    return false;
  };

  const seenTypes = new Set<TypeRef>();
  const addType = (node: NodeId): void => {
    const info = body.info.get(node);
    if (info !== undefined) {
      producedRequirements(table, info.type, into, seenTypes);
    }
  };
  const addValue = (
    start: NodeId | undefined,
    trail = new Set<NodeId>(),
    fallback?: NodeId,
  ): void => {
    if (start === undefined || inputOnly(start)) return;
    const root = fallback ?? start;
    const origin = originOf(start);
    if (origin === undefined) {
      addType(root);
      return;
    }
    const node = unparen(tree, origin);
    if (trail.has(node)) {
      addType(root);
      return;
    }
    const nextTrail = new Set(trail);
    nextTrail.add(node);
    switch (kindOf(tree, node)) {
      case SyntaxKind.RecordExpr: {
        const fields = kidsOf(tree, node);
        let needsFallback = fields.length === 0;
        for (const field of fields) {
          const children = kidsOf(tree, field);
          const child = kindOf(tree, field) === SyntaxKind.RecordField
            ? children[1]
            : children[0];
          if (child === undefined) needsFallback = true;
          else addValue(child, nextTrail, root);
        }
        if (needsFallback) addType(root);
        return;
      }
      case SyntaxKind.ListExpr: {
        const elements = kidsOf(tree, node);
        if (elements.length === 0) addType(root);
        for (const element of elements) addValue(element, nextTrail, root);
        return;
      }
      case SyntaxKind.Block:
        addValue(kidsOf(tree, node).at(-1), nextTrail, root);
        return;
      default:
        addType(node);
    }
  };

  for (const [node, fact] of body.facts) {
    if (fact.kind === "call" || fact.kind === "perform") {
      for (const arg of argsOf(node)) addValue(arg);
    } else if (fact.kind === "set-ref") {
      addValue(argsOf(node)[1]);
    } else if (fact.kind === "update-ref") {
      const callback = argsOf(node)[1];
      if (callback === undefined || inputOnly(callback)) continue;
      const origin = originOf(callback);
      if (origin === undefined) {
        addValue(callback);
        continue;
      }
      if (body.facts.get(origin)?.kind === "arrow") {
        addValue(arrowBody(tree, origin));
        continue;
      }
      const info = body.info.get(callback);
      if (info === undefined) continue;
      const type = table.node(table.unfold(info.type));
      if (type.kind === "function") {
        producedRequirements(table, type.result, into, seenTypes);
      }
    }
  }
}
