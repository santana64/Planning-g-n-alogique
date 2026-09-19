/**
 * Runs once when a server process starts — the point at which the
 * deployment-safety checks belong.
 *
 * Those checks existed for several phases without being called from anywhere:
 * a function that refuses an unsafe production configuration, which nothing
 * invoked, so nothing was ever refused. A development database password or a
 * test-double AI provider would have gone to production without a word.
 *
 * Not during `next build`. The build runs with NODE_ENV=production and
 * placeholder values that never reach a running server; refusing those would
 * make a production build impossible on any machine. The phase check keeps the
 * two questions apart: "does this compile" at build, "is this safe to serve"
 * here.
 */
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  if (process.env['NEXT_PHASE'] === 'phase-production-build') return;

  const { refuseUnsafeConfiguration, startObservability } = await import('./instrumentation-node');
  refuseUnsafeConfiguration();
  await startObservability();
}

/**
 * Every error Next catches while serving a request: rendering, a route
 * handler, a server action.
 */
export async function onRequestError(
  error: unknown,
  request: { readonly method: string },
  context: { readonly routePath: string; readonly routeType: string },
): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  const { reportRequestError } = await import('./instrumentation-node');
  await reportRequestError(error, request.method, context);
}
