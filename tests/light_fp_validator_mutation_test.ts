import { assert, assertEquals } from "@std/assert";
import { allExprs, forgedModule } from "./helpers.ts";

Deno.test("the validator widens a literal boolean Ref seed to boolean", () => {
  assertEquals(
    forgedModule(
      `const update = (): void => {
  const ref = makeRef(false)
  setRef(ref, true)
}
`,
      (ir) => {
        const [makeRef] = allExprs(ir, "make-ref");
        assert(makeRef !== undefined);
        Object.assign(makeRef.value, {
          type: { kind: "literal", value: false },
        });
      },
    ),
    [],
  );
});

Deno.test("the validator rejects a refinement proof over an empty union", () => {
  assertEquals(
    forgedModule(
      `type Int = int
type Input = { value: Int }
type Positive = int where n => n > 0
const guarded = (input: Input): Positive =>
  if (input.value > 0 && input.value < 1) { 0 } else { 1 }
`,
      (ir) => {
        const input = ir.declarations[1];
        assert(input?.kind === "type");
        assert(input.definition.kind === "nominal");
        Object.assign(input.definition, {
          base: { kind: "union", members: [] },
        });
      },
    ),
    [
      "validation/002 declarations[3].body.condition.left.left.type: expected never, recorded type:m#Int",
      "validation/002 declarations[3].body.condition.left: the operator > does not accept operands of type never and int",
      "validation/002 declarations[3].body.condition.right.left.type: expected never, recorded type:m#Int",
      "validation/002 declarations[3].body.condition.right: the operator < does not accept operands of type never and int",
      "validation/002 declarations[3].body.then.result.proofs: the proof certificate is invalid: invalid-certificate",
    ],
  );
});
