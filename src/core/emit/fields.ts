import { emptySet, setFrom } from "../runtime.ts";
// Property semantics at the JavaScript boundary. Adapters follow declared data
// shapes only: they do not traverse arbitrary host objects or deferred values.
import type { Field, Type, TypeDecl } from "../ir.ts";
import { type Doc, hard } from "./doc.ts";
import type { ExprScope, TypeLookup } from "./module_state.ts";
type FieldName = Field["name"];
type FieldCheck = boolean;
export function fieldKey(name: FieldName): FieldName {
  return name === "__proto__" ? '["__proto__"]' : name;
}
export function prototypeField(name: FieldName): FieldCheck {
  return Object.hasOwn(Object.prototype, name);
}
export function sensitiveField(name: FieldName): FieldCheck {
  return Object.hasOwn(Object.prototype, name) ||
    ["message", "name", "stack"].includes(name);
}
/** The fields of a nominal type over a record, which lowers to a tagged record. Other declarations give undefined. */
export function taggedFields(d: TypeDecl): readonly Field[] | undefined {
  return d.definition.kind === "nominal" &&
      typeof d.definition.tagged === "boolean" && d.definition.tagged &&
      d.definition.base.kind === "record"
    ? d.definition.base.fields
    : undefined;
}
/** The type that a type declaration stands for: the alias target or the nominal base. */
function definitionType(d: TypeDecl): Type {
  return d.definition.kind === "alias" ? d.definition.type : d.definition.base;
}
export function needsFieldAdapter(scope: TypeLookup, type: Type): FieldCheck {
  return needsFieldAdapterIn(scope, type, emptySet<string>());
}
function needsFieldAdapterIn(
  scope: TypeLookup,
  type: Type,
  seen: ReadonlySet<string>,
): boolean {
  {
    const kind_1 = type.kind;
    if (kind_1 === "named") {
      if (seen.has(type.id)) {
        return false;
      }
      const next = setFrom([...seen, type.id]);
      const declaration = scope.typeLevelDeclaration(type.id);
      if (declaration?.kind === "error") {
        return false;
      }
      return declaration?.kind === "type" &&
        needsFieldAdapterIn(scope, definitionType(declaration), next);
    } else if (kind_1 === "record") {
      return type.fields.some((f) =>
        prototypeField(f.name) || needsFieldAdapterIn(scope, f.type, seen)
      );
    } else if (kind_1 === "option" || kind_1 === "array") {
      return needsFieldAdapterIn(scope, type.element, seen);
    } else if (kind_1 === "tuple") {
      return type.elements.some((t) => needsFieldAdapterIn(scope, t, seen));
    } else if (kind_1 === "union") {
      return type.members.some((t) => needsFieldAdapterIn(scope, t, seen));
    } else if (
      kind_1 === "primitive" || kind_1 === "literal" || kind_1 === "ref" ||
      kind_1 === "retry-schedule" || kind_1 === "schema" ||
      kind_1 === "effect" || kind_1 === "stream" || kind_1 === "sink" ||
      kind_1 === "function" || kind_1 === "provider"
    ) {
      return false;
    } else {
      {
        const unreachable: never = type;
        return unreachable;
      }
    }
  }
}
function adapterBody(
  scope: ExprScope,
  type: Type,
  direction: "decoded" | "encoded" | "make",
): string {
  function apply(child: Type, value: string): string {
    return needsFieldAdapter(scope, child)
      ? `${scope.fieldAdapter(child, direction)}(${value})`
      : value;
  }
  let fields: readonly Field[];
  if (type.kind === "named") {
    const d = scope.typeLevelDeclaration(type.id);
    if (d?.kind === "type") {
      return `return ${apply(definitionType(d), "value")};`;
    }
    // Any other named type keeps its value. Compiler-derived error schemas are
    // nominal identity schemas: never clone their instances, because class
    // validation and recovery rely on that identity.
    return "return value;";
  } else if (type.kind === "record") {
    fields = type.fields;
  } else if (type.kind === "option") {
    const option = scope.effect("Option");
    return `return ${option}.isOption(value) ? ${option}.map(value, item => ${
      apply(type.element, "item")
    }) : value;`;
  } else if (type.kind === "array") {
    return `return globalThis.Array.isArray(value) ? value.map(item => ${
      apply(type.element, "item")
    }) : value;`;
  } else if (type.kind === "tuple") {
    return `return globalThis.Array.isArray(value) ? value.map((item, index) => { switch (index) { ${
      type.elements.map((t, i) => `case ${i}: return ${apply(t, "item")};`)
        .join(" ")
    } default: return item; } }) : value;`;
  } else if (type.kind === "union") {
    // Discriminated records select their declared branch; other members adapt
    // only their own fields, so sequential adaptation preserves unrelated data.
    const branches = type.members.map((member) => {
      const resolved = scope.resolve(member);
      const tag = resolved.kind === "record"
        ? resolved.fields.find((f) => f.type.kind === "literal")
        : undefined;
      if (tag?.type.kind !== "literal") {
        return undefined;
      }
      return `if (typeof value === "object" && value !== null && globalThis.Reflect.get(value, ${
        JSON.stringify(tag.name)
      }) === ${JSON.stringify(tag.type.value)}) return ${
        apply(member, "value")
      };`;
    });
    return branches.every((b) => b !== undefined)
      ? `${branches.join("\n")}\nreturn value;`
      : `return ${type.members.reduce((v, t) => apply(t, v), "value")};`;
  } else {
    return "return value;";
  }
  const record = scope.fieldHelper("record");
  const transformations = fields.filter((f) => needsFieldAdapter(scope, f.type))
    .map((f) => {
      const key = JSON.stringify(f.name);
      return `if (globalThis.Object.hasOwn(out, ${key})) globalThis.Object.defineProperty(out, ${key}, { value: ${
        apply(f.type, `out[${key}]`)
      }, enumerable: true, configurable: true, writable: true });`;
    });
  return `if (typeof value !== "object" || value === null || globalThis.Array.isArray(value)) return value;
const out = ${record}<{ [key: string]: unknown }>(value);
${transformations.join("\n")}
return out;`;
}
/** Emit only the helpers requested by this module, allocating dependencies first. */
export function fieldHelperDeclarations(scope: ExprScope): Doc[] {
  const adapters: string[] = [];
  for (const adapter of scope.fieldAdapters()) {
    const name = adapter.name;
    const type = adapter.type;
    const direction = adapter.direction;
    {
      const _appendTarget1 = adapters;
      const _appendValue2 = `function ${name}(value: unknown): unknown {\n${
        adapterBody(scope, type, direction)
      }\n}`;
      _appendTarget1[_appendTarget1.length] = _appendValue2;
    }
  }
  const optional = scope.fieldHelpers.get("optionalField");
  const presence = optional === undefined
    ? scope.fieldHelpers.get("suppliedFields")
    : scope.fieldHelper("suppliedFields");
  const helpers: string[] = [];
  if (presence !== undefined) {
    {
      const _appendTarget3 = helpers;
      const _appendValue4 =
        `const ${presence} = globalThis.Symbol.for("effektive/source-fields");`;
      _appendTarget3[_appendTarget3.length] = _appendValue4;
    }
  }
  const untagged = scope.fieldHelpers.get("untagged");
  if (untagged !== undefined) {
    {
      const _appendTarget5 = helpers;
      const _appendValue6 =
        `// A data value carries \`_tag\`. The copy leaves it out and has no prototype.
const ${untagged} = <T>(value: object): T =>
  globalThis.Object.assign(
    globalThis.Object.create(null),
    globalThis.Object.fromEntries(
      globalThis.Object.entries(value).filter(([key]) => key !== "_tag"),
    ),
  );`;
      _appendTarget5[_appendTarget5.length] = _appendValue6;
    }
  }
  const record = scope.fieldHelpers.get("record");
  if (record !== undefined) {
    {
      const _appendTarget7 = helpers;
      const _appendValue8 =
        `// Source checking establishes T; this boundary supplies JavaScript own-field semantics.
const ${record} = <T>(value: unknown, adapt?: (value: unknown) => unknown): T => {
let output: unknown;
if (adapt !== undefined) output = adapt(value);
else {
  const descriptors = globalThis.Object.getOwnPropertyDescriptors(value);
  for (const key of globalThis.Reflect.ownKeys(descriptors)) globalThis.Reflect.get(descriptors, key).configurable = true;
  output = globalThis.Object.defineProperties(globalThis.Object.create(null), descriptors);
}
return output as T;
};`;
      _appendTarget7[_appendTarget7.length] = _appendValue8;
    }
  }
  if (optional !== undefined) {
    const option = scope.effect("Option");
    {
      const _appendTarget9 = helpers;
      const _appendValue10 =
        `const ${optional} = <T>(value: object, key: string): ${option}.Option<T> => {
const supplied: unknown = globalThis.Reflect.get(value, ${presence});
return globalThis.Object.hasOwn(value, key) && (!(supplied instanceof globalThis.Set) || supplied.has(key)) ? ${option}.some<T>(globalThis.Reflect.get(value, key)) : ${option}.none();
};`;
      _appendTarget9[_appendTarget9.length] = _appendValue10;
    }
  }
  // Fixed helper bodies stay inside the Doc renderer, which owns source spans;
  // the emitter has no runtime formatter dependency.
  return [...helpers, ...adapters].map((text) =>
    text.split("\n").flatMap((line, i) => i === 0 ? [line] : [hard, line])
  );
}
