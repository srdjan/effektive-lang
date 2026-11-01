import { isErrorId } from "./ids.ts";
import type { LocalId } from "./ir.ts";
import type { NodeId } from "./syntax.ts";
import type { TypeRef, TypeTable } from "./types.ts";

interface Root {
  readonly id: LocalId;
  readonly name: string;
}

export interface Origin {
  readonly root: Root;
  readonly path: readonly string[];
}

interface Demand {
  readonly path: readonly string[];
  readonly type: TypeRef;
  readonly node: NodeId;
}

interface DemandNode {
  readonly direct: Demand[];
  readonly fields: Map<string, DemandNode>;
}

interface DeferredCall {
  readonly origin: Origin;
  readonly callee: NodeId;
  readonly applyContract: (evidence: CallableEvidence) => void;
  readonly processed: Set<TypeRef>;
  resolved: boolean;
}

export interface CallableEvidence {
  readonly kind: "callable";
  readonly parameters: readonly (TypeRef | undefined)[];
  readonly result: TypeRef | undefined;
  readonly checked: readonly boolean[] | undefined;
}

type ContractIssue =
  | {
    readonly kind: "unresolved-call";
    readonly rootName: string;
    readonly node: NodeId;
  }
  | {
    readonly kind: "conflicting-requirements";
    readonly rootName: string;
    readonly path: readonly string[];
    readonly candidates: readonly TypeRef[];
    readonly node: NodeId;
  };

interface Resolution {
  readonly types: readonly TypeRef[];
  readonly issues: readonly ContractIssue[];
}

function emptyDemandNode(): DemandNode {
  return { direct: [], fields: new Map() };
}

export class InputContractResolver {
  private readonly origins = new Map<LocalId, Origin>();
  private readonly demands = new Map<LocalId, Demand[]>();
  private readonly deferredCalls = new Map<LocalId, DeferredCall[]>();
  private readonly deferredCallsByCallee = new Map<NodeId, DeferredCall>();
  private readonly pendingCalls: DeferredCall[] = [];
  private readonly queuedCalls = new Set<DeferredCall>();

  constructor(
    private readonly table: TypeTable,
    roots: readonly Root[],
  ) {
    for (const root of roots) this.origins.set(root.id, { root, path: [] });
  }

  origin(id: LocalId): Origin | undefined {
    return this.origins.get(id);
  }

  setOrigin(id: LocalId, origin: Origin): void {
    this.origins.set(id, origin);
  }

  isConcrete(type: TypeRef | undefined): type is TypeRef {
    if (type === undefined || type === this.table.unknown) return false;
    return this.table.node(type).kind !== "error";
  }

  callableEvidence(type: TypeRef | undefined): CallableEvidence | undefined {
    if (type === undefined) return undefined;
    const node = this.table.node(this.table.unfold(type));
    return node.kind === "function"
      ? {
        kind: "callable",
        parameters: node.parameters,
        result: node.result,
        checked: node.checked,
      }
      : undefined;
  }

  fieldType(type: TypeRef | undefined, name: string): TypeRef | undefined {
    if (!this.isConcrete(type)) return undefined;
    return this.recordFields(type)?.find((field) => field.name === name)?.type;
  }

  demand(
    origin: Origin | undefined,
    type: TypeRef | undefined,
    node: NodeId,
  ): void {
    if (
      origin === undefined ||
      (!this.isConcrete(type) && origin.path.length === 0)
    ) return;
    const list = this.demands.get(origin.root.id) ?? [];
    const demand = {
      path: origin.path,
      type: this.isConcrete(type) ? type : this.table.unknown,
      node,
    };
    if (
      list.some((candidate) =>
        candidate.type === demand.type && candidate.node === demand.node &&
        candidate.path.length === demand.path.length &&
        candidate.path.every((field, index) => field === demand.path[index])
      )
    ) return;
    list.push(demand);
    this.demands.set(origin.root.id, list);
    for (const call of this.deferredCalls.get(origin.root.id) ?? []) {
      this.enqueue(call);
    }
  }

  defer(
    origin: Origin,
    callee: NodeId,
    applyContract: (evidence: CallableEvidence) => void,
  ): void {
    const existing = this.deferredCallsByCallee.get(callee);
    if (existing !== undefined) {
      this.enqueue(existing);
      return;
    }
    const call: DeferredCall = {
      origin,
      callee,
      applyContract,
      processed: new Set(),
      resolved: false,
    };
    const calls = this.deferredCalls.get(origin.root.id) ?? [];
    calls.push(call);
    this.deferredCalls.set(origin.root.id, calls);
    this.deferredCallsByCallee.set(callee, call);
    this.enqueue(call);
  }

  finish(
    parameters: readonly {
      readonly id: LocalId | undefined;
      readonly type: TypeRef;
      readonly inferred: boolean;
    }[],
  ): Resolution {
    this.propagateDeferredCalls();
    const issues: ContractIssue[] = [];
    const types = parameters.map((parameter) => {
      if (!parameter.inferred || parameter.id === undefined) {
        return parameter.type;
      }
      const root = this.origins.get(parameter.id)?.root;
      const bodyDemands = this.demands.get(parameter.id) ?? [];
      const demands =
        parameter.type !== this.table.unknown && bodyDemands.length > 0
          ? [
            { path: [], type: parameter.type, node: bodyDemands[0].node },
            ...bodyDemands,
          ]
          : bodyDemands;
      for (
        const call of (this.deferredCalls.get(parameter.id) ?? []).filter(
          (candidate) => !candidate.resolved,
        )
      ) {
        issues.push({
          kind: "unresolved-call",
          rootName: root?.name ?? "input",
          node: call.callee,
        });
      }
      if (root === undefined || demands.length === 0) return parameter.type;
      const demandTree = emptyDemandNode();
      for (const demand of demands) this.insert(demandTree, demand, 0);
      return this.resolve(root, demandTree, [], issues);
    });
    return { types, issues };
  }

  private enqueue(call: DeferredCall): void {
    if (this.queuedCalls.has(call)) return;
    this.queuedCalls.add(call);
    this.pendingCalls.push(call);
  }

  private propagateDeferredCalls(): void {
    for (let index = 0; index < this.pendingCalls.length; index++) {
      const call = this.pendingCalls[index];
      this.queuedCalls.delete(call);
      for (const contract of this.contractsFor(call.origin)) {
        if (call.processed.has(contract)) continue;
        call.processed.add(contract);
        const evidence = this.callableEvidence(contract);
        if (evidence === undefined) continue;
        call.resolved = true;
        call.applyContract(evidence);
      }
    }
    this.pendingCalls.length = 0;
  }

  private contractsFor(origin: Origin): TypeRef[] {
    const contracts = new Set<TypeRef>();
    for (const demand of this.demands.get(origin.root.id) ?? []) {
      if (
        demand.path.length > origin.path.length ||
        !demand.path.every((field, index) => field === origin.path[index])
      ) continue;
      let contract: TypeRef | undefined = demand.type;
      for (const field of origin.path.slice(demand.path.length)) {
        contract = this.fieldType(contract, field);
        if (contract === undefined) break;
      }
      if (contract !== undefined) contracts.add(contract);
    }
    return [...contracts];
  }

  private insert(tree: DemandNode, demand: Demand, depth: number): void {
    const field = demand.path[depth];
    if (field === undefined) {
      tree.direct.push(demand);
      return;
    }
    let child = tree.fields.get(field);
    if (child === undefined) {
      child = emptyDemandNode();
      tree.fields.set(field, child);
    }
    this.insert(child, demand, depth + 1);
  }

  private resolve(
    root: Root,
    tree: DemandNode,
    path: readonly string[],
    issues: ContractIssue[],
  ): TypeRef {
    let fields: TypeRef | undefined;
    if (tree.fields.size > 0) {
      fields = this.table.record([...tree.fields].map(([name, child]) => ({
        name,
        type: this.resolve(root, child, [...path, name], issues),
        optional: false,
      })));
    }
    let candidates = [...tree.direct.map((demand) => demand.type)];
    if (
      fields !== undefined ||
      candidates.some((candidate) => candidate !== this.table.unknown)
    ) {
      candidates = candidates.filter((candidate) =>
        candidate !== this.table.unknown
      );
    }
    if (
      fields !== undefined &&
      (candidates.length === 0 ||
        !this.satisfiesFields(candidates[0], tree.fields))
    ) {
      candidates.push(fields);
    }
    const chosen = candidates[0] ?? this.table.unknown;
    const canonical = this.table.unfoldTransparent(chosen);
    if (
      candidates.some((candidate) =>
        this.table.unfoldTransparent(candidate) !== canonical
      )
    ) {
      for (const use of this.leafDemands(tree)) {
        issues.push({
          kind: "conflicting-requirements",
          rootName: root.name,
          path,
          candidates,
          node: use.node,
        });
      }
    }
    return chosen;
  }

  private satisfiesFields(
    type: TypeRef,
    requirements: ReadonlyMap<string, DemandNode>,
  ): boolean {
    const shape = this.table.node(this.table.unfold(type));
    if (shape.kind === "union") {
      return shape.members.every((member) =>
        this.satisfiesFields(member, requirements)
      );
    }
    const fields = this.recordFields(type);
    if (fields === undefined) return false;
    for (const [name, requirement] of requirements) {
      const field = fields.find((candidate) => candidate.name === name);
      if (field === undefined) return false;
      const direct = requirement.direct.map((demand) => demand.type).filter(
        (candidate) => candidate !== this.table.unknown,
      );
      if (
        direct.some((candidate) =>
          this.table.unfoldTransparent(candidate) !==
            this.table.unfoldTransparent(field.type)
        )
      ) return false;
      if (
        requirement.fields.size > 0 &&
        !this.satisfiesFields(field.type, requirement.fields)
      ) return false;
    }
    return true;
  }

  private recordFields(type: TypeRef) {
    let node = this.table.node(this.table.unfold(type));
    if (node.kind === "named") {
      const record = isErrorId(node.id)
        ? this.table.errorRecordOf(node.id)
        : this.table.taggedRecordOf(node.id) ??
          this.table.identityBaseOf(node.id);
      if (record === undefined) return undefined;
      node = this.table.node(this.table.unfold(record));
    }
    return node.kind === "record" ? node.fields : undefined;
  }

  private leafDemands(tree: DemandNode): Demand[] {
    return [
      ...tree.direct,
      ...[...tree.fields.values()].flatMap((child) => this.leafDemands(child)),
    ];
  }
}
