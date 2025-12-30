---
documentationType: reference
outline: deep
---

# Contributing to Emmett

We welcome contributions! This guide covers everything you need to get started.

## Ways to Contribute

| Type | Description |
|------|-------------|
| 🐛 Bug Reports | Found something broken? Open an issue |
| 💡 Feature Requests | Have an idea? Start a discussion |
| 📖 Documentation | Improve guides, fix typos, add examples |
| 🧪 Tests | Increase coverage, add edge cases |
| 💻 Code | Fix bugs, implement features |

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 8+
- Docker (for integration tests)

### Setup

```bash
# Clone the repository
git clone https://github.com/event-driven-io/emmett.git
cd emmett

# Install dependencies
pnpm install

# Build all packages
pnpm run build

# Run tests
pnpm run test
```

### Project Structure

```
src/
├── packages/
│   ├── emmett/              # Core package
│   ├── emmett-postgresql/   # PostgreSQL event store
│   ├── emmett-esdb/         # EventStoreDB adapter
│   ├── emmett-mongodb/      # MongoDB event store
│   ├── emmett-sqlite/       # SQLite event store
│   ├── emmett-expressjs/    # Express.js integration
│   ├── emmett-fastify/      # Fastify integration
│   ├── emmett-testcontainers/  # Test utilities
│   └── emmett-shims/        # Polyfills
├── docs/                    # Documentation (VitePress)
└── samples/                 # Sample applications
```

## Development Workflow

### Running Tests

```bash
# All tests
pnpm run test

# Specific package
pnpm --filter @event-driven-io/emmett run test

# Watch mode
pnpm --filter @event-driven-io/emmett run test:watch

# With coverage
pnpm run test:coverage
```

### Building

```bash
# All packages
pnpm run build

# Specific package
pnpm --filter @event-driven-io/emmett run build

# Watch mode (development)
pnpm --filter @event-driven-io/emmett run build:watch
```

### Linting and Formatting

```bash
# Check linting
pnpm run lint

# Fix linting issues
pnpm run lint:fix

# Format code
pnpm run format
```

## Making Changes

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-description
```

### 2. Make Your Changes

- Follow existing code style
- Add tests for new functionality
- Update documentation if needed

### 3. Test Your Changes

```bash
# Run tests for affected packages
pnpm run test

# Run full build
pnpm run build
```

### 4. Commit Your Changes

We use conventional commits:

```bash
# Features
git commit -m "feat(postgresql): add batch event appending"

# Bug fixes
git commit -m "fix(esdb): handle connection timeouts"

# Documentation
git commit -m "docs: add workflow examples"

# Breaking changes
git commit -m "feat(core)!: rename Event to DomainEvent"
```

### 5. Open a Pull Request

- Fill out the PR template
- Link related issues
- Wait for CI to pass
- Address review feedback

## Code Style

### TypeScript Guidelines

```typescript
// ✅ Good: Use explicit types for exports
export type ShoppingCartEvent =
  | Event<'ProductItemAdded', { productId: string; quantity: number }>
  | Event<'ShoppingCartConfirmed', { confirmedAt: Date }>;

// ✅ Good: Use readonly for immutable data
interface ShoppingCart {
  readonly id: string;
  readonly items: readonly ProductItem[];
}

// ✅ Good: Prefer const assertions
const STATUSES = ['Pending', 'Confirmed', 'Cancelled'] as const;

// ✅ Good: Use discriminated unions
type Result<T> =
  | { success: true; value: T }
  | { success: false; error: Error };
```

### Testing Guidelines

```typescript
// ✅ Good: Use BDD-style specifications
describe('Shopping Cart', () => {
  it('adds product to empty cart', () =>
    spec([])
      .when(addProductCommand)
      .then([productAddedEvent]));
});

// ✅ Good: Test edge cases
it('rejects negative quantity', () =>
  spec([])
    .when({ type: 'AddProduct', data: { quantity: -1 } })
    .thenThrows(ValidationError));
```

## Adding a New Package

1. Create package directory under `src/packages/`
2. Add `package.json` with proper naming
3. Add to workspace in root `pnpm-workspace.yaml`
4. Create README following [package README template](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett#readme)
5. Add to documentation

## Documentation

### Running Docs Locally

```bash
cd src/docs
pnpm install
pnpm run dev
```

### Writing Documentation

- Use VitePress markdown features
- Include working code examples
- Follow the [Diataxis framework](https://diataxis.fr/):
  - **Tutorials**: Learning-oriented (Getting Started)
  - **How-to Guides**: Task-oriented (Guides)
  - **Reference**: Information-oriented (API Reference)
  - **Explanation**: Understanding-oriented (deep dives)

## Issue Guidelines

### Bug Reports

Include:
- Emmett version
- Node.js version
- Minimal reproduction
- Expected vs actual behavior
- Error messages/stack traces

### Feature Requests

Include:
- Use case description
- Proposed API (if applicable)
- Alternatives considered

## Getting Help

- 💬 [Discord](https://discord.gg/fTpqUTMmVa) - Quick questions
- 💬 [GitHub Discussions](https://github.com/event-driven-io/emmett/discussions) - Longer discussions
- 🐛 [GitHub Issues](https://github.com/event-driven-io/emmett/issues) - Bug reports

## Recognition

Contributors are recognized in:
- Release notes
- README contributors section
- GitHub contributors page

## Code of Conduct

We follow the [Contributor Covenant](https://www.contributor-covenant.org/). Be respectful, inclusive, and constructive.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](https://github.com/event-driven-io/emmett/blob/main/LICENSE).

## See Also

- [GitHub Repository](https://github.com/event-driven-io/emmett)
- [Discord Community](https://discord.gg/fTpqUTMmVa)
- [Packages Reference](/resources/packages)
