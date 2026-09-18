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

  const { assertDeployable, getServerEnv } = await import('@chronolignee/config/server');
  try {
    assertDeployable(getServerEnv());
  } catch (error) {
    // Exit, rather than let the throw propagate. Next catches an error from
    // this hook, logs it, and keeps the process alive answering 500 — which
    // an orchestrator reads as a running container. Refusing to start has to
    // mean a non-zero exit, so the deploy fails where someone will see it.
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
