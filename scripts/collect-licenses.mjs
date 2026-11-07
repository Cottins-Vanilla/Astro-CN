import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seen = new Set();
const packages = [];
const missing = [];
function resolvePackage(base, name) {
  for (let dir = base; ; dir = path.dirname(dir)) {
    const file = path.join(dir, 'node_modules', name, 'package.json');
    if (fs.existsSync(file)) return file;
    if (dir === path.dirname(dir)) return null;
  }
}
function visit(file, external = false) {
  const real = fs.realpathSync(file);
  if (seen.has(real)) return;
  seen.add(real);
  const pkg = JSON.parse(fs.readFileSync(real, 'utf8'));
  const base = path.dirname(real);
  if (external && !pkg.name?.startsWith('@solen/')) {
    const texts = fs.readdirSync(base).filter(name => /^(licen[sc]e|copying|notice|ofl)(?:[._-]|$)/i.test(name))
      .filter(name => fs.statSync(path.join(base, name)).isFile())
      .map(name => name + '\n' + fs.readFileSync(path.join(base, name), 'utf8'));
    if (!texts.length && /^@lydell\/node-pty-(win32|linux|darwin)-/.test(pkg.name)) {
      const parentFile = resolvePackage(path.join(root, 'apps/desktop'), '@lydell/node-pty');
      const parent = parentFile && JSON.parse(fs.readFileSync(parentFile, 'utf8'));
      if (parent && parent.version === pkg.version && parent.license === pkg.license && parent.repository?.url === pkg.repository?.url) {
        texts.push('LICENSE (shared with @lydell/node-pty from the same upstream repository and version)\n' + fs.readFileSync(path.join(path.dirname(parentFile), 'LICENSE'), 'utf8'));
      }
    }
    const license = typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? pkg.licenses ?? 'unspecified');
    if (!texts.length) missing.push(pkg.name + '@' + pkg.version);
    packages.push({name: pkg.name, version: pkg.version, license, texts});
  }
  const optional = pkg.optionalDependencies ?? {};
  for (const name of new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(optional)])) {
    const dependency = resolvePackage(base, name);
    if (dependency) visit(dependency, true);
    else if (!(name in optional)) throw new Error('Missing installed dependency: ' + pkg.name + ' -> ' + name);
  }
}
for (const project of ['package.json', 'apps/web/package.json', 'apps/desktop/package.json']) visit(path.join(root, project));
packages.sort((a,b) => a.name.localeCompare(b.name));
const text = ['Astro CN - bundled dependency notices', 'This inventory includes installed production dependencies of the desktop and web apps.', 'Some platform-specific optional packages may not be shipped on every platform.', 'Electron / Chromium notices are additionally shipped by the Electron runtime.', '', ...packages.map(pkg => [ '='.repeat(76), pkg.name + '@' + pkg.version, 'License: ' + pkg.license, ...pkg.texts ].join('\n\n'))].join('\n\n');
const output = path.join(root, 'apps/desktop/build/THIRD-PARTY-DEPENDENCIES.txt');
fs.mkdirSync(path.dirname(output), {recursive:true});
fs.writeFileSync(output, text + '\n');
console.log(JSON.stringify({packages:packages.length, missingLicenseFiles:missing}));
if (missing.length) throw new Error('Review packages without license text before distribution');
