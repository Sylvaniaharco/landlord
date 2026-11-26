// Loader hook: ganti modul `cloudflare:workers` (hanya ada di Workers runtime) dengan tiruan secukupnya,
// supaya worker/room.js & worker/lobby.js bisa diuji dengan `node --test`.
const STUB = 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }\n';

export function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: 'cf-stub:workers', shortCircuit: true };
  return next(specifier, context);
}

export function load(url, context, next) {
  if (url === 'cf-stub:workers') return { format: 'module', source: STUB, shortCircuit: true };
  return next(url, context);
}
