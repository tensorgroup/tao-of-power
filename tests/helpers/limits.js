// Rate-limit bindings that let every request through, for tests that are not about the limits.
// worker/sync.js refuses a request with 503 when a binding is missing (except on localhost).
const pass = () => ({ limit: async () => ({ success: true }) });
export const openLimits = () => ({ AUTH_LIMIT: pass(), SYNC_LIMIT: pass(), SIGNUP_LIMIT: pass() });
