import { emptyMap, emptySet, mapFrom, setFrom } from "../runtime.ts";
import { needsFieldAdapter, sensitiveField, taggedFields } from "./fields.ts";
// Declarations and their order, and the export rule.
import type {
  ConstantDecl,
  Declaration,
  DeclarationId,
  ErrorDecl,
  Field,
  FunctionDecl,
  ModuleIR,
  ServiceDecl,
  Type,
  TypeDecl,
  ValueId,
} from "../ir.ts";
import { childTypes, isDeferredKind } from "../type_kinds.ts";
import { trueFlag } from "../util.ts";
import { isCycle, stronglyConnectedComponents } from "../graph.ts";
import { containsNamed } from "../recursion_guard.ts";
import { declarationReferencedIds } from "../referenced_ids.ts";
import {
  assignment,
  braces,
  bracketed,
  callWith,
  type Doc,
  group,
  hard,
  ifBreak,
  indent,
  join,
  line,
  marked,
  property,
  soft,
} from "./doc.ts";
import { at } from "./emitted.ts";
import { ExprEmitter } from "./expr.ts";
import { internal } from "./failure.ts";
import type { ModuleState } from "./module_state.ts";
import { tokenOfId } from "../ids.ts";
import { nameOfId, servicesOf } from "./identity.ts";
import {
  effectTypeDoc,
  encodedTypeDoc,
  parameterName,
  schemaDoc,
  schemaFieldDocs,
  typeArguments,
  typeDoc,
} from "./types.ts";
import { valueReferences } from "./walk.ts";
import type { Predicate, Term } from "../predicates.ts";
const LINE_WIDTH = 80;
// ------------------------------------------------------------------ references
/** The walk adds only type, error, and service identities, so each one is a `DeclarationId`. */
function referencedDeclarations(declaration: Declaration): Set<DeclarationId> {
  return declarationReferencedIds(declaration, emptySet<DeclarationId>());
}
/** Source exports plus every declaration that the interface of an export reaches. */
export function exportedIds(ir: ModuleIR): Set<DeclarationId> {
  const byId = mapFrom<DeclarationId, Declaration>(
    ir.declarations.map((d) => [d.id, d]),
  );
  let seen = emptySet<DeclarationId>();
  function visit(id: DeclarationId): Set<DeclarationId> {
    if (seen.has(id)) {
      return seen;
    }
    const declaration = byId.get(id);
    if (declaration === undefined) {
      return seen;
    }
    seen = seen.add(id);
    for (const next of referencedDeclarations(declaration)) {
      seen = visit(next);
    }
    return seen;
  }
  for (const id of ir.exports) {
    seen = visit(id);
  }
  return seen;
}
// ------------------------------------------------------------------ recursion
/**
 * The recursive groups that contain a data type, keyed by each member. A group
 * is a strongly connected component of the type-level references. Every member
 * of a group is emitted in the explicit form, and every reference between the
 * members is suspended, so the order of the members does not matter.
 */
export function recursiveGroups(
  ir: ModuleIR,
): ReadonlyMap<DeclarationId, ReadonlySet<DeclarationId>> {
  const group = ir.declarations.filter(isTypeLevel);
  const index = mapFrom<DeclarationId, number>(group.map((d, n) => [d.id, n]));
  const edges = group.map((d) =>
    [...referencedDeclarations(d)].flatMap((id) => {
      const target = index.get(id);
      return target === undefined ? [] : [target];
    })
  );
  let groups = emptyMap<DeclarationId, ReadonlySet<DeclarationId>>();
  for (const members of stronglyConnectedComponents(group.length, edges)) {
    const declarations = members.map((n) => group[n]);
    const cycle = isCycle(members, edges);
    const hasData = declarations.some((d) =>
      d.kind === "type" && taggedFields(d) !== undefined
    );
    if (!cycle || !hasData) {
      continue;
    }
    const ids = setFrom(declarations.map((d) => d.id));
    for (const id of ids) {
      groups = groups.set(id, ids);
    }
  }
  return groups;
}
// ------------------------------------------------------------------ order
type TypeLevel = TypeDecl | ErrorDecl | ServiceDecl;
function isTypeLevel(d: Declaration): d is TypeLevel {
  return d.kind === "type" || d.kind === "error" || d.kind === "service";
}
/** Dependencies before users. Source order decides everything else. */
export function orderTypeLevel(ir: ModuleIR): TypeLevel[] {
  const group = ir.declarations.filter(isTypeLevel);
  const byId = mapFrom<DeclarationId, TypeLevel>(group.map((d) => [d.id, d]));
  const ordered: TypeLevel[] = [];
  let state = emptyMap<DeclarationId, "active" | "done">();
  function visit(
    declaration: TypeLevel,
  ): Map<DeclarationId, "active" | "done"> {
    if (state.has(declaration.id)) {
      return state;
    }
    state = state.set(declaration.id, "active");
    const dependencies = [...referencedDeclarations(declaration)]
      .flatMap((id) => {
        const dependency = byId.get(id);
        return dependency === undefined ? [] : [dependency];
      })
      .sort((a, b) => a.span.start - b.span.start);
    for (const dependency of dependencies) {
      state = visit(dependency);
    }
    state = state.set(declaration.id, "done");
    ordered[ordered.length] = declaration;
    return state;
  }
  for (const declaration of group) {
    state = visit(declaration);
  }
  return ordered;
}
/** Constants in the order of their eager dependencies. */
export function orderConstants(ir: ModuleIR): ConstantDecl[] {
  const constants = ir.declarations.filter((d): d is ConstantDecl =>
    d.kind === "constant"
  );
  let values = emptyMap<ValueId, FunctionDecl | ConstantDecl>();
  for (const d of ir.declarations) {
    if (d.kind === "function" || d.kind === "constant") {
      values = values.set(d.id, d);
    }
  }
  function eagerDependencies(constant: ConstantDecl): ConstantDecl[] {
    let found = emptyMap<ValueId, ConstantDecl>();
    let expanded = emptySet<ValueId>();
    const pending = valueReferences(constant);
    for (const id of pending) {
      const target = values.get(id);
      if (target === undefined || expanded.has(id)) {
        continue;
      }
      expanded = expanded.add(id);
      if (target.kind === "constant") {
        found = found.set(id, target);
      } else {
        for (const reference of valueReferences(target)) {
          {
            const _appendTarget3 = pending;
            const _appendValue4 = reference;
            _appendTarget3[_appendTarget3.length] = _appendValue4;
          }
        }
      }
    }
    return [...found.values()].sort((a, b) => a.span.start - b.span.start);
  }
  const ordered: ConstantDecl[] = [];
  let state = emptyMap<ValueId, "active" | "done">();
  function visit(
    constant: ConstantDecl,
  ): Map<ValueId, "active" | "done"> {
    const known = state.get(constant.id);
    if (known === "done") {
      return state;
    }
    if (known === "active") {
      return internal(`the constant ${constant.name} depends on itself`);
    }
    state = state.set(constant.id, "active");
    for (const dependency of eagerDependencies(constant)) {
      if (dependency.id !== constant.id) {
        state = visit(dependency);
      }
    }
    state = state.set(constant.id, "done");
    ordered[ordered.length] = constant;
    return state;
  }
  for (const constant of constants) {
    state = visit(constant);
  }
  return ordered;
}
// ------------------------------------------------------------------ printing
/**
 * The parameter list of a function declaration, and the result type when
 * `result` is `"always"` or when the result is written. The emitter passes
 * `"contract"`. Hover passes `"always"`, because it shows the inferred result.
 */
export function functionHeaderDoc(
  scope: ModuleState,
  d: FunctionDecl,
  result: "contract" | "always",
): Doc {
  const parameters = bracketed(
    "(",
    ")",
    d.parameters.map((p, i) => {
      const checked = d.type.checked;
      const isChecked = checked === undefined ? false : checked[i];
      return property(
        p.name,
        isChecked ? "unknown" : typeDoc(scope, p.type, undefined),
      );
    }),
    false,
  );
  if (result === "contract" && !d.written.result) {
    return parameters;
  }
  const resultDoc = typeDoc(scope, d.type.result, undefined);
  const returns = d.type.execution === "effect"
    ? effectTypeDoc(scope, resultDoc, d.type.effects)
    : resultDoc;
  return [parameters, ": ", returns];
}
export function constantTypeDoc(scope: ModuleState, d: ConstantDecl): Doc {
  return typeDoc(scope, d.type, undefined);
}
export type DeclarationEmitter = {
  readonly declaration: (declaration: Declaration) => Doc;
  readonly hostAssertions: () => Doc[];
};
export function DeclarationEmitter(scope: ModuleState): DeclarationEmitter {
  const declarationEmitterGroups = recursiveGroups(scope.ir);
  const declarationEmitterExported = exportedIds(scope.ir);
  let declarationEmitterScope = scope;
  const declarationEmitterExpr = ExprEmitter(scope);
  function declarationEmitterExportKeyword(id: DeclarationId): string {
    return declarationEmitterExported.has(id) ? "export " : "";
  }
  function declarationEmitterDeclaration(declaration: Declaration): Doc {
    declarationEmitterScope = declarationEmitterScope.resetTemporaries();
    if (declaration.kind === "type") {
      return declarationEmitterTypeDeclaration(declaration);
    }
    if (declaration.kind === "error") {
      return declarationEmitterErrorDeclaration(declaration);
    }
    if (declaration.kind === "service") {
      return declarationEmitterServiceDeclaration(declaration);
    }
    if (declaration.kind === "function") {
      return declarationEmitterFunctionDeclaration(declaration);
    }
    return declarationEmitterConstantDeclaration(declaration);
  }
  function declarationEmitterTypeDeclaration(d: TypeDecl): Doc {
    const keyword = declarationEmitterExportKeyword(d.id);
    const grouped = declarationEmitterGroups.get(d.id);
    const fields = taggedFields(d);
    if (fields !== undefined && grouped !== undefined) {
      return declarationEmitterRecursiveData(d, fields, grouped);
    }
    if (
      d.definition.kind === "alias" &&
      (grouped !== undefined ||
        ((d.definition.type.kind === "record" ||
          d.definition.type.kind === "union") &&
          containsNamed(d.definition.type, d.id)))
    ) {
      const recursive = grouped ?? setFrom([d.id]);
      const schema = declarationEmitterScope.effect("Schema");
      const mirror = declarationEmitterScope.encodedMirrorName(d.id);
      return [
        keyword,
        "type ",
        d.name,
        " = ",
        typeDoc(declarationEmitterScope, d.definition.type, undefined),
        ";",
        hard,
        keyword,
        "type ",
        mirror,
        " = ",
        encodedTypeDoc(declarationEmitterScope, d.definition.type, recursive),
        ";",
        hard,
        keyword,
        "const ",
        d.name,
        `: ${schema}.Codec<${d.name}, ${mirror}> = `,
        schemaDoc(declarationEmitterScope, d.definition.type, recursive),
        ";",
      ];
    }
    if (
      d.definition.kind === "alias" && declarationEmitterScope.isTypeOnly(d.id)
    ) {
      return [
        keyword,
        "type ",
        d.name,
        " = ",
        typeDoc(declarationEmitterScope, d.definition.type, undefined),
        ";",
      ];
    }
    const schema = declarationEmitterScope.effect("Schema");
    let value: Doc;
    if (fields !== undefined) {
      value = [
        `${schema}.TaggedStruct`,
        declarationEmitterTagArguments(d.id, fields, undefined),
      ];
    } else if (d.definition.kind === "alias") {
      value = schemaDoc(declarationEmitterScope, d.definition.type, undefined);
    } else {
      return internal(`the nominal type ${d.name} has no emitted form`);
    }
    return [
      assignment(
        [keyword, "const ", d.name],
        declarationEmitterRefinedSchema(d, value),
        undefined,
      ),
      ";",
      hard,
      group(
        [
          keyword,
          "type ",
          d.name,
          " =",
          indent([line, `typeof ${d.name}.Type`]),
        ],
        undefined,
        undefined,
      ),
      ";",
    ];
  }
  function declarationEmitterRefinedSchema(d: TypeDecl, value: Doc): Doc {
    if (d.predicate === undefined) {
      return value;
    }
    const schema = declarationEmitterScope.effect("Schema");
    const input = declarationEmitterScope.temp();
    return [
      value,
      `.check(${schema}.makeFilter((${input}) => `,
      predicateDoc(d.predicate, input),
      ` || ${JSON.stringify(`expected ${d.name}`)}))`,
    ];
  }
  function declarationEmitterRecursiveData(
    d: TypeDecl,
    fields: readonly Field[],
    recursive: ReadonlySet<DeclarationId>,
  ): Doc {
    const keyword = declarationEmitterExportKeyword(d.id);
    const schema = declarationEmitterScope.effect("Schema");
    const tag = ["readonly _tag: ", JSON.stringify(tokenOfId(d.id)), ";"];
    function members(print: (type: Type) => Doc): Doc[] {
      return fields.map((f) => [
        "readonly ",
        f.name,
        f.optional ? "?" : "",
        ": ",
        print(f.type),
        ";",
      ]);
    }
    const mirror = declarationEmitterScope.encodedMirrorName(d.id);
    return [
      keyword,
      "interface ",
      d.name,
      " ",
      braces([
        tag,
        ...members((t) => typeDoc(declarationEmitterScope, t, undefined)),
      ]),
      hard,
      keyword,
      "interface ",
      mirror,
      " ",
      braces([
        tag,
        ...members((t) =>
          encodedTypeDoc(declarationEmitterScope, t, recursive)
        ),
      ]),
      hard,
      assignment(
        [keyword, "const ", d.name],
        declarationEmitterRefinedSchema(d, [
          `${schema}.TaggedStruct`,
          declarationEmitterTagArguments(d.id, fields, recursive),
        ]),
        undefined,
      ),
      ";",
    ];
  }
  function declarationEmitterTagArguments(
    id: DeclarationId,
    declared: readonly Field[],
    recursive: ReadonlySet<DeclarationId> | undefined,
  ): Doc {
    const fields = schemaFieldDocs(
      declarationEmitterScope,
      declared,
      recursive,
    );
    const object: Doc = bracketed("{", "}", fields, true);
    return group(
      [
        "(",
        indent([soft, JSON.stringify(tokenOfId(id)), ",", line, object]),
        ifBreak(",", undefined),
        soft,
        ")",
      ],
      undefined,
      undefined,
    );
  }
  function declarationEmitterErrorDeclaration(d: ErrorDecl): Doc {
    const schema = declarationEmitterScope.effect("Schema");
    const args = declarationEmitterTagArguments(d.id, d.fields, undefined);
    const keyword = declarationEmitterExportKeyword(d.id);
    const heritage: Doc = [
      `${schema}.TaggedError`,
      typeArguments([d.name]),
      "()",
    ];
    let body: Doc = " {}";
    if (
      d.fields.some((f) =>
        (f.optional && sensitiveField(f.name)) || f.name === "__proto__"
      )
    ) {
      const presence = declarationEmitterScope.fieldHelper("suppliedFields");
      const shape: Type = { kind: "record", fields: d.fields };
      body = [
        " ",
        braces([[
          "constructor(fields: ",
          typeDoc(declarationEmitterScope, shape, undefined),
          d.fields.every((f) => f.optional)
            ? [
              " = ",
              declarationEmitterScope.fieldHelper("record"),
              "<",
              typeDoc(declarationEmitterScope, shape, undefined),
              ">({})",
            ]
            : "",
          ") ",
          braces([
            [
              "super(",
              declarationEmitterScope.fieldHelper("record"),
              "<",
              typeDoc(declarationEmitterScope, shape, undefined),
              ">(fields));",
            ],
            "globalThis.Object.setPrototypeOf(this, new.target.prototype);",
            ...d.fields.filter((f) => sensitiveField(f.name)).map((f) =>
              `if (globalThis.Object.hasOwn(fields, ${
                JSON.stringify(f.name)
              })) globalThis.Object.defineProperty(this, ${
                JSON.stringify(f.name)
              }, { value: fields.${f.name}, enumerable: true, configurable: true, writable: true });`
            ),
            `globalThis.Object.defineProperty(this, ${presence}, { value: new globalThis.Set(globalThis.Object.keys(fields)) });`,
          ]),
        ]]),
      ];
    }
    // `deno fmt` moves `extends` to its own line when the first line is too wide.
    if (
      `${keyword}class ${d.name} extends ${schema}.TaggedError<${d.name}>()(`
        .length > LINE_WIDTH
    ) {
      return [
        `${keyword}class ${d.name}`,
        indent([hard, "extends ", heritage, args, body]),
      ];
    }
    return [`${keyword}class ${d.name} extends `, heritage, args, body];
  }
  function declarationEmitterServiceDeclaration(d: ServiceDecl): Doc {
    const context = declarationEmitterScope.effect("Context");
    const methods = d.methods.map((m) => [
      "readonly ",
      m.name,
      ": ",
      typeDoc(declarationEmitterScope, m.type, undefined),
      ";",
    ]);
    const members: Doc = braces(methods);
    const keyword = declarationEmitterExportKeyword(d.id);
    const argumentsDoc: Doc =
      `  extends ${context}.Service<${d.name}, {`.length > LINE_WIDTH
        ? typeArguments([d.name, members])
        : ["<", d.name, ", ", members, ">"];
    const heritage: Doc = [
      "extends ",
      `${context}.Service`,
      argumentsDoc,
      callWith("()", JSON.stringify(tokenOfId(d.id))),
      " {}",
    ];
    // `deno fmt` moves `extends` to its own line when the first line is too wide.
    const opening = methods.length === 0 ? "{}>()(" : "{";
    const first =
      `${keyword}class ${d.name} extends ${context}.Service<${d.name}, ${opening}`;
    if (first.length > LINE_WIDTH) {
      return [`${keyword}class ${d.name}`, indent([hard, heritage])];
    }
    return [`${keyword}class ${d.name} `, heritage];
  }
  function declarationEmitterFunctionDeclaration(d: FunctionDecl): Doc {
    const header = functionHeaderDoc(declarationEmitterScope, d, "contract");
    const prefix: Doc = [
      declarationEmitterExportKeyword(d.id),
      "const ",
      d.name,
    ];
    if (
      d.type.execution === "pure" && d.body.kind === "block" &&
      d.body.steps.length > 0
    ) {
      const statements = declarationEmitterExpr.blockStatements(
        d.body,
        false,
        d.type.result,
      );
      return [
        assignment(
          prefix,
          declarationEmitterExpr.arrowBlock(header, statements),
          undefined,
        ),
        ";",
      ];
    }
    const body = d.type.execution === "effect"
      ? declarationEmitterExpr.asEffect(d.body, d.type.result)
      : declarationEmitterExpr.fit(d.body, d.type.result, "pure");
    if (d.type.checked?.some(Boolean)) {
      const effect = declarationEmitterScope.effect("Effect");
      const schema = declarationEmitterScope.effect("Schema");
      const argumentsDoc: Doc[] = [];
      const statements: Doc[] = [];
      for (const parameterEntry of d.parameters.entries()) {
        const index = parameterEntry[0];
        const parameter = parameterEntry[1];
        if (d.type.checked[index]) {
          const decoded = declarationEmitterScope.temp();
          statements[statements.length] = [
            "const ",
            decoded,
            " = yield* ",
            `${schema}.decodeUnknownEffect(`,
            `${schema}.toType(`,
            schemaDoc(declarationEmitterScope, parameter.type, undefined),
            '), { onExcessProperty: "error" })(',
            parameter.name,
            ");",
          ];
          argumentsDoc[argumentsDoc.length] = decoded;
        } else {
          argumentsDoc[argumentsDoc.length] = parameter.name;
        }
      }
      const typedHeader = functionHeaderDoc(declarationEmitterScope, {
        ...d,
        type: { ...d.type, checked: d.parameters.map(() => false) },
      }, "always");
      statements[statements.length] = [
        "return yield* ((",
        typedHeader,
        " => ",
        at(body, 0),
        ")(",
        join(", ", argumentsDoc),
        "));",
      ];
      const checkedBody = [
        `${effect}.gen(function* () {`,
        indent([hard, join(hard, statements)]),
        hard,
        "})",
      ];
      return [
        assignment(prefix, [header, " => ", checkedBody], undefined),
        ";",
      ];
    }
    return [declarationEmitterExpr.arrowDeclaration(prefix, header, body), ";"];
  }
  function declarationEmitterConstantDeclaration(d: ConstantDecl): Doc {
    const value = declarationEmitterExpr.fit(d.value, d.type, "pure");
    return [
      declarationEmitterExportKeyword(d.id),
      "const ",
      d.name,
      ": ",
      constantTypeDoc(declarationEmitterScope, d),
      " = ",
      at(value, 0),
      ";",
    ];
  }
  function declarationEmitterCheckKind(
    type: Type,
    seen: Set<DeclarationId>,
  ): "tagged" | "plain" | "none" {
    if (isDeferredKind(type)) {
      return "none";
    }
    function all(types: readonly Type[]): "tagged" | "plain" | "none" {
      let kind: "tagged" | "plain" | "none" = "plain";
      for (const t of types) {
        const found = declarationEmitterCheckKind(t, seen);
        if (found === "none") {
          return "none";
        }
        if (found === "tagged") {
          kind = "tagged";
        }
      }
      return kind;
    }
    if (type.kind === "primitive" || type.kind === "literal") return "plain";
    if (type.kind === "named") {
      if (seen.has(type.id)) return "plain";
      seen = seen.add(type.id);
      const declaration = declarationEmitterScope.typeLevelDeclaration(type.id);
      if (declaration === undefined || declaration.kind === "service") {
        return "none";
      }
      if (declaration.kind === "error") return "plain";
      if (trueFlag(declaration.opaque)) return "none";
      if (taggedFields(declaration) !== undefined) return "tagged";
      return declaration.definition.kind === "alias"
        ? declarationEmitterCheckKind(declaration.definition.type, seen)
        : "plain";
    }
    return all(childTypes(type));
  }
  function declarationEmitterWrappedProvider(
    host: {
      readonly local: string;
    },
    provider: Extract<Type, {
      readonly kind: "provider";
    }>,
  ): {
    readonly checks: Doc[];
    readonly value: Doc;
  } | undefined {
    const services = servicesOf(provider.provides).map((id) => {
      const declaration = declarationEmitterScope.typeLevelDeclaration(id);
      if (declaration?.kind !== "service") {
        return internal(`the provided service ${id} is not a service`);
      }
      return declaration;
    });
    const planned = services.map((service) =>
      service.methods.map((method) => {
        // A method checks its result, or the element of a result stream.
        const resolved = declarationEmitterScope.resolve(method.type.result);
        const stream = resolved.kind === "stream";
        const type = resolved.kind === "stream"
          ? resolved.element
          : method.type.result;
        const checked =
          declarationEmitterCheckKind(type, emptySet()) === "tagged"
            ? { type: type, stream: stream }
            : undefined;
        return { method: method, checked: checked };
      })
    );
    if (!planned.some((methods) => methods.some((m) => m.checked))) {
      return undefined;
    }
    const layer = declarationEmitterScope.effect("Layer");
    const effect = declarationEmitterScope.effect("Effect");
    const checks: Doc[] = [];
    const rebuilt = services.map((service, i) => {
      const serviceName = declarationEmitterScope.nameOf(service.id);
      const self = declarationEmitterScope.serviceParameter();
      const entries = planned[i].map((plannedMethod) => {
        const method = plannedMethod.method;
        const checked = plannedMethod.checked;
        const names = method.type.parameters.map((_, k) => parameterName(k));
        const call: Doc = [
          `${self}.${method.name}`,
          bracketed("(", ")", names, false),
        ];
        let body: Doc = call;
        if (checked !== undefined) {
          const check = declarationEmitterScope.fresh(
            `${host.local}$${method.name}`,
          );
          const label = `${nameOfId(service.id)}.${method.name}`;
          checks[checks.length] = [
            assignment(`const ${check}`, [
              declarationEmitterScope.hostCheck(),
              bracketed("(", ")", [
                schemaDoc(declarationEmitterScope, checked.type, undefined),
                JSON.stringify(label),
                // A missing optional field named as on `Object.prototype` needs a copy without a prototype.
                ...(needsFieldAdapter(declarationEmitterScope, checked.type)
                  ? [
                    declarationEmitterScope.fieldAdapter(
                      checked.type,
                      "decoded",
                    ),
                  ]
                  : []),
              ], false),
            ], undefined),
            ";",
          ];
          if (checked.stream) {
            const stream = declarationEmitterScope.effect("Stream");
            body = [
              `${effect}.map`,
              bracketed("(", ")", [
                call,
                group(
                  [
                    "(stream) =>",
                    indent([
                      line,
                      `${stream}.map`,
                      bracketed("(", ")", ["stream", check], false),
                    ]),
                  ],
                  undefined,
                  undefined,
                ),
              ], false),
            ];
          } else {
            body = [`${effect}.map`, bracketed("(", ")", [call, check], false)];
          }
        }
        return [
          `${method.name}: (${names.join(", ")}) =>`,
          group(indent([line, body]), undefined, undefined),
        ];
      });
      const object: Doc = entries.length === 0 ? "{}" : [
        "{",
        indent([hard, join([",", hard], entries), ","]),
        hard,
        "}",
      ];
      return [
        `${layer}.effect(${serviceName})(`,
        indent([
          hard,
          `${effect}.gen(function* () {`,
          indent([
            hard,
            `const ${self} = yield* ${serviceName};`,
            hard,
            "return ",
            object,
            ";",
          ]),
          hard,
          "}),",
        ]),
        hard,
        ")",
      ];
    });
    const merged: Doc = rebuilt.length === 1 ? rebuilt[0] : [
      `${layer}.mergeAll(`,
      indent([hard, join(hard, rebuilt.map((r) => [r, ","]))]),
      hard,
      ")",
    ];
    return {
      checks: checks,
      value: [merged, `.pipe(${layer}.provide(${host.local}))`],
    };
  }
  function declarationEmitterHostAssertions(): Doc[] {
    const result: Doc[] = [];
    for (const hostEntry of declarationEmitterScope.hosts) {
      const target = hostEntry[0];
      const host = hostEntry[1];
      let provider: Type | undefined;
      for (const imported of declarationEmitterScope.ir.imports) {
        const found = imported.values.find((v) => v.id === target);
        if (found !== undefined) {
          provider = found.type;
        }
      }
      if (provider === undefined || provider.kind !== "provider") {
        return internal(`the host binding ${host.local} is not a provider`);
      }
      const wrapped = declarationEmitterWrappedProvider(host, provider);
      if (wrapped !== undefined) {
        for (const check of wrapped.checks) {
          result[result.length] = check;
        }
      }
      const data = {
        name: host.hostName,
        local: host.local,
        exported: host.exported,
        key: host.key,
      };
      result[result.length] = marked(data, [
        `const ${host.hostName}: `,
        typeDoc(declarationEmitterScope, provider, undefined),
        " = ",
        wrapped === undefined ? host.local : wrapped.value,
        ";",
      ]);
    }
    return result;
  }
  return {
    declaration: declarationEmitterDeclaration,
    hostAssertions: declarationEmitterHostAssertions,
  };
}
/** Emits exact integer comparisons after the schema establishes each field type. */
function predicateDoc(predicate: Predicate, input: string): Doc {
  function term(value: Term): string {
    if (value.kind === "zero") {
      return "0n";
    }
    if (value.kind === "input") {
      return `BigInt(${input})`;
    }
    const path = input +
      value.path.map((part) => `[${JSON.stringify(part)}]`).join("");
    return `BigInt(${path}${value.kind === "length" ? ".length" : ""})`;
  }
  if (predicate.kind === "constant") return String(predicate.value);
  if (predicate.kind === "not") {
    return ["!(", predicateDoc(predicate.operand, input), ")"];
  }
  if (predicate.kind === "and" || predicate.kind === "or") {
    if (predicate.operands.length === 0) {
      return String(predicate.kind === "and");
    }
    const separator = predicate.kind === "and" ? " && " : " || ";
    return [
      "(",
      join(
        separator,
        predicate.operands.map((operand) => predicateDoc(operand, input)),
      ),
      ")",
    ];
  }
  return `(${term(predicate.left)} - ${
    term(predicate.right)
  } <= ${predicate.maximum}n)`;
}
