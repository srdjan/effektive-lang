// Kind guards that the checker `TypeNode` of types.ts and the IR `Type` of
// ir.ts share: the deferred kinds, and the container kinds with their child types.

/**
 * The type kinds that have no schema and no runtime value: functions and the
 * effectful or handle types. The type printers throw for them, and an alias
 * that contains one is type-only.
 */
export type DeferredKind =
  | "function"
  | "effect"
  | "stream"
  | "sink"
  | "provider"
  | "ref"
  | "retry-schedule"
  | "schema";
const DEFERRED_KINDS: Record<DeferredKind, true> = {
  "function": true,
  "effect": true,
  "stream": true,
  "sink": true,
  "provider": true,
  "ref": true,
  "retry-schedule": true,
  "schema": true,
};
/**
 * True for a node of a deferred kind. The node is an IR `Type` or a checker
 * `TypeNode`. After this guard fails, a chain of `kind ===` tests over the
 * rest of the kinds is exhaustive, so a new kind is a compile error there.
 */
export function isDeferredKind<T extends { readonly kind: string }>(
  node: T,
): node is Extract<T, { readonly kind: DeferredKind }> {
  return Object.hasOwn(DEFERRED_KINDS, node.kind);
}

/** The kinds of a record, an array, an option, a tuple, and a union: the kinds whose children are types. */
export type ContainerKind = "record" | "array" | "option" | "tuple" | "union";
/** A node of a `ContainerKind`, in an IR `Type` or a checker `TypeNode`. `C` is the child type. */
export type ContainerNode<C> =
  | {
    readonly kind: "record";
    readonly fields: readonly { readonly type: C }[];
  }
  | { readonly kind: "array"; readonly element: C }
  | { readonly kind: "option"; readonly element: C }
  | { readonly kind: "tuple"; readonly elements: readonly C[] }
  | { readonly kind: "union"; readonly members: readonly C[] };
const CONTAINER_KINDS: Record<ContainerKind, true> = {
  "record": true,
  "array": true,
  "option": true,
  "tuple": true,
  "union": true,
};
/** True for a node of a `ContainerKind`. After this guard fails, a chain of `kind ===` tests over the rest of the kinds is exhaustive. */
export function isContainerKind<T extends { readonly kind: string }>(
  node: T,
): node is Extract<T, { readonly kind: ContainerKind }> {
  return Object.hasOwn(CONTAINER_KINDS, node.kind);
}
/** The child types of a container node, in order: the fields of a record, the element, the elements, or the members. */
export function childTypes<C>(node: ContainerNode<C>): readonly C[] {
  if (node.kind === "record") return node.fields.map((field) => field.type);
  if (node.kind === "array" || node.kind === "option") return [node.element];
  if (node.kind === "tuple") return node.elements;
  return node.members;
}
