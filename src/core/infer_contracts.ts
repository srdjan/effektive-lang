import { emptyMap, emptySet } from "./runtime.ts";
import type { LocalId } from "./ir.ts";
import type { NodeId } from "./syntax.ts";
import type { TypeRef, TypeTable } from "./types.ts";
type Root = {
  readonly id: LocalId;
  readonly name: string;
};
export type Origin = {
  readonly root: Root;
  readonly path: readonly string[];
};
type Demand = {
  readonly path: readonly string[];
  readonly type: TypeRef;
  readonly node: NodeId;
};
type DeferredCall = {
  readonly origin: Origin;
  readonly callee: NodeId;
  readonly applyContract: (evidence: CallableEvidence) => boolean;
};
export type CallableEvidence = {
  readonly kind: "callable";
  readonly parameters: readonly (TypeRef | undefined)[];
  readonly result: TypeRef | undefined;
  readonly checked: readonly boolean[] | undefined;
};
type ContractIssue = {
  readonly kind: "unresolved-call";
  readonly rootName: string;
  readonly node: NodeId;
} | {
  readonly kind: "conflicting-requirements";
  readonly rootName: string;
  readonly path: readonly string[];
  readonly candidates: readonly TypeRef[];
  readonly node: NodeId;
};
type Resolution = {
  readonly types: readonly TypeRef[];
  readonly issues: readonly ContractIssue[];
};
type RecordFieldShape = {
  readonly name: string;
  readonly type: TypeRef;
  readonly optional: boolean;
};
export type InputContractResolver = {
  readonly origin: (id: LocalId) => Origin | undefined;
  readonly setOrigin: (id: LocalId, origin: Origin) => InputContractResolver;
  readonly isConcrete: (type: TypeRef | undefined) => type is TypeRef;
  readonly callableEvidence: (
    type: TypeRef | undefined,
  ) => CallableEvidence | undefined;
  readonly fieldType: (
    type: TypeRef | undefined,
    name: string,
  ) => TypeRef | undefined;
  readonly demand: (
    origin: Origin | undefined,
    type: TypeRef | undefined,
    node: NodeId,
  ) => InputContractResolver;
  readonly defer: (
    origin: Origin,
    callee: NodeId,
    applyContract: (evidence: CallableEvidence) => boolean,
  ) => InputContractResolver;
  readonly finish: (
    parameters: readonly {
      readonly id: LocalId | undefined;
      readonly type: TypeRef;
      readonly inferred: boolean;
    }[],
  ) => Resolution;
};
export function InputContractResolver(
  table: TypeTable,
  roots: readonly Root[],
): InputContractResolver {
  const inputContractResolverTable = table;
  let inputContractResolverOrigins = emptyMap<LocalId, Origin>();
  let inputContractResolverDemands = emptyMap<LocalId, Demand[]>();
  let inputContractResolverDeferredCalls = emptyMap<LocalId, DeferredCall[]>();
  let inputContractResolverDeferredCallsByCallee = emptyMap<
    NodeId,
    DeferredCall
  >();
  const inputContractResolverPendingCalls: DeferredCall[] = [];
  let inputContractResolverQueuedCalls = emptySet<DeferredCall>();
  let inputContractResolverProcessed = emptyMap<
    DeferredCall,
    Set<TypeRef>
  >();
  for (const root of roots) {
    inputContractResolverOrigins = inputContractResolverOrigins.set(root.id, {
      root: root,
      path: [],
    });
  }
  function inputContractResolverOrigin(id: LocalId): Origin | undefined {
    return inputContractResolverOrigins.get(id);
  }
  function inputContractResolverSetOrigin(
    id: LocalId,
    origin: Origin,
  ): InputContractResolver {
    inputContractResolverOrigins = inputContractResolverOrigins.set(id, origin);
    return inputContractResolverSelf;
  }
  function inputContractResolverIsConcrete(
    type: TypeRef | undefined,
  ): type is TypeRef {
    if (type === undefined || type === inputContractResolverTable.unknown) {
      return false;
    }
    return inputContractResolverTable.node(type).kind !== "error";
  }
  function inputContractResolverCallableEvidence(
    type: TypeRef | undefined,
  ): CallableEvidence | undefined {
    if (type === undefined) {
      return undefined;
    }
    const node = inputContractResolverTable.node(
      inputContractResolverTable.unfold(type),
    );
    return node.kind === "function"
      ? {
        kind: "callable",
        parameters: node.parameters,
        result: node.result,
        checked: node.checked,
      }
      : undefined;
  }
  function inputContractResolverFieldType(
    type: TypeRef | undefined,
    name: string,
  ): TypeRef | undefined {
    if (!inputContractResolverIsConcrete(type)) {
      return undefined;
    }
    return inputContractResolverRecordFields(type)?.find((field) =>
      field.name === name
    )?.type;
  }
  function inputContractResolverDemand(
    origin: Origin | undefined,
    type: TypeRef | undefined,
    node: NodeId,
  ): InputContractResolver {
    if (
      origin === undefined ||
      (!inputContractResolverIsConcrete(type) && origin.path.length === 0)
    ) {
      return inputContractResolverSelf;
    }
    const list = inputContractResolverDemands.get(origin.root.id) ?? [];
    const demand = {
      path: origin.path,
      type: inputContractResolverIsConcrete(type)
        ? type
        : inputContractResolverTable.unknown,
      node: node,
    };
    if (
      list.some((candidate) =>
        candidate.type === demand.type && candidate.node === demand.node &&
        candidate.path.length === demand.path.length &&
        candidate.path.every((field, index) => field === demand.path[index])
      )
    ) {
      return inputContractResolverSelf;
    }
    list[list.length] = demand;
    inputContractResolverDemands = inputContractResolverDemands.set(
      origin.root.id,
      list,
    );
    for (
      const call of inputContractResolverDeferredCalls.get(origin.root.id) ?? []
    ) {
      inputContractResolverQueuedCalls = inputContractResolverEnqueue(call);
    }
    return inputContractResolverSelf;
  }
  function inputContractResolverDefer(
    origin: Origin,
    callee: NodeId,
    applyContract: (evidence: CallableEvidence) => boolean,
  ): InputContractResolver {
    const existing = inputContractResolverDeferredCallsByCallee.get(callee);
    if (existing !== undefined) {
      inputContractResolverQueuedCalls = inputContractResolverEnqueue(existing);
      return inputContractResolverSelf;
    }
    const call: DeferredCall = {
      origin: origin,
      callee: callee,
      applyContract: applyContract,
    };
    const calls = inputContractResolverDeferredCalls.get(origin.root.id) ?? [];
    calls[calls.length] = call;
    inputContractResolverDeferredCalls = inputContractResolverDeferredCalls.set(
      origin.root.id,
      calls,
    );
    inputContractResolverDeferredCallsByCallee =
      inputContractResolverDeferredCallsByCallee.set(callee, call);
    inputContractResolverQueuedCalls = inputContractResolverEnqueue(call);
    return inputContractResolverSelf;
  }
  function inputContractResolverFinish(
    parameters: readonly {
      readonly id: LocalId | undefined;
      readonly type: TypeRef;
      readonly inferred: boolean;
    }[],
  ): Resolution {
    const resolved = inputContractResolverPropagateDeferredCalls();
    const issues: ContractIssue[] = [];
    const types = parameters.map((parameter) => {
      if (!parameter.inferred || parameter.id === undefined) {
        return parameter.type;
      }
      const root = inputContractResolverOrigins.get(parameter.id)?.root;
      const bodyDemands = inputContractResolverDemands.get(parameter.id) ?? [];
      const demands = parameter.type !== inputContractResolverTable.unknown &&
          bodyDemands.length > 0
        ? [
          { path: [], type: parameter.type, node: bodyDemands[0].node },
          ...bodyDemands,
        ]
        : bodyDemands;
      for (
        const call
          of (inputContractResolverDeferredCalls.get(parameter.id) ?? [])
            .filter((candidate) => !resolved.has(candidate))
      ) {
        issues[issues.length] = {
          kind: "unresolved-call",
          rootName: root?.name ?? "input",
          node: call.callee,
        };
      }
      if (root === undefined || demands.length === 0) {
        return parameter.type;
      }
      return inputContractResolverResolve(root, demands, [], issues);
    });
    return { types: types, issues: issues };
  }
  function inputContractResolverEnqueue(call: DeferredCall): Set<DeferredCall> {
    if (inputContractResolverQueuedCalls.has(call)) {
      return inputContractResolverQueuedCalls;
    }
    inputContractResolverPendingCalls[
      inputContractResolverPendingCalls.length
    ] = call;
    return inputContractResolverQueuedCalls.add(call);
  }
  function inputContractResolverPropagateDeferredCalls(): Set<DeferredCall> {
    let resolved = emptySet<DeferredCall>();
    for (const call of inputContractResolverPendingCalls) {
      if (!inputContractResolverQueuedCalls.delete(call)) {
        continue;
      }
      for (const contract of inputContractResolverContractsFor(call.origin)) {
        let processed = inputContractResolverProcessed.get(call) ?? emptySet();
        if (processed.has(contract)) {
          continue;
        }
        processed = processed.add(contract);
        inputContractResolverProcessed = inputContractResolverProcessed.set(
          call,
          processed,
        );
        const evidence = inputContractResolverCallableEvidence(contract);
        if (evidence === undefined) {
          continue;
        }
        if (call.applyContract(evidence)) {
          resolved = resolved.add(call);
        }
      }
    }
    return resolved;
  }
  function inputContractResolverContractsFor(origin: Origin): TypeRef[] {
    let contracts = emptySet<TypeRef>();
    for (
      const demand of inputContractResolverDemands.get(origin.root.id) ?? []
    ) {
      if (
        demand.path.length > origin.path.length ||
        !demand.path.every((field, index) => field === origin.path[index])
      ) {
        continue;
      }
      let contract: TypeRef | undefined = demand.type;
      for (const field of origin.path.slice(demand.path.length)) {
        contract = inputContractResolverFieldType(contract, field);
        if (contract === undefined) {
          break;
        }
      }
      if (contract !== undefined) {
        contracts = contracts.add(contract);
      }
    }
    return [...contracts];
  }
  function inputContractResolverResolve(
    root: Root,
    demands: readonly Demand[],
    path: readonly string[],
    issues: ContractIssue[],
  ): TypeRef {
    let fieldsAtPath = emptyMap<string, Demand[]>();
    const direct = demands.filter((demand) =>
      demand.path.length === path.length
    );
    for (const demand of demands) {
      const name = demand.path[path.length];
      if (name === undefined) {
        continue;
      }
      const fieldDemands = fieldsAtPath.get(name) ?? [];
      fieldDemands[fieldDemands.length] = demand;
      fieldsAtPath = fieldsAtPath.set(name, fieldDemands);
    }
    let fields: TypeRef | undefined;
    if (fieldsAtPath.size > 0) {
      fields = inputContractResolverTable.record(
        [...fieldsAtPath].map((entry) => {
          const name = entry[0];
          const child = entry[1];
          return ({
            name: name,
            type: inputContractResolverResolve(
              root,
              child,
              [...path, name],
              issues,
            ),
            optional: false,
          });
        }),
      );
    }
    let candidates = direct.map((demand) => demand.type);
    if (
      fields !== undefined ||
      candidates.some((candidate) =>
        candidate !== inputContractResolverTable.unknown
      )
    ) {
      candidates = candidates.filter((candidate) =>
        candidate !== inputContractResolverTable.unknown
      );
    }
    if (
      fields !== undefined &&
      (candidates.length === 0 ||
        !inputContractResolverSatisfiesFields(candidates[0], fieldsAtPath))
    ) {
      candidates[candidates.length] = fields;
    }
    const chosen = candidates[0] ?? inputContractResolverTable.unknown;
    const canonical = inputContractResolverTable.unfoldTransparent(chosen);
    if (
      candidates.some((candidate) =>
        inputContractResolverTable.unfoldTransparent(candidate) !== canonical
      )
    ) {
      for (const use of demands) {
        issues[issues.length] = {
          kind: "conflicting-requirements",
          rootName: root.name,
          path: path,
          candidates: candidates,
          node: use.node,
        };
      }
    }
    return chosen;
  }
  function inputContractResolverSatisfiesFields(
    type: TypeRef,
    requirements: ReadonlyMap<string, readonly Demand[]>,
  ): boolean {
    const shape = inputContractResolverTable.node(
      inputContractResolverTable.unfold(type),
    );
    if (shape.kind === "union") {
      return shape.members.every((member) =>
        inputContractResolverSatisfiesFields(member, requirements)
      );
    }
    const fields = inputContractResolverRecordFields(type);
    if (fields === undefined) {
      return false;
    }
    for (const entry of requirements) {
      const name = entry[0];
      const requirement = entry[1];
      const field = fields.find((candidate) => candidate.name === name);
      if (field === undefined) {
        return false;
      }
      const direct = requirement.filter((demand) => demand.path.length === 1)
        .map((demand) => demand.type).filter((candidate) =>
          candidate !== inputContractResolverTable.unknown
        );
      if (
        direct.some((candidate) =>
          inputContractResolverTable.unfoldTransparent(candidate) !==
            inputContractResolverTable.unfoldTransparent(field.type)
        )
      ) {
        return false;
      }
      if (
        requirement.some((demand) => demand.path.length > 1) &&
        !inputContractResolverSatisfiesFields(
          field.type,
          inputContractResolverNestedRequirements(requirement),
        )
      ) {
        return false;
      }
    }
    return true;
  }
  function inputContractResolverNestedRequirements(
    demands: readonly Demand[],
  ): ReadonlyMap<string, readonly Demand[]> {
    let nested = emptyMap<string, Demand[]>();
    for (const demand of demands) {
      const name = demand.path[1];
      if (name === undefined) {
        continue;
      }
      const fieldDemands = nested.get(name) ?? [];
      fieldDemands[fieldDemands.length] = {
        path: demand.path.slice(1),
        type: demand.type,
        node: demand.node,
      };
      nested = nested.set(name, fieldDemands);
    }
    return nested;
  }
  function inputContractResolverRecordFields(
    type: TypeRef,
  ): readonly RecordFieldShape[] | undefined {
    let node = inputContractResolverTable.node(
      inputContractResolverTable.unfold(type),
    );
    if (node.kind === "named") {
      const record = inputContractResolverTable.nominalBodyOf(node.id);
      if (record === undefined) {
        return undefined;
      }
      node = inputContractResolverTable.node(
        inputContractResolverTable.unfold(record),
      );
    }
    return node.kind === "record" ? node.fields : undefined;
  }
  const inputContractResolverSelf: InputContractResolver = {
    origin: inputContractResolverOrigin,
    setOrigin: inputContractResolverSetOrigin,
    isConcrete: inputContractResolverIsConcrete,
    callableEvidence: inputContractResolverCallableEvidence,
    fieldType: inputContractResolverFieldType,
    demand: inputContractResolverDemand,
    defer: inputContractResolverDefer,
    finish: inputContractResolverFinish,
  };
  return inputContractResolverSelf;
}
