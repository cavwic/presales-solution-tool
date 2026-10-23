'use strict';

const ACTIONS = new Set(['minimize', 'toggle-maximize', 'close']);
const EDGES = new Set(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
const EVENTS = ['maximize', 'unmaximize', 'minimize', 'restore', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur'];

function invalid(message, code = 'WINDOW_CONTROL_INVALID') { return Object.assign(new Error(message), { code }); }
function point(input) {
  if (!Number.isFinite(input?.screenX) || !Number.isFinite(input?.screenY) || Math.abs(input.screenX) > 100000 || Math.abs(input.screenY) > 100000) throw invalid('窗口操作坐标无效');
  return { x: input.screenX, y: input.screenY };
}

function resizedBounds(origin, edge, delta, minimum) {
  let { x, y, width, height } = origin;
  const [minWidth, minHeight] = minimum;
  const clamp = (value, minimum) => Math.min(Math.max(minimum, 20000), Math.max(minimum, value));
  if (edge.includes('e')) width = clamp(width + delta.x, minWidth);
  if (edge.includes('s')) height = clamp(height + delta.y, minHeight);
  if (edge.includes('w')) { const next = clamp(width - delta.x, minWidth); x += width - next; width = next; }
  if (edge.includes('n')) { const next = clamp(height - delta.y, minHeight); y += height - next; height = next; }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function attachWindowControls({ window, notify = () => {}, platform = process.platform }) {
  let disposed = false, resizeGesture = null;
  const state = () => {
    if (disposed || window.isDestroyed()) return { enabled: platform === 'win32', frameless: platform === 'win32', customControls: platform === 'win32', destroyed: true, maximized: false, fullscreen: false, focused: false, minimized: false };
    return { enabled: platform === 'win32', frameless: platform === 'win32', customControls: platform === 'win32', destroyed: false, maximized: window.isMaximized(), fullscreen: window.isFullScreen(), focused: window.isFocused(), minimized: window.isMinimized() };
  };
  const changed = () => { resizeGesture = null; if (!disposed && !window.isDestroyed()) notify(state()); };
  const dispose = () => {
    if (disposed) return;
    disposed = true; resizeGesture = null;
    for (const event of EVENTS) window.removeListener(event, changed);
    window.removeListener('closed', dispose);
  };
  for (const event of EVENTS) window.on(event, changed);
  window.once('closed', dispose);
  return {
    state, dispose,
    action(input) {
      const action = input?.action;
      if (!ACTIONS.has(action)) throw invalid('不支持的窗口操作');
      if (disposed || window.isDestroyed()) return state();
      resizeGesture = null;
      if (action === 'minimize') window.minimize();
      else if (action === 'toggle-maximize') { if (window.isFullScreen()) throw invalid('全屏时不能切换最大化'); if (window.isMaximized()) window.unmaximize(); else window.maximize(); }
      else window.close(); // Runs canonical close/before-quit shutdown, never destroy().
      return state();
    },
    resize(input) {
      const phase = input?.phase;
      if (!['start', 'move', 'end'].includes(phase)) throw invalid('窗口缩放阶段无效');
      if (phase === 'end') { resizeGesture = null; return { ...state(), resizing: false }; }
      const cursor = point(input);
      if (disposed || window.isDestroyed()) return { ...state(), resizing: false };
      if (window.isMaximized() || window.isFullScreen() || !window.isResizable()) { resizeGesture = null; return { ...state(), resizing: false }; }
      if (phase === 'start') {
        if (!EDGES.has(input.edge)) throw invalid('窗口缩放方向无效');
        const minimum = window.getMinimumSize();
        resizeGesture = { edge: input.edge, cursor, bounds: window.getBounds(), minimum: [Math.max(1, minimum[0]), Math.max(1, minimum[1])] };
      } else if (resizeGesture) {
        window.setBounds(resizedBounds(resizeGesture.bounds, resizeGesture.edge, { x: cursor.x - resizeGesture.cursor.x, y: cursor.y - resizeGesture.cursor.y }, resizeGesture.minimum));
      }
      return { ...state(), resizing: Boolean(resizeGesture) };
    },
  };
}

module.exports = { attachWindowControls, resizedBounds };
