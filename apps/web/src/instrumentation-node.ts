import { assertDeployable, getServerEnv, scrubErrorReport } from '@chronolignee/config/server';
import type * as Sentry from '@sentry/node';

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

let sentry: typeof Sentry | null = null;

/**
 * Traces and error reports, each only when configured.
 *
 * Both are loaded on demand, so an instance that uses neither never loads
 * either. Sentry reports errors only and leaves OpenTelemetry alone
 * (`skipOpenTelemetrySetup`): two SDKs registering a global tracer provider
 * would fight over it, and traces are OpenTelemetry's job here.
 */
export async function startObservability(): Promise<void> {
  const env = getServerEnv();

  if (env.OTEL_ENABLED) {
    // Exports to OTEL_EXPORTER_OTLP_ENDPOINT, read by the exporter itself.
    const { registerOTel } = await import('@vercel/otel');
    registerOTel({ serviceName: 'chronolignee-web' });
  }

  if (env.SENTRY_DSN) {
    sentry = await import('@sentry/node');
    sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      sendDefaultPii: false,
      skipOpenTelemetrySetup: true,
      tracesSampleRate: 0,
      beforeSend: (event) => scrubErrorReport(event),
    });
  }
}

export interface RequestErrorContext {
  readonly routePath: string;
  readonly routeType: string;
}

/**
 * An error Next caught while rendering or handling a request.
 *
 * Logged by its digest — the id Next shows on the error page, so a report
 * from a reader can be matched to a line here — the route pattern (never the
 * URL, which names trees and people) and the error's class.
 */
export async function reportRequestError(
  error: unknown,
  method: string,
  context: RequestErrorContext,
): Promise<void> {
  const digest =
    typeof error === 'object' && error !== null && 'digest' in error
      ? String((error as { digest: unknown }).digest)
      : undefined;
  // Imported here, not at the top: the logger reads the environment when it
  // loads, and the start-up check above must be the first to do that.
  const { logger } = await import('./lib/logger');
  logger.error(
    {
      event: 'request.failed',
      method,
      route: context.routePath,
      routeType: context.routeType,
      error: error instanceof Error ? error.name : typeof error,
      ...(digest ? { digest } : {}),
    },
    'request failed',
  );
  sentry?.captureException(error, {
    tags: { route: context.routePath, routeType: context.routeType, ...(digest ? { digest } : {}) },
  });
}
