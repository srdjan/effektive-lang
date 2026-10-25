# Changelog

## Unreleased

- The generated-code view of the editor and the playground shows the
  companion module `h.effi.ts` for a host interface file `h.effi`.
- The build no longer overwrites a `.ts` file that it did not generate. It
  reports an error and leaves the file and its map unwritten. Files from
  versions before the rename to Effektive carry another header and are now
  refused. Delete them once.
- `deno.json` is the only source of the release version. `deno task package`
  writes it into the packaged extension manifest. The VSIX file is now
  `dist/effektive-vscode.vsix`, with no version in its name.

## 0.9.0 - 2026-10-25

A plain `type` declaration now has identity by name. The `nominal` keyword is gone.

- `type UserId = string`, `type Cents = int`, and `type Status = "pending" | "paid"`
  have identity. Two different types with identity never mix, also when their
  bodies are equal. A literal or an operator result fits the type with no call.
- A union with a non-literal member, such as `type Article = Draft | Published`,
  and a bare name, such as `type Alias = User`, stay transparent aliases.
- A record type that a union of its own module lists is a tagged record. A
  record literal at exactly that type constructs it with no call.
- The emitted TypeScript of an untagged type is the schema and the type of its body.

Breaking changes:

- `nominal` is an ordinary name. Replace `nominal Name = T` with `type Name = T`.
- The IR moves to version 5. It adds the flag `tagged` on a `nominal` definition.
- `declaration/014` is deleted. `declaration/017` reports `sealed` on a transparent alias.

The [language rules](docs/language-rules.md) and the language specification
describe type identity. Requires Deno 2.9.8 and targets Effect 4.0.5.

## 0.8.0 - 2026-10-24

Write less source while keeping explicit exported contracts:

- Omit parentheses around a single unannotated callback parameter: `user => user.name`.
- Unwrap an Option with `option ?? fallback`; the fallback runs only for `None`.
- Bind record fields inside a block: `const { id, revision: expectedRevision } = article`.
- Manage resources with `using (job = openJob()) { job.execute() } finally { job.close() }`.

The editor supports navigation, rename, completion, hover, and highlighting for
these forms. Examples and the language specification use the new syntax.

Includes the standalone CLI, language server, VS Code extension, and browser
playground. Requires Deno 2.9.8 and targets Effect 4.0.5.
