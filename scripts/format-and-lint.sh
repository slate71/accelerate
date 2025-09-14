#!/bin/bash

echo "🔧 Formatting and linting API code..."

cd api

# Install missing dependencies if needed
echo "📦 Installing dependencies..."
npm install

# Format with Prettier
echo "✨ Running Prettier..."
npx prettier --write "src/**/*.ts" || true

# Run ESLint with auto-fix
echo "🔍 Running ESLint..."
npx eslint src --fix --ext .ts || true

# Run TypeScript type checking
echo "📝 Running TypeScript type check..."
npm run typecheck

echo "✅ Formatting and linting complete!"
