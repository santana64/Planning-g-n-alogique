import { assertDeployable, getServerEnv } from '@chronolignee/config/server';

/**
 * The Node-only half of the start-up hook.
 *
 * A separate module because the bundler compiles instrumentation.ts for every
 * runtime, Edge included, whatever the runtime check inside it says: a
 * `process.exit` written there is flagged as an Edge incompatibility at every
 * build. Imported dynamically behind that check, this file is only ever
 * bundled for Node.
 */
export function refuseUnsafeConfiguration(): void {
  try {
    assertDeployable(getServerEnv());
  } catch (error) {
    // Exit, rather than let the throw propagate. Next catches an error from
    // the hook, logs it, and keeps the process alive answering 500 — which
    // an orchestrator reads as a running container. Refusing to start has to
    // mean a non-zero exit, so the deploy fails where someone will see it.
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
