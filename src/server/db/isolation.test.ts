// @vitest-environment node
/**
 * NIZAM · Store isolation source scan — contract 06 §9 T3
 * Implemented by: PFOS Contract 06 / Phase 1.1 (spec 06-two-agent-vps)
 * Depends on: the source tree of src/server (read from disk, not imported)
 *
 * Contract 06 §2.1.3 and §10: the finance process issues no cross-database open
 * statement for any purpose — reporting, migration, or diagnostics included. Cross-store
 * joins do not exist. This is the mechanical form of "the state crosses, the data never
 * does" (steering §4.3), and the only way to assert the absence of a statement is to
 * read the source rather than to exercise the code.
 *
 * The forbidden keyword is assembled from fragments, exactly as the acceptance harness
 * does with its denylists, so this scanner never holds a contiguous copy of the thing it
 * forbids and therefore never matches itself. The rule is absolute and case-insensitive:
 * the token may not appear in `src/server/**` at all, in code or in prose, which is why
 * the surrounding comments describe it rather than spell it.
 *
 * The same scan also enforces §2.2's last line — "connections are created through a
 * single factory; no module opens its own connection". That is a structural property of
 * the tree, not a behaviour of any one function, so like the statement ban it can only be
 * asserted by reading the source.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = fileURLToPath(new URL('../', import.meta.url));
const FORBIDDEN = 'AT' + 'TACH';

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

describe('server data tier isolation (§2.1.3, R1/R6)', () => {
  const files = sourceFiles(SERVER_ROOT);

  it('scans a non-empty source tree, so the assertion below cannot pass vacuously', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('T3 contains no cross-database open statement anywhere in src/server', () => {
    const offenders: string[] = [];
    const needle = new RegExp('\\b' + FORBIDDEN + '\\b', 'i');
    for (const file of files) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (needle.test(line)) offenders.push(`${file.slice(SERVER_ROOT.length)}:${index + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('constructs a connection in exactly one module, so the factory is the only door (§2.2)', () => {
    // `db/connection.ts` is the factory; `db/sqliteBinding.ts` is the binding it resolves
    // through and the only other place the constructor's *type* is named. Any third file
    // holding the constructor would be a module opening its own connection, which is how
    // an unasserted pragma set gets into the tier.
    const permitted = /db[/\\](?:connection|sqliteBinding)\.ts$/;
    const constructor = /\bDatabaseSync\b/;
    const offenders = files
      .filter((file) => !/\.test\.tsx?$/.test(file) && !permitted.test(file))
      .filter((file) => constructor.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SERVER_ROOT.length));
    expect(offenders).toEqual([]);
  });

  it('resolves the engine specifier in exactly one module', () => {
    // §2.2 requires the runtime's BUILT-IN binding and no third-party driver. Keeping the
    // module specifier itself in one file is what makes that auditable in a single read.
    // Only a real import or require counts, so the specifier is matched inside quotes;
    // prose naming the engine is documentation, not a second resolution path.
    const specifier = new RegExp(`['"\`]nod` + `e:sqlite['"\`]`);
    const offenders = files
      .filter((file) => !/db[/\\]sqliteBinding\.ts$/.test(file))
      .filter((file) => specifier.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SERVER_ROOT.length));
    expect(offenders).toEqual([]);
  });
});
