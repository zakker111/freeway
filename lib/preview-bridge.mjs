// The bridge runs inside a preview frame. It only reports browser errors to the
// parent; it has no access to the app, its token or its DOM. The same source is
// embedded in both pages and injected by the desktop preview server, so srcdoc
// and served previews use one diagnostic protocol.

export const PREVIEW_BRIDGE_SOURCE = String.raw`(function () {
  if (window.parent === window) return;
  if (window.__freewayPreviewBridge) return;
  window.__freewayPreviewBridge = true;

  var sent = 0;
  var seen = {};

  function clip(value, limit) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit || 300);
  }

  function post(kind, message, file, line, column) {
    if (sent >= 20) return;
    sent += 1;
    try {
      window.parent.postMessage({
        source: 'freeway-preview',
        kind: kind,
        message: clip(message),
        file: clip(file, 240),
        line: Number(line) || 0,
        column: Number(column) || 0
      }, '*');
    } catch (_) {}
  }

  function once(kind, message, file, line, column) {
    var key = kind + '\n' + clip(message) + '\n' + clip(file, 240) + '\n' + (Number(line) || 0);
    if (seen[key]) return;
    seen[key] = true;
    post(kind, message, file, line, column);
  }

  window.addEventListener('error', function (event) {
    var target = event.target;
    var resource = target && target !== window ? (target.currentSrc || target.src || target.href || '') : '';
    var message = event.message || (resource ? 'Failed to load ' + resource : 'Script error');
    if (target && target !== window) {
      once('resource', message, resource || event.filename, 0, 0);
    } else {
      once('error', message, event.filename, event.lineno, event.colno);
    }
  }, true);

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    var message = reason && reason.message ? reason.message : String(reason || 'Unhandled promise rejection');
    once('rejection', message, '', 0, 0);
  });
})();`;

export function injectPreviewBridge(html) {
  const source = String(html ?? '');
  if (!source || source.includes('data-freeway-preview-bridge')) return source;
  const tag = '<script data-freeway-preview-bridge>' + PREVIEW_BRIDGE_SOURCE + '</script>';
  if (/<\/body\s*>/i.test(source)) return source.replace(/<\/body\s*>/i, (close) => tag + close);
  if (/<\/html\s*>/i.test(source)) return source.replace(/<\/html\s*>/i, (close) => tag + close);
  return source + tag;
}
