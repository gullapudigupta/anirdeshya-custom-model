# Language Support and CI Coverage

## Runtime support

AQT requires Node.js 20 or newer. The CI workflow runs the test suite on
Node.js 20, 22, and 24 on Ubuntu, Windows, and macOS. The local test suite uses
the repository's dependency-free runner; external language toolchains are not
installed by `npm ci`.

## Analyzer integrations

Language analyzers invoke local tools rather than bundling language runtimes.
Install the relevant toolchain and configure its executable path where the
analyzer supports it. A missing tool or unrecognized failed command is
reported in the result's `error` field; a result with that field is incomplete
and must not be treated as a clean analysis.

| Language | Analyzer / tools | CI confidence |
| --- | --- | --- |
| JavaScript | Built-in analysis plus optional ESLint and Prettier integrations | Core test suite; no external linter required |
| TypeScript | TypeScript compiler-backed validation plus optional ESLint integration | Compiler validation is tested; no full project type-check guarantee |
| Python | Pylint, Flake8, Black, mypy, Bandit | Adapters are optional; CI does not install or execute Python tools |
| C# | `dotnet build` diagnostics and formatting checks | Adapter is optional; CI does not install or execute the .NET SDK |
| Go | golint, gofmt, and `go vet` | Output normalization is fixture-tested; CI does not install Go tools |
| PHP | PHPCS, PHPMD, and PHPStan | PHPCS JSON normalization is fixture-tested; CI does not install PHP tools |
| Ruby | RuboCop and Reek | Adapter is optional; CI does not install Ruby tools |
| Rust | Clippy and rustfmt | Cargo Clippy JSON-stream normalization is fixture-tested; CI does not install Rust tools |
| Swift | Optional SwiftLint command integration | Not included in the eight first-class language analyzers above |

The CI matrix verifies AQT's JavaScript test suite across the declared Node.js
versions and operating systems. It does not certify each external analyzer
against every version of its language-specific executable; those integrations
still need toolchain-specific acceptance coverage before being advertised as
fully certified.
