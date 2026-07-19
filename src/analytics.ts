import posthog from 'posthog-js';

// The key only exists in .env.production, so dev sessions stay untracked;
// the console.debug lines make every event verifiable in dev instead.
const enabled = Boolean(import.meta.env.VITE_POSTHOG_KEY);

export const initAnalytics = () => {
  if (!enabled) {
    return;
  }

  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST,
    defaults: '2026-05-30',
  });
};

export const track = (event: string, properties?: Record<string, unknown>) => {
  if (import.meta.env.DEV) {
    console.debug('[analytics]', event, properties ?? {});
  }

  if (enabled) {
    posthog.capture(event, properties);
  }
};

export const trackError = (error: unknown, context?: Record<string, unknown>) => {
  if (import.meta.env.DEV) {
    console.debug('[analytics:error]', error, context ?? {});
  }

  if (enabled) {
    posthog.captureException(error, context);
  }
};
