# cannon-es 0.20.0

- Upstream: https://github.com/pmndrs/cannon-es
- Source archive: https://registry.npmjs.org/cannon-es/-/cannon-es-0.20.0.tgz
- Source file: `package/dist/cannon-es.js` (browser ESM distribution).
- Packaging: the final `export { ... }` is replaced with `return { ... }`, and the file is wrapped in `const CANNON = (() => { ... })();` for the existing classic scripts and Electron file loading. Physics engine code is otherwise unchanged.
- License: MIT, reproduced in `cannon-es-LICENSE.txt`.
- Bundled locally so offline play does not require a CDN request.
