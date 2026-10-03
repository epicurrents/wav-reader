import { defineConfig } from 'vitest/config'
import { ALIASES } from './vite.shared.mjs'

export default defineConfig({
    resolve: {
        alias: ALIASES,
    },
    test: {
        environment: 'jsdom',
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reportsDirectory: 'tests/coverage',
            // Measured over the whole source tree, not only the modules a test happens to import. The
            // default reports loaded files alone, which hides an untested module entirely instead of
            // scoring it zero and flatters the total by the size of whatever is missing.
            include: ['src/**/*.ts'],
        },
    },
})
