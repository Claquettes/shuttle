# Publishing Scripts

## publish.sh

Script to publish Shuttle to npm and/or build Docker images.

### Usage

```bash
# Publish to npm only
./scripts/publish.sh npm 1.0.0

# Build Docker image only
./scripts/publish.sh docker

# Publish to both npm and build Docker image
./scripts/publish.sh both 1.0.0
```

### Prerequisites

- For npm: Must be logged in (`npm login`)
- For Docker: Docker must be running
- Node.js and npm installed

### What it does

1. Builds the TypeScript project
2. For npm: Updates version and publishes to npm
3. For Docker: Builds the production Docker image
4. Tags Docker images with version and latest

