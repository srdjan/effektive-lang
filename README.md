# Effektive

**Plain code. Typed effects.**

Effektive is a small functional language that compiles to TypeScript for Effect 4.
You write application logic with direct function calls. The compiler checks each
exported function's result, expected failures, and required service operations.

[Tutorial](docs/tutorial.md) · [Specification](https://effektive.timok.deno.net/effektive-spec.html) ·
[Playground](#playground) · [Project status](docs/status.md)

```eff
export type BookId = string
export type Title = string
export type Book = { id: BookId, title: Title }

export error BookMissing = { id: BookId }
export error StoreDown = { message: string }

export service Shelf {
  find(id: BookId): Option<Book> fails StoreDown
}

export const findBook = (id: BookId): Book
  fails BookMissing | StoreDown
  uses Shelf.find =>
  Shelf.find(id) ?? fail(BookMissing({ id }))
```

`findBook` returns a `Book`, can fail with either declared error, and requires
only `Shelf.find`. The `??` operator evaluates the fallback only when the service
returns `None`. The compiler rejects undeclared failures and service operations.

## Features

| Capability         | What it gives you                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Explicit contracts | Exported functions name their result, failures, and service operations. The compiler infers contracts for private functions.         |
| Domain types       | `BookId` and `Title` have separate identities even though both contain strings.                                                      |
| Effect runtime     | Concurrency, streams, and resource management compile to Effect 4. Typed host adapters connect external packages.                    |
| Editor support     | The language server supplies diagnostics, navigation, rename, completion, and contract fixes. VS Code previews generated TypeScript. |

## Requirements

The project needs Deno 2.9.8. Generated TypeScript targets Effect 4.0.5.
Building the VS Code extension also requires Node 20 or later with npm.

## Installation

Clone the repository and enter the checkout:

```sh
git clone https://github.com/srdjan/effective-lang.git
cd effective-lang
```

The commands below run directly from the checkout.
[Installation instructions](docs/installation.md) cover the standalone command-line
tool and the VS Code extension.

## Usage

Check the example project, then build its TypeScript:

```sh
deno task effektive check fixtures/tutorial
deno task effektive build fixtures/tutorial --tsc
```

`--tsc` checks the generated TypeScript. The first target check needs network
access to download dependencies.

```mermaid
flowchart LR
  A["Effektive source"] --> B["Checked contracts"]
  B --> C["TypeScript + source maps"]
  C --> D["Effect 4 runtime"]
```

`build` writes `.ts` and `.ts.map` files beside the source files. For automatic
rebuilds, run `deno task effektive watch fixtures/tutorial`.

The [tutorial](docs/tutorial.md) extends the example into a library application
with typed failures and resource cleanup. It includes the TypeScript host that
supplies services and runs the generated program.

### Playground

Start the local browser playground:

```sh
deno task playground:serve
```

Open <http://127.0.0.1:8790> to edit source and inspect diagnostics and generated
TypeScript.

## Documentation

| Start here                               | Read next                                                   |
| ---------------------------------------- | ----------------------------------------------------------- |
| [Tutorial](docs/tutorial.md)             | Build and run an application.                               |
| [Language rules](docs/language-rules.md) | Learn the implemented syntax and contracts.                 |
| [Tool reference](docs/api.md)            | Use the command-line tool, editor, and playground.          |
| [Architecture](docs/architecture.md)     | Follow the compiler pipeline and independent validation.    |
| [Development guide](docs/development.md) | Find tasks, the repository layout, and fixture conventions. |
| [Changelog](CHANGELOG.md)                | Review changes between versions.                            |

The [canonical specification](https://effektive.timok.deno.net/effektive-spec.html)
governs the language. Its source is in `../effektive/public/effektive-spec.html`.

## Status

The repository includes the compiler, command-line tool, language server,
VS Code extension, and browser playground. The
[project status](docs/status.md) records application checks, remaining gaps,
and release acceptance limits.

## Contributing

Read [AGENTS.md](AGENTS.md) for repository rules. Run the complete check before
each commit:

```sh
deno task check
```

The check runs formatting, lint, type checking, and all tests. It needs network
access, npm, and `unzip`. For the fast tests alone, run `deno task test`.

## License

[MIT](LICENSE) - Copyright 2026 Srdjan Strbanovic.
