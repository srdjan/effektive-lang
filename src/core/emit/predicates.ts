import type { Predicate, Term } from "../predicates.ts";
import type { Doc } from "./doc.ts";

/** Emits exact integer comparisons after the schema establishes each field type. */
export function predicateDoc(predicate: Predicate, input: string): Doc {
  const term = (value: Term): string => {
    if (value.kind === "zero") return "0n";
    if (value.kind === "input") return `BigInt(${input})`;
    const path = input +
      value.path.map((part) => `[${JSON.stringify(part)}]`).join("");
    return `BigInt(${path}${value.kind === "length" ? ".length" : ""})`;
  };
  switch (predicate.kind) {
    case "constant":
      return String(predicate.value);
    case "not":
      return ["!(", predicateDoc(predicate.operand, input), ")"];
    case "and":
    case "or": {
      if (predicate.operands.length === 0) {
        return String(predicate.kind === "and");
      }
      const separator = predicate.kind === "and" ? " && " : " || ";
      const out: Doc[] = ["("];
      predicate.operands.forEach((operand, index) => {
        if (index > 0) out.push(separator);
        out.push(predicateDoc(operand, input));
      });
      return [...out, ")"];
    }
    case "difference":
      return `(${term(predicate.left)} - ${
        term(predicate.right)
      } <= ${predicate.maximum}n)`;
  }
}
