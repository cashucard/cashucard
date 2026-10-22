/* Public build configuration only. Never reads credentials or contacts a service. */
const fs = require('node:fs');
const path = require('node:path');
const {isIP} = require('node:net');
const {randomUUID} = require('node:crypto');

function validateOrigin(value, local = false) {
  const invalid = () => {
    throw new Error(
      'A valid service origin is required; use HTTPS without credentials, path, query or fragment.',
    );
  };
  if (
    typeof value !== 'string' ||
    /[^\x21-\x7e]/.test(value) ||
    !/^https?:\/\/[^/?#]+\/?$/.test(value)
  )
    invalid();
  let url;
  try {
    url = new URL(value);
  } catch {
    invalid();
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    invalid();
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const loopback = ['localhost', '127.0.0.1', '::1', '10.0.2.2'].includes(
    hostname,
  );
  if (
    url.protocol !== 'https:' &&
    !(local && loopback && url.protocol === 'http:')
  )
    invalid();
  if (
    !local &&
    (loopback ||
      isIP(hostname) ||
      !hostname.includes('.') ||
      /\.(local|localhost|internal|invalid|test|example)$/.test(hostname))
  )
    invalid();
  return url.origin;
}
function configureFile(file, origin, local = false) {
  const serviceOrigin = validateOrigin(origin, local);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(
      temporary,
      JSON.stringify({serviceOrigin}, null, 2) + '\n',
      {flag: 'wx', mode: 0o644},
    );
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return serviceOrigin;
}
function readConfig(file, local) {
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    !config ||
    Object.keys(config).length !== 1 ||
    !Object.hasOwn(config, 'serviceOrigin')
  )
    throw new Error('Invalid service configuration shape.');
  const origin = validateOrigin(config.serviceOrigin, local);
  if (origin !== config.serviceOrigin)
    throw new Error('Service configuration must use the canonical origin.');
  return origin;
}
function checkRelease(file, gates) {
  const origin = readConfig(file, false);
  // Parse, never execute, build source. Reject dynamic or duplicate flag definitions.
  const ts = require('typescript');
  const source = ts.createSourceFile(
    gates,
    fs.readFileSync(gates, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  for (const gate of ['RECOVERY_DRILLS_ENABLED', 'BENCH_RUNS_ENABLED']) {
    const definitions = source.statements.flatMap(statement =>
      ts.isVariableStatement(statement)
        ? statement.declarationList.declarations
            .filter(d => ts.isIdentifier(d.name) && d.name.text === gate)
            .map(d => ({statement, declaration: d}))
        : [],
    );
    if (
      source.parseDiagnostics.length ||
      definitions.length !== 1 ||
      definitions[0].declaration.initializer?.kind !==
        ts.SyntaxKind.FalseKeyword ||
      !(definitions[0].statement.declarationList.flags & ts.NodeFlags.Const) ||
      !definitions[0].statement.modifiers?.some(
        m => m.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      throw new Error(`Release requires an exported constant ${gate} = false.`);
    }
  }
  return origin;
}
module.exports = {validateOrigin, configureFile, checkRelease};
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const file = path.resolve(__dirname, '../src/serviceOrigin.json');
    const gates = path.resolve(__dirname, '../src/releaseGates.ts');
    if (
      args.length === 2 &&
      args[0] === '--check' &&
      ['--local', '--production'].includes(args[1])
    ) {
      if (args[1] === '--production') checkRelease(file, gates);
      else readConfig(file, true);
      process.stdout.write('Service build configuration check passed.\n');
    } else if (
      [2, 3].includes(args.length) &&
      args[0] === '--origin' &&
      (args.length === 2 || args[2] === '--local')
    ) {
      configureFile(file, args[1], args[2] === '--local');
      process.stdout.write(
        'Public service build origin configured. Rebuild the app to apply it.\n',
      );
    } else
      throw new Error(
        'Usage: configure-service --origin HTTPS_ORIGIN [--local], or --check --production|--local',
      );
  } catch (error) {
    // Do not echo supplied URLs: rejected input may contain credentials.
    process.stderr.write(
      error instanceof SyntaxError
        ? 'Invalid service configuration JSON.\n'
        : `${error.message}\n`,
    );
    process.exitCode = 1;
  }
}
