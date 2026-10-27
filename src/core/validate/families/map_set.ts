// Validation of the Map and Set operations. The validator recomputes each
// result type from the validated arguments and never imports the checker.

import type { Expr, Type } from "../../ir.ts";
import { AREA } from "../report.ts";
import { combine } from "../sets.ts";
import { BOOLEAN, dataOnly, fits, show, unfold } from "../typing.ts";
import {
  type Comp,
  derivedResult,
  type Out,
  type ValidatorCore,
} from "./context.ts";

type MapSetExpr = Extract<
  Expr,
  {
    kind:
      | "map-of"
      | "get-map"
      | "put-map"
      | "remove-map"
      | "has-map"
      | "entries-map"
      | "set-of"
      | "add-set"
      | "remove-set"
      | "has-set"
      | "items-set";
  }
>;

/** The key and value of a Map type, reported when the node is not one. */
function mapOf(
  c: ValidatorCore,
  e: MapSetExpr,
  out: Out,
  path: string,
  span: Expr,
): { readonly key: Type; readonly value: Type } | undefined {
  const type = unfold(c.env, out.type);
  if (type.kind === "map") return { key: type.key, value: type.value };
  c.add(
    AREA.types,
    path,
    `${e.kind} needs a Map value, found ${show(out.type)}`,
    span.span,
  );
  return undefined;
}

function setOf(
  c: ValidatorCore,
  e: MapSetExpr,
  out: Out,
  path: string,
  span: Expr,
): Type | undefined {
  const type = unfold(c.env, out.type);
  if (type.kind === "set") return type.element;
  c.add(
    AREA.types,
    path,
    `${e.kind} needs a Set value, found ${show(out.type)}`,
    span.span,
  );
  return undefined;
}

function argumentFits(
  c: ValidatorCore,
  e: MapSetExpr,
  operand: Out,
  expected: Type,
  path: string,
  child: Expr,
  what: string,
): void {
  if (fits(c.env, operand.type, expected)) return;
  c.add(
    AREA.types,
    path,
    `${e.kind} needs ${what} that fits ${show(expected)}, found ${
      show(operand.type)
    }`,
    child.span,
  );
}

/** The element of a list of entries, when it is a pair. */
function pairOf(
  c: ValidatorCore,
  type: Type,
): { readonly key: Type; readonly value: Type } | undefined {
  const list = unfold(c.env, type);
  if (list.kind !== "array") return undefined;
  const pair = unfold(c.env, list.element);
  if (pair.kind !== "tuple" || pair.elements.length !== 2) return undefined;
  return { key: pair.elements[0], value: pair.elements[1] };
}

export function mapSetOperation(
  c: ValidatorCore,
  e: MapSetExpr,
  path: string,
): Comp {
  switch (e.kind) {
    case "map-of": {
      const entries = c.check(e.entries, `${path}.entries`);
      const pair = pairOf(c, entries.type);
      if (pair === undefined) {
        c.add(
          AREA.types,
          `${path}.entries`,
          `map-of needs an array of [key, value] pairs, found ${
            show(entries.type)
          }`,
          e.entries.span,
        );
        return c.poison();
      }
      if (!dataOnly(c.env, pair.key, "value")) {
        c.add(
          AREA.types,
          `${path}.entries`,
          `a Map key must be data, found ${show(pair.key)}`,
          e.entries.span,
        );
      }
      return derivedResult(
        { kind: "map", key: pair.key, value: pair.value },
        combine([entries]),
        "fit",
      );
    }
    case "set-of": {
      const items = c.check(e.items, `${path}.items`);
      const list = unfold(c.env, items.type);
      if (list.kind !== "array") {
        c.add(
          AREA.types,
          `${path}.items`,
          `set-of needs an array, found ${show(items.type)}`,
          e.items.span,
        );
        return c.poison();
      }
      if (!dataOnly(c.env, list.element, "value")) {
        c.add(
          AREA.types,
          `${path}.items`,
          `a Set element must be data, found ${show(list.element)}`,
          e.items.span,
        );
      }
      return derivedResult(
        { kind: "set", element: list.element },
        combine([items]),
        "fit",
      );
    }
    case "get-map":
    case "remove-map":
    case "has-map":
    case "put-map": {
      const map = c.check(e.map, `${path}.map`);
      const key = c.check(e.key, `${path}.key`);
      const value = e.kind === "put-map"
        ? c.check(e.value, `${path}.value`)
        : undefined;
      const parts = mapOf(c, e, map, `${path}.map`, e.map);
      if (parts === undefined) return c.poison();
      argumentFits(c, e, key, parts.key, `${path}.key`, e.key, "a key");
      if (e.kind === "put-map" && value !== undefined) {
        argumentFits(
          c,
          e,
          value,
          parts.value,
          `${path}.value`,
          e.value,
          "a value",
        );
      }
      const active = combine(
        value === undefined ? [map, key] : [map, key, value],
      );
      switch (e.kind) {
        case "get-map":
          return derivedResult(
            { kind: "option", element: parts.value },
            active,
          );
        case "has-map":
          return derivedResult(BOOLEAN, active);
        default:
          return derivedResult(
            { kind: "map", key: parts.key, value: parts.value },
            active,
          );
      }
    }
    case "entries-map": {
      const map = c.check(e.map, `${path}.map`);
      const parts = mapOf(c, e, map, `${path}.map`, e.map);
      if (parts === undefined) return c.poison();
      return derivedResult({
        kind: "array",
        element: { kind: "tuple", elements: [parts.key, parts.value] },
      }, combine([map]));
    }
    case "add-set":
    case "remove-set":
    case "has-set": {
      const set = c.check(e.set, `${path}.set`);
      const element = c.check(e.element, `${path}.element`);
      const item = setOf(c, e, set, `${path}.set`, e.set);
      if (item === undefined) return c.poison();
      argumentFits(
        c,
        e,
        element,
        item,
        `${path}.element`,
        e.element,
        "an element",
      );
      const active = combine([set, element]);
      return e.kind === "has-set"
        ? derivedResult(BOOLEAN, active)
        : derivedResult({ kind: "set", element: item }, active);
    }
    case "items-set": {
      const set = c.check(e.set, `${path}.set`);
      const item = setOf(c, e, set, `${path}.set`, e.set);
      if (item === undefined) return c.poison();
      return derivedResult({ kind: "array", element: item }, combine([set]));
    }
    default: {
      const unreachable: never = e;
      return unreachable;
    }
  }
}
