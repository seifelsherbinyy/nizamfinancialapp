#!/usr/bin/env node
/**
 * NIZAM · The resolve hook the test ladder needs, and the defect it exists to expose
 * Owning mandate: `.kiro/specs/06-two-agent-vps/KIRO_SHIP_LIVE.prompt.md` §9, executed by spec task
 *   10.12. Finding **F20**.
 *
 * ## What this is
 *
 * Node's ESM resolver performs no extension search. Every relative import under `src/` is written
 * extensionless — `import { main } from './main'` — which the project's own toolchain resolves
 * (`moduleResolution: "bundler"`, and Vite and Vitest both do the same search). **Bare `node` does
 * not.** So `node src/server/process/start.ts` fails with `ERR_MODULE_NOT_FOUND` on its very first
 * import, before any environment is read, on every host, for every mode.
 *
 * That is **F20**, and it is not this file's job to fix it: it blocks rung **L2** for all three images
 * this repository owns, because each Dockerfile's `ENTRYPOINT` and each `--health` command invokes one
 * of these shims with bare `node`. The fix is a packaging decision — either an extension on every
 * relative specifier in the graph (with `allowImportingTsExtensions`), or a build step that emits
 * runnable modules into the image — and it belongs to the task that owns the build path, with its own
 * tests and its own commit.
 *
 * ## Why it exists anyway
 *
 * Rung L0's pass condition is about the LOADER refusing an incomplete environment, observed through
 * the real entrypoint in its own process rather than through an in-process assertion. F20 would
 * otherwise make that observation impossible to take at all, and "L0 unobserved because the shim
 * cannot be launched" hides two facts behind one. This hook restores exactly the resolution the
 * project's own toolchain performs — nothing more — so the rung observes the real `main`, the real
 * loader and the real store, in a real child process, and F20 is recorded as its own finding instead
 * of being confused with a loader defect.
 *
 * It appends what the specifier omits and it changes nothing else: no transform, no path mapping, no
 * condition, no default export invention. A specifier that already carries an extension, a bare
 * package name and a builtin all go straight to the next resolver untouched.
 */
import { registerHooks } from 'node:module';

/** A specifier that already says what it is. Left alone. */
const HAS_EXTENSION = /\.(?:[cm]?[jt]sx?|json|node|css)(?:\?|#|$)/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !HAS_EXTENSION.test(specifier)) {
      // The two shapes the toolchain resolves: a file, then a directory's index.
      for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
        try {
          return nextResolve(candidate, context);
        } catch {
          // Try the next shape; if neither resolves, fall through to the unmodified specifier so the
          // error the caller sees is the real one about what they actually wrote.
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
