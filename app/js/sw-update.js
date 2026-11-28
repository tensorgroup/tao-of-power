// The service worker's controllerchange: reload for an update, not for the first visit's claim.

/**
 * Returns the controllerchange handler. On a first visit (no controller at load) the new worker claims the
 * page: no reload then. A later change is an update. Only the tab whose reader tapped "Refresh" (`chosen()`)
 * reloads, once. Every other tab calls onOther(): it offers a Reload, so an open edit there is not lost.
 */
export function controllerChange({ hadController, chosen, reload, onOther = () => {} }) {
  let had = hadController;
  let reloading = false;
  return () => {
    if (reloading) return;
    if (!had) { had = true; return; }
    if (!chosen()) { onOther(); return; }
    reloading = true;
    reload();
  };
}
