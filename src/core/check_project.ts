import {
  emptyMap,
  emptySet,
  mapFrom,
  reverseIndices,
  stackValues,
} from "./runtime.ts";
// The project driver. For each module, in topological order, it runs
// the declaration checker, checks every body, solves the execution modes,
// reports the initialization cycles, and builds the module interface with the
// modes. The finished interface goes to the modules that import it.
//
// Body checking order. The module-local reference graph over functions and
// constants gives strongly connected components, callees first. A component of
// one declaration without a self reference is checked once. A recursive component
// starts its pending modes at `pure` and iterates (modes.ts). The diagnostics of
// the iteration are held, and only the last round's diagnostics are published.
import type { Analysis } from "./analyze.ts";
import type { ModuleResolution } from "./resolve.ts";
import { analyzeProject } from "./analyze.ts";
import {
  type ConstantSignature,
  type FunctionSignature,
  isPendingMode,
  type ModuleDeclarations,
  signatureType,
  type SolvedLookup,
  type TypeGraph,
  type ValueSignature,
} from "./signatures.ts";
import { checkModuleDeclarations } from "./check_declarations.ts";
import {
  checkConstantBody,
  checkFunctionBody,
  type ConstantRun,
  type FunctionRun,
} from "./check_expr.ts";
import { inferFunctionInputs, withInferredInputs } from "./infer_inputs.ts";
import type { BodyEnv, ProofBudget } from "./body_env.ts";
import { newProofBudget } from "./check_refinements.ts";
import { type Diagnostic, normalizeDiagnostics } from "./diagnostics.ts";
import { serviceOfCapability } from "./ids.ts";
import { serviceBoundDiagnostics } from "./service_bounds.ts";
import { isCycle, stronglyConnectedComponents } from "./graph.ts";
import { arrowBody, initOf, kidsOf } from "./syntax_queries.ts";
import { checkInitialization, referenceEdges } from "./initialization.ts";
import {
  buildInterface,
  buildTypeGraph,
  type InterfaceError,
  type ModuleInterface,
  reachableModules,
} from "./interface.ts";
import type { CapabilityId, Type as IrType, ValueId } from "./ir.ts";
import {
  recursiveAnnotationDiagnostic,
  type Solved,
  solveModeGroup,
  unsettledGroupDiagnostic,
} from "./modes.ts";
import type { ModuleInfo } from "./project.ts";
import type { ConfigError } from "./project_config.ts";
import type { Result, SourceHost } from "./source.ts";
import { kindOf, type NodeId, SyntaxKind, type SyntaxTree } from "./syntax.ts";
import type { BodyTable } from "./tables.ts";
import { type TypeRef, TypeTable } from "./types.ts";
import { functionTypeFromIr, typeFromIr } from "./type_ir.ts";
type ModuleName = string;
type ProjectRoot = string;
type EntryPaths = readonly string[];
export type FunctionBody = Omit<FunctionRun, "diagnostics"> & {
  readonly kind: "function";
  readonly signature: FunctionSignature;
  /** The body expression of the arrow, or undefined when the source is broken. */
  readonly bodyNode: NodeId | undefined;
};
export type ConstantBody = {
  readonly kind: "constant";
  readonly signature: ConstantSignature;
  readonly initNode: NodeId | undefined;
  readonly table: BodyTable;
  readonly type: TypeRef;
};
type ModuleBodies = {
  /** In source order. */
  readonly functions: ReadonlyMap<ValueId, FunctionBody>;
  /** In source order. */
  readonly constants: ReadonlyMap<ValueId, ConstantBody>;
  /** The mode and the effect sets of every function, in source order. */
  readonly solved: ReadonlyMap<ValueId, Solved>;
  /** Body, mode, and initialization diagnostics of the module, sorted. */
  readonly diagnostics: readonly Diagnostic[];
};
export type CheckedModule = {
  readonly module: string;
  /** The root-relative path, which diagnostic spans use as their source. */
  readonly path: string;
  readonly tree: SyntaxTree;
  readonly declarations: ModuleDeclarations;
  readonly functions: ReadonlyMap<ValueId, FunctionBody>;
  readonly constants: ReadonlyMap<ValueId, ConstantBody>;
  /** The mode and the effect sets of every function, in source order. */
  readonly solved: ReadonlyMap<ValueId, Solved>;
  /** An error value only when the mode map lacks an entry, which cannot happen after body checking. */
  readonly interface: Result<ModuleInterface, InterfaceError>;
  /** The interface hash, when the interface exists. */
  readonly hash: string | undefined;
  /** Declaration and body diagnostics of this module, sorted. */
  readonly diagnostics: readonly Diagnostic[];
};
export type CheckedProject = {
  readonly analysis: Analysis;
  /** The one intern table of the project. */
  readonly table: TypeTable;
  /** Per module, in topological order. */
  readonly modules: ReadonlyMap<string, CheckedModule>;
  /** All diagnostics of the project, sorted and without duplicates. */
  readonly diagnostics: readonly Diagnostic[];
  /**
   * The modules that cannot be lowered, each with the number of project
   * diagnostics that block it. A module is blocked when a project diagnostic
   * names its file or when its own diagnostics are not empty.
   */
  readonly blocked: ReadonlyMap<string, number>;
};
type EntryInfo = {
  readonly broken: boolean;
  readonly references: readonly ValueId[];
};
type FunctionEntry = EntryInfo & {
  readonly kind: "function";
  readonly signature: FunctionSignature;
  /** The body expression of the arrow, or undefined when the source is broken. */
  readonly bodyNode: NodeId | undefined;
};
type ConstantEntry = EntryInfo & {
  readonly kind: "constant";
  readonly signature: ConstantSignature;
  readonly initNode: NodeId | undefined;
};
type Entry = FunctionEntry | ConstantEntry;
type CheckArguments = {
  readonly info: ModuleInfo;
  readonly resolution: ModuleResolution;
  readonly module: string;
  readonly declarations: ModuleDeclarations & {
    readonly values: ReadonlyMap<ValueId, ValueSignature>;
  };
  readonly proofBudget: ProofBudget;
  /** The interfaces of the modules that this module reaches. */
  readonly interfaces: ReadonlyMap<string, ModuleInterface>;
};
type Run = {
  readonly kind: "function";
  readonly entry: FunctionEntry;
  readonly run: FunctionRun;
} | {
  readonly kind: "constant";
  readonly entry: ConstantEntry;
  readonly run: ConstantRun;
};
function collectEntries(args: CheckArguments): Entry[] {
  const info = args.info;
  const resolution = args.resolution;
  const declarations = args.declarations;
  const tree = info.tree;
  const targets = resolution.targets;
  let local = emptySet<ValueId>();
  for (const signature of declarations.values.values()) {
    if (signature.kind !== "provider") {
      local = local.add(signature.id);
    }
  }
  const entries: Entry[] = [];
  for (const signature of declarations.values.values()) {
    if (signature.kind === "provider") {
      continue;
    }
    const initNode = initOf(tree, signature.node, signature.nameNode);
    const bodyNode = signature.kind === "function" && initNode !== undefined &&
        kindOf(tree, initNode) === SyntaxKind.ArrowExpr
      ? arrowBody(tree, initNode)
      : undefined;
    let references = emptySet<ValueId>();
    if (initNode !== undefined) {
      const pending = [initNode];
      for (const node of stackValues(pending)) {
        const target = targets.get(node);
        if (target?.kind === "value" && local.has(target.id)) {
          references = references.add(target.id);
        }
        const children = kidsOf(tree, node);
        for (const index of reverseIndices(children.length)) {
          const child = children[index];
          if (child !== undefined) {
            pending[pending.length] = child;
          }
        }
      }
    }
    const common = {
      broken: info.index.byName.get(signature.name)?.broken ?? false,
      references: [...references],
    };
    {
      const _appendTarget1 = entries;
      const _appendValue2: Entry = signature.kind === "function"
        ? {
          ...common,
          kind: "function",
          signature: signature,
          bodyNode: bodyNode,
        }
        : {
          ...common,
          kind: "constant",
          signature: signature,
          initNode: initNode,
        };
      _appendTarget1[_appendTarget1.length] = _appendValue2;
    }
  }
  return entries;
}
/**
 * The value environment of one module and the results that its bodies publish.
 * `publish` and `settle` are the only writers of the maps.
 */
interface ModuleValues {
  /** The environment of a body check, with `view` as the state of other functions. */
  environment(view: SolvedLookup): BodyEnv;
  /** Records the final run of a declaration and publishes its diagnostics. */
  publish(run: Run, recursive: boolean): ModuleValues;
  /** Records the state that a recursive group settled on. */
  settle(solved: ReadonlyMap<ValueId, Solved>): ModuleValues;
  /** The state published so far. The map is live, so later writes show in it. */
  settled(): SolvedLookup;
  /** The published bodies, in the order of publication. */
  bodies(): {
    readonly functions: ReadonlyMap<ValueId, FunctionBody>;
    readonly constants: ReadonlyMap<ValueId, ConstantBody>;
  };
}
/**
 * The values of one module. A function without a written result and a
 * constant without a type read their type from the results that `publish`
 * stores later. A function with a written result reads its mode and open sets
 * from the state that `publish` and `settle` store. The callee-first component order makes that read safe.
 * `diagnostics` receives the diagnostics of each published run.
 */
function moduleValues(
  args: CheckArguments,
  diagnostics: Diagnostic[],
): ModuleValues {
  const declarations = args.declarations;
  const table = declarations.env.table;
  // An imported value type interns on its first read. A module reads few of
  // the values of the modules that it reaches, and the table interns by
  // structure, so a second read returns the same ref.
  let importedTypes = emptyMap<ValueId, IrType>();
  for (const iface of args.interfaces.values()) {
    for (const value of iface.payload.values) {
      importedTypes = importedTypes.set(value.id, value.type);
    }
  }
  let methodTypes = emptyMap<CapabilityId, TypeRef>();
  function methodType(capability: CapabilityId): TypeRef {
    const cached = methodTypes.get(capability);
    if (cached !== undefined) {
      return cached;
    }
    let ref = declarations.methodTypes.get(capability);
    if (ref === undefined) {
      const service = serviceOfCapability(capability);
      const method = service === undefined
        ? undefined
        : declarations.env.services.get(service)?.methods.find((m) =>
          m.id === capability
        );
      ref = method === undefined
        ? table.error
        : functionTypeFromIr(table, method.type);
    }
    methodTypes = methodTypes.set(capability, ref);
    return ref;
  }
  let solved = emptyMap<ValueId, Solved>();
  let inferred = emptyMap<ValueId, TypeRef>();
  let constantTypes = emptyMap<ValueId, TypeRef>();
  let functions = emptyMap<ValueId, FunctionBody>();
  let constants = emptyMap<ValueId, ConstantBody>();
  function values(view: SolvedLookup): (id: ValueId) => TypeRef {
    function value(id: ValueId): TypeRef {
      const signature: ValueSignature | undefined = declarations.values.get(id);
      if (signature === undefined) {
        const type = importedTypes.get(id);
        return type === undefined ? table.error : typeFromIr(table, type);
      }
      {
        const kind_1 = signature.kind;
        if (kind_1 === "function") {
          if (!signature.written.result) {
            return inferred.get(id) ?? table.error;
          }
          const type = signatureType(table, signature, view);
          return type.ok ? type.value.ref : table.error;
        } else if (kind_1 === "constant") {
          return signature.type?.ref ?? constantTypes.get(id) ?? table.error;
        } else if (kind_1 === "provider") {
          return signature.type.ref;
        }
      }
      return table.error;
    }
    return value;
  }
  function environment(view: SolvedLookup): BodyEnv {
    return {
      env: declarations.env,
      values: values(view),
      methodType: methodType,
      proofBudget: args.proofBudget,
    };
  }
  function publish(run: Run, recursive: boolean): ModuleValues {
    if (!run.entry.broken) {
      for (const diagnostic of run.run.diagnostics) {
        {
          const _appendTarget3 = diagnostics;
          const _appendValue4 = diagnostic;
          _appendTarget3[_appendTarget3.length] = _appendValue4;
        }
      }
    }
    if (run.kind === "function") {
      const signature = run.entry.signature;
      const bodyNode = run.entry.bodyNode;
      const result = run.run;
      solved = solved.set(signature.id, {
        mode: result.mode,
        failures: result.failures,
        requirements: result.requirements,
      });
      if (!signature.written.result && !recursive) {
        inferred = inferred.set(signature.id, result.type);
      }
      functions = functions.set(signature.id, {
        kind: "function",
        signature: signature,
        bodyNode: bodyNode,
        body: result.body,
        result: result.result,
        failures: result.failures,
        requirements: result.requirements,
        mode: result.mode,
        table: result.table,
        type: result.type,
      });
    } else {
      const signature = run.entry.signature;
      const initNode = run.entry.initNode;
      constantTypes = constantTypes.set(signature.id, run.run.type);
      constants = constants.set(signature.id, {
        kind: "constant",
        signature: signature,
        initNode: initNode,
        table: run.run.table,
        type: run.run.type,
      });
    }
    return moduleValuesSelf;
  }
  function settle(state: ReadonlyMap<ValueId, Solved>): ModuleValues {
    for (const binding of state) {
      const id = binding[0];
      const entry = binding[1];
      solved = solved.set(id, entry);
    }
    return moduleValuesSelf;
  }
  function settled(): SolvedLookup {
    return solved;
  }
  function bodies(): {
    readonly functions: ReadonlyMap<ValueId, FunctionBody>;
    readonly constants: ReadonlyMap<ValueId, ConstantBody>;
  } {
    return { functions: functions, constants: constants };
  }
  const moduleValuesSelf: ModuleValues = {
    environment: environment,
    publish: publish,
    settle: settle,
    settled: settled,
    bodies: bodies,
  };
  return moduleValuesSelf;
}
/**
 * Checks every entry, callee first, and publishes each run into `values`. A
 * recursive component runs through the mode solver. The execution mode
 * diagnostics go to `diagnostics` in the order of the components.
 */
function scheduleRuns(
  entries: Entry[],
  edges: readonly (readonly number[])[],
  initialValues: ModuleValues,
  signatures: Map<ValueId, ValueSignature>,
  diagnostics: Diagnostic[],
): ModuleValues {
  function runEntry(entry: Entry, benv: BodyEnv): Run {
    return entry.kind === "function"
      ? {
        kind: "function",
        entry: entry,
        run: checkFunctionBody(benv, entry.signature, entry.bodyNode),
      }
      : {
        kind: "constant",
        entry: entry,
        run: checkConstantBody(benv, entry.signature, entry.initNode),
      };
  }
  let values = initialValues;
  const solved = values.settled();
  for (const component of stronglyConnectedComponents(entries.length, edges)) {
    let members = component.map((i) => entries[i]);
    const recursive = isCycle(component, edges);
    if (!recursive) {
      const entry = members[0];
      if (
        entry.kind === "function" &&
        entry.signature.parameters.some((parameter) => parameter.inferred)
      ) {
        const benv = values.environment(solved);
        const inference = inferFunctionInputs(
          benv,
          entry.signature,
          entry.bodyNode,
        );
        const signature = withInferredInputs(
          entry.signature,
          inference,
          benv.env.table,
        );
        const finalized: FunctionEntry = { ...entry, signature: signature };
        entries[component[0]] = finalized;
        members = [finalized];
        signatures = signatures.set(signature.id, signature);
        if (!entry.broken) {
          for (const diagnostic of inference.diagnostics) {
            {
              const _appendTarget5 = diagnostics;
              const _appendValue6 = diagnostic;
              _appendTarget5[_appendTarget5.length] = _appendValue6;
            }
          }
        }
      }
      values = values.publish(
        runEntry(members[0], values.environment(solved)),
        false,
      );
      continue;
    }
    for (const member of members) {
      const signature = member.signature;
      if (
        signature.kind === "function" &&
        (!signature.written.result ||
          signature.parameters.some((parameter) => parameter.inferred))
      ) {
        {
          const _appendTarget7 = diagnostics;
          const _appendValue8 = recursiveAnnotationDiagnostic(
            signature.name,
            signature.nameSpan,
          );
          _appendTarget7[_appendTarget7.length] = _appendValue8;
        }
      }
    }
    const pending: ValueId[] = [];
    for (const member of members) {
      const signature = member.signature;
      if (signature.kind === "function" && isPendingMode(signature)) {
        {
          const _appendTarget9 = pending;
          const _appendValue10 = signature.id;
          _appendTarget9[_appendTarget9.length] = _appendValue10;
        }
      }
    }
    const solution = solveModeGroup(pending, (assumed) => {
      // Solver assumptions overlay settled state without publishing into it.
      const benv = values.environment({
        get: (id) => assumed.get(id) ?? solved.get(id),
      });
      const runs = members.map((entry) => runEntry(entry, benv));
      let computed = emptyMap<ValueId, Solved>();
      for (const run of runs) {
        if (
          run.kind === "function" && pending.includes(run.entry.signature.id)
        ) {
          computed = computed.set(run.entry.signature.id, {
            mode: run.run.mode,
            failures: run.run.failures,
            requirements: run.run.requirements,
          });
        }
      }
      return { results: runs, computed: computed };
    }, undefined);
    values = values.settle(solution.solved);
    if (!solution.settled) {
      const first = members[0].signature;
      {
        const _appendTarget11 = diagnostics;
        const _appendValue12 = unsettledGroupDiagnostic(
          first.name,
          first.nameSpan,
        );
        _appendTarget11[_appendTarget11.length] = _appendValue12;
      }
    }
    for (const run of solution.results) {
      values = values.publish(run, true);
    }
  }
  return values;
}
function checkModuleBodies(
  args: CheckArguments,
  signatures: Map<ValueId, ValueSignature>,
): ModuleBodies {
  const entries = collectEntries(args);
  const edges = referenceEdges(entries.map((entry) => ({
    id: entry.signature.id,
    references: entry.references,
  })));
  // The component diagnostics come first, then the initialization cycles,
  // because `normalizeDiagnostics` resolves exact duplicates in push order.
  const diagnostics: Diagnostic[] = [];
  let values = moduleValues(args, diagnostics);
  values = scheduleRuns(
    entries,
    edges,
    values,
    signatures,
    diagnostics,
  );
  const initialization = checkInitialization(entries.map((entry) => ({
    id: entry.signature.id,
    kind: entry.signature.kind,
    references: entry.references,
    nameSpan: entry.signature.nameSpan,
  })));
  for (const diagnostic of initialization) {
    {
      const _appendTarget13 = diagnostics;
      const _appendValue14 = diagnostic;
      _appendTarget13[_appendTarget13.length] = _appendValue14;
    }
  }
  // Source order for the maps, whatever order the components ran in.
  const bodies = values.bodies();
  const functions = bodies.functions;
  const constants = bodies.constants;
  let orderedFunctions = emptyMap<ValueId, FunctionBody>();
  let orderedConstants = emptyMap<ValueId, ConstantBody>();
  let orderedSolved = emptyMap<ValueId, Solved>();
  for (const entry of entries) {
    const id = entry.signature.id;
    const fn = functions.get(id);
    if (fn !== undefined) {
      orderedFunctions = orderedFunctions.set(id, fn);
      orderedSolved = orderedSolved.set(id, {
        mode: fn.mode,
        failures: fn.failures,
        requirements: fn.requirements,
      });
    }
    const constant = constants.get(id);
    if (constant !== undefined) {
      orderedConstants = orderedConstants.set(id, constant);
    }
  }
  return {
    functions: orderedFunctions,
    constants: orderedConstants,
    solved: orderedSolved,
    diagnostics: normalizeDiagnostics(diagnostics),
  };
}
/** What a module sees of the modules that it reaches, among those that are checked so far. */
type ReachedModules = {
  readonly reached: readonly string[];
  readonly graphs: ReadonlyMap<string, TypeGraph>;
  readonly interfaces: ReadonlyMap<string, ModuleInterface>;
};
/** The reached modules of `name`, with the type graphs and the interfaces that exist for them. */
export function reachedModules(
  analysis: Analysis,
  name: ModuleName,
  graphs: ReadonlyMap<string, TypeGraph>,
  interfaces: ReadonlyMap<string, ModuleInterface>,
): ReachedModules {
  const reached = reachableModules(analysis, name);
  let importedGraphs = emptyMap<string, TypeGraph>();
  let visible = emptyMap<string, ModuleInterface>();
  for (const other of reached) {
    const graph = graphs.get(other);
    if (graph !== undefined) {
      importedGraphs = importedGraphs.set(other, graph);
    }
    const iface = interfaces.get(other);
    if (iface !== undefined) {
      visible = visible.set(other, iface);
    }
  }
  return { reached: reached, graphs: importedGraphs, interfaces: visible };
}
/** The result of the check of one module: its checked form and its type graph. */
export type ModuleStep = {
  readonly checked: CheckedModule;
  readonly graph: TypeGraph;
};
/** Joins a module without its interface to the interface and its hash, which leaves out source spans. */
function withInterface(
  checked: Omit<CheckedModule, "interface" | "hash">,
  graph: TypeGraph,
  built: Result<ModuleInterface, InterfaceError>,
): ModuleStep {
  return {
    graph: graph,
    checked: {
      ...checked,
      interface: built,
      hash: built.ok ? built.value.hash : undefined,
    },
  };
}
/**
 * Builds the interface of a checked module again from its declarations and
 * solved modes. The reached modules moved their spans, so the interface payload
 * carries new spans. The module is not checked again.
 */
function refreshInterface(
  previous: ModuleStep,
  seen: ReachedModules,
): ModuleStep {
  const declarations = previous.checked.declarations;
  const solved = previous.checked.solved;
  const built = buildInterface(
    declarations,
    solved,
    seen.graphs,
    previous.graph,
  );
  return withInterface(previous.checked, previous.graph, built);
}
/**
 * Checks one module: its declarations, its type graph, its bodies, and its
 * interface. `driveProject` calls this step for each module that its policy
 * checks. `checkAnalysis` and `Program` both run `driveProject`, so a check
 * from scratch and a revision of the program give the same result.
 */
export function checkModuleStep(
  info: ModuleInfo,
  resolution: ModuleResolution,
  name: ModuleName,
  table: TypeTable,
  seen: ReachedModules,
  proofBudget: ProofBudget | undefined,
): ModuleStep {
  const activeProofBudget = proofBudget ?? newProofBudget();
  const checkedDeclarations = checkModuleDeclarations(
    info,
    resolution,
    name,
    table,
    seen.graphs,
  );
  // A revision owns its finalized signatures. Never mutate a reused revision.
  const signatures = mapFrom(checkedDeclarations.values);
  const declarations: CheckArguments["declarations"] = {
    ...checkedDeclarations,
    values: signatures,
  };
  const bodies = checkModuleBodies(
    {
      info: info,
      resolution: resolution,
      module: name,
      declarations: declarations,
      proofBudget: activeProofBudget,
      interfaces: seen.interfaces,
    },
    signatures,
  );
  const boundDiagnostics = serviceBoundDiagnostics({
    info: info,
    resolution: resolution,
    declaredServices: declarations.services,
    table: declarations.env.table,
    functions: bodies.functions.values(),
    constants: bodies.constants.values(),
  });
  const graph = buildTypeGraph(declarations, bodies.solved);
  return withInterface(
    {
      module: name,
      path: info.path,
      tree: info.tree,
      declarations: declarations,
      functions: bodies.functions,
      constants: bodies.constants,
      solved: bodies.solved,
      diagnostics: normalizeDiagnostics([
        ...declarations.diagnostics,
        ...bodies.diagnostics,
        ...boundDiagnostics,
      ]),
    },
    graph,
    buildInterface(declarations, bodies.solved, seen.graphs, graph),
  );
}
/** What the cache policy decides for one module. */
export type ModuleDecision =
  /** Check the module again. */
  | {
    readonly kind: "check";
  }
  /** Use the step of an earlier check as it is. */
  | {
    readonly kind: "reuse";
    readonly step: ModuleStep;
  }
  /** Use the earlier check, and build only the interface again. */
  | {
    readonly kind: "refresh";
    readonly step: ModuleStep;
  };
/**
 * The cache decisions of one project run. The driver does not know where the
 * policy keeps its steps. A decision type `D` lets the policy carry its own
 * data from `decide` to `settled` of the same module.
 */
export interface ModulePolicy<D extends ModuleDecision = ModuleDecision> {
  /** Called before each module, with the modules that it reaches among those done. */
  decide(name: ModuleName, info: ModuleInfo, seen: ReachedModules): D;
  /** Called after each module with the step that the module ends with and the decision for it. */
  settled(
    name: ModuleName,
    step: ModuleStep,
    decision: D,
  ): ModulePolicy<D>;
}
function checkEveryModuleDecision(): ModuleDecision {
  return { kind: "check" };
}
function checkEveryModuleSettled(): ModulePolicy {
  return CHECK_EVERY_MODULE;
}
const CHECK_EVERY_MODULE: ModulePolicy = {
  decide: checkEveryModuleDecision,
  settled: checkEveryModuleSettled,
};
/**
 * Runs the modules of an analyzed project in topological order. A module sees
 * the finished interfaces of the modules that it reaches, with their modes.
 * `policy` decides for each module whether to check it, to reuse an earlier
 * step, or to build only its interface again.
 */
export function driveProject<D extends ModuleDecision>(
  analysis: Analysis,
  table: TypeTable,
  initialPolicy: ModulePolicy<D>,
): CheckedProject {
  let policy = initialPolicy;
  let graphs = emptyMap<string, TypeGraph>();
  let interfaces = emptyMap<string, ModuleInterface>();
  let modules = emptyMap<string, CheckedModule>();
  const diagnostics: Diagnostic[] = [...analysis.diagnostics];
  for (const name of analysis.project.order) {
    const info = analysis.project.modules.get(name);
    const resolution = analysis.resolutions.get(name);
    if (info === undefined || resolution === undefined) {
      continue;
    }
    const seen = reachedModules(analysis, name, graphs, interfaces);
    const decision = policy.decide(name, info, seen);
    let step: ModuleStep;
    if (decision.kind === "check") {
      step = checkModuleStep(info, resolution, name, table, seen, undefined);
    } else if (decision.kind === "refresh") {
      step = refreshInterface(decision.step, seen);
    } else {
      step = decision.step;
    }
    const nextPolicy = policy.settled(name, step, decision);
    if (nextPolicy !== undefined) {
      policy = nextPolicy;
    }
    graphs = graphs.set(name, step.graph);
    if (step.checked.interface.ok) {
      interfaces = interfaces.set(name, step.checked.interface.value);
    }
    for (const diagnostic of step.checked.diagnostics) {
      {
        const _appendTarget15 = diagnostics;
        const _appendValue16 = diagnostic;
        _appendTarget15[_appendTarget15.length] = _appendValue16;
      }
    }
    modules = modules.set(name, step.checked);
  }
  const sorted = normalizeDiagnostics(diagnostics);
  return {
    analysis: analysis,
    table: table,
    modules: modules,
    diagnostics: sorted,
    blocked: blockedModules(modules, sorted),
  };
}
/** The modules that have a diagnostic, each with the number of diagnostics that name its file. */
function blockedModules(
  modules: ReadonlyMap<string, CheckedModule>,
  diagnostics: readonly Diagnostic[],
): Map<string, number> {
  let named = emptyMap<string, number>();
  for (const diagnostic of diagnostics) {
    const source = diagnostic.span.source;
    named = named.set(source, (named.get(source) ?? 0) + 1);
  }
  let blocked = emptyMap<string, number>();
  for (const binding of modules) {
    const name = binding[0];
    const checked = binding[1];
    const count = Math.max(
      named.get(checked.path) ?? 0,
      checked.diagnostics.length,
    );
    if (count > 0) {
      blocked = blocked.set(name, count);
    }
  }
  return blocked;
}
export function checkAnalysis(analysis: Analysis): CheckedProject {
  return driveProject(analysis, TypeTable(), CHECK_EVERY_MODULE);
}
/**
 * Loads a project from the entry files (root-relative paths), resolves it, and
 * checks every module. A missing or malformed project file is an error value.
 * Every other problem is a diagnostic in the result.
 */
export function checkProject(
  host: SourceHost,
  root: ProjectRoot,
  entries: EntryPaths,
): Result<CheckedProject, ConfigError> {
  const analysis = analyzeProject(host, root, entries, undefined);
  if (!analysis.ok) {
    return analysis;
  }
  return { ok: true, value: checkAnalysis(analysis.value) };
}
