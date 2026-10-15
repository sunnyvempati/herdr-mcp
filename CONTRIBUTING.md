# Contributing to herdr-mcp

Thank you for your interest in contributing to herdr-mcp!

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/herdr-mcp.git`
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b my-feature`

## Development

```bash
# Build
npm run build

# Run tests
npm test

# Watch mode during development
npm run dev
```

## Code Style

- Use TypeScript
- Follow existing code patterns
- Keep functions small and focused
- Add JSDoc comments for public APIs

## Testing

All changes should include tests. The test suite uses Node's built-in test runner with a fake herdr binary.

```bash
npm test
```

For end-to-end testing with a real herdr installation:

```bash
./scripts/smoke.sh
```

## Pull Requests

1. Ensure all tests pass
2. Update documentation if needed
3. Add a clear description of your changes
4. Reference any related issues

## Security

**Never add arbitrary shell execution.** All herdr interactions must go through the structured CLI with argument arrays (no shell string interpolation).

If you discover a security vulnerability, please report it privately to the maintainers rather than opening a public issue.

## Questions?

Open an issue for questions or discussion.
