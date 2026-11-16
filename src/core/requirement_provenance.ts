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
import { emptyMap, emptySet, indices, setFrom } from "./runtime.ts";
/** Adds requirements carried by values that a type produces. */
export function producedRequirements(
  table: TypeReader,
  ref: TypeRef,
  into: Set<CapabilityId>,
  seen: Set<TypeRef> | undefined,
): Set<CapabilityId> {
  let visited = seen ?? emptySet<TypeRef>();
  if (visited.has(ref)) {
    return into;
  }
  visited = visited.add(ref);
  const node = table.node(ref);
  function visit(child: TypeRef): Set<CapabilityId> {
    return producedRequirements(table, child, into, visited);
  }
  function add(requirements: readonly CapabilityId[]): Set<CapabilityId> {
    for (const requirement of requirements) {
      into = into.add(requirement);
    }
    return into;
  }
  if (node.kind === "named") {
    const target = isTypeId(node.id) ? table.aliasOf(node.id) : undefined;
    if (target !== undefined) {
      into = visit(target);
    }
    return into;
  }
  if (node.kind === "record") {
    for (const field of node.fields) {
      into = visit(field.type);
    }
    return into;
  }
  if (node.kind === "array" || node.kind === "option" || node.kind === "ref") {
    into = visit(node.element);
    return into;
  }
  if (node.kind === "tuple") {
    for (const element of node.elements) {
      into = visit(element);
    }
    return into;
  }
  if (node.kind === "union") {
    for (const member of node.members) {
      into = visit(member);
    }
    return into;
  }
  if (node.kind === "schema") {
    into = add(node.decodeRequirements);
    into = add(node.encodeRequirements);
    into = visit(node.decoded);
    into = visit(node.encoded);
    return into;
  }
  if (node.kind === "effect") {
    into = add(node.requirements);
    into = visit(node.result);
    return into;
  }
  if (node.kind === "stream") {
    into = add(node.requirements);
    into = visit(node.element);
    return into;
  }
  if (node.kind === "sink") {
    into = add(node.requirements);
    into = visit(node.result);
    into = visit(node.leftover);
    return into;
  }
  if (node.kind === "function") {
    into = add(node.requirements);
    into = visit(node.result);
    return into;
  }
  if (node.kind === "provider") {
    into = add(node.requirements);
    return into;
  }
  if (
    node.kind === "primitive" || node.kind === "literal" ||
    node.kind === "retry-schedule" || node.kind === "error"
  ) {
    return into;
  }
  const unreachable: never = node;
  return unreachable;
}
type TransferInputs = {
  readonly table: TypeReader;
  readonly tree: SyntaxTree;
  readonly resolution: ModuleResolution;
  readonly body: BodyTable;
  readonly parameters: readonly (LocalId | undefined)[];
};
type Initializer = {
  readonly node: NodeId;
  readonly field?: string;
};
/** Adds locally produced requirements passed to calls or stored through references. */
export function transferredRequirements(
  inputs: TransferInputs,
  into: Set<CapabilityId>,
): Set<CapabilityId> {
  const table = inputs.table;
  const tree = inputs.tree;
  const resolution = inputs.resolution;
  const body = inputs.body;
  let parameters = setFrom(
    inputs.parameters.filter((id): id is LocalId => id !== undefined),
  );
  let initializers = emptyMap<LocalId, Initializer>();
  for (const entry of body.facts) {
    const node = entry[0];
    const fact = entry[1];
    if (fact.kind === "arrow") {
      for (const parameter of fact.parameters) {
        if (parameter.id !== undefined) {
          parameters = parameters.add(parameter.id);
        }
      }
      continue;
    }
    if (fact.kind !== "binding" && fact.kind !== "record-binding") {
      continue;
    }
    const init = initOf(tree, node, undefined);
    if (init === undefined) {
      continue;
    }
    if (fact.kind === "binding") {
      if (fact.id !== undefined) {
        initializers = initializers.set(fact.id, { node: init });
      }
      continue;
    }
    for (const field of fact.fields) {
      if (field.binding.id !== undefined) {
        initializers = initializers.set(field.binding.id, {
          node: init,
          field: field.name,
        });
      }
    }
  }
  function argsOf(node: NodeId): NodeId[] {
    const args = argNodes(tree, node);
    if (kindOf(tree, node) === SyntaxKind.PipeStage) {
      const left = pipeParts(tree, tree.parents[node]).left;
      if (left !== undefined) {
        return [left, ...args];
      }
    }
    return args;
  }
  function originOf(start: NodeId): NodeId | undefined {
    let node: NodeId | undefined = start;
    let seen = emptySet<NodeId>();
    const fields: string[] = [];
    for (const _index of indices(tree.count + 1)) {
      if (node === undefined) {
        break;
      }
      node = unparen(tree, node);
      if (seen.has(node)) {
        return undefined;
      }
      seen = seen.add(node);
      const target = resolution.targets.get(node);
      const init = target?.kind === "local"
        ? initializers.get(target.id)
        : undefined;
      if (init !== undefined) {
        if (init.field !== undefined) {
          fields[fields.length] = init.field;
        }
        node = init.node;
        continue;
      }
      if (kindOf(tree, node) === SyntaxKind.FieldExpr) {
        const parts = memberAccessParts(tree, node);
        const base = parts.base;
        const label = parts.member;
        const name = label === undefined ? undefined : nameTextOf(tree, label);
        if (name === undefined) {
          return node;
        }
        fields[fields.length] = name;
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
          fields.length = fields.length - 1;
          const children = kidsOf(tree, field);
          node = kindOf(tree, field) === SyntaxKind.ShorthandField
            ? children[0]
            : children.at(-1);
          continue;
        }
        const spread = entries.find((entry) =>
          kindOf(tree, entry) === SyntaxKind.SpreadField
        );
        if (spread === undefined) {
          return node;
        }
        node = kidsOf(tree, spread)[0];
        continue;
      }
      return node;
    }
    return undefined;
  }
  function inputOnly(start: NodeId): boolean {
    let node: NodeId | undefined = start;
    let seen = emptySet<NodeId>();
    for (const _index of indices(tree.count + 1)) {
      if (node === undefined) {
        break;
      }
      node = originOf(node);
      if (node === undefined || seen.has(node)) {
        return false;
      }
      seen = seen.add(node);
      const target = resolution.targets.get(node);
      if (target?.kind === "local" && parameters.has(target.id)) {
        return true;
      }
      if (kindOf(tree, node) === SyntaxKind.FieldExpr) {
        node = kidsOf(tree, node)[0];
      } else if (body.facts.get(node)?.kind === "get-ref") {
        node = argsOf(node)[0];
      } else {
        return false;
      }
    }
    return false;
  }
  const seenTypes = emptySet<TypeRef>();
  function addType(node: NodeId): Set<CapabilityId> {
    const info = body.info.get(node);
    if (info !== undefined) {
      into = producedRequirements(table, info.type, into, seenTypes);
    }
    return into;
  }
  function addValue(
    start: NodeId | undefined,
    trail: ReadonlySet<NodeId>,
    fallback: NodeId | undefined,
  ): Set<CapabilityId> {
    if (start === undefined || inputOnly(start)) {
      return into;
    }
    const root = fallback ?? start;
    const origin = originOf(start);
    if (origin === undefined) {
      into = addType(root);
      return into;
    }
    const node = unparen(tree, origin);
    if (trail.has(node)) {
      into = addType(root);
      return into;
    }
    const nextTrail = setFrom([...trail, node]);
    const kind = kindOf(tree, node);
    if (kind === SyntaxKind.RecordExpr) {
      const fields = kidsOf(tree, node);
      let needsFallback = fields.length === 0;
      for (const field of fields) {
        const children = kidsOf(tree, field);
        const child = kindOf(tree, field) === SyntaxKind.RecordField
          ? children[1]
          : children[0];
        if (child === undefined) {
          needsFallback = true;
        } else {
          into = addValue(child, nextTrail, root);
        }
      }
      if (needsFallback) {
        into = addType(root);
      }
      return into;
    }
    if (kind === SyntaxKind.ListExpr) {
      const elements = kidsOf(tree, node);
      if (elements.length === 0) {
        into = addType(root);
      }
      for (const element of elements) {
        const value = kindOf(tree, element) === SyntaxKind.SpreadElement
          ? kidsOf(tree, element)[0]
          : element;
        into = addValue(value, nextTrail, root);
      }
      return into;
    }
    if (kind === SyntaxKind.Block) {
      into = addValue(kidsOf(tree, node).at(-1), nextTrail, root);
      return into;
    }
    into = addType(node);
    return into;
  }
  for (const entry of body.facts) {
    const node = entry[0];
    const fact = entry[1];
    if (fact.kind === "call" || fact.kind === "perform") {
      for (const arg of argsOf(node)) {
        into = addValue(arg, emptySet<NodeId>(), undefined);
      }
    } else if (fact.kind === "set-ref") {
      into = addValue(argsOf(node)[1], emptySet<NodeId>(), undefined);
    } else if (fact.kind === "update-ref") {
      const callback = argsOf(node)[1];
      if (callback === undefined || inputOnly(callback)) {
        continue;
      }
      const origin = originOf(callback);
      if (origin === undefined) {
        into = addValue(callback, emptySet<NodeId>(), undefined);
        continue;
      }
      if (body.facts.get(origin)?.kind === "arrow") {
        into = addValue(arrowBody(tree, origin), emptySet<NodeId>(), undefined);
        continue;
      }
      const info = body.info.get(callback);
      if (info === undefined) {
        continue;
      }
      const type = table.node(table.unfold(info.type));
      if (type.kind === "function") {
        into = producedRequirements(table, type.result, into, seenTypes);
      }
    }
  }
  return into;
}
