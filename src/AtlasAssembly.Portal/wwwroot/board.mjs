const bindings = new Map();
/** Attaches pointer dragging to engine-projected SVG clusters without modifying canonical state. */
export function bind(svg, receiver) {
  if (!(svg instanceof SVGSVGElement)) throw new Error('The painting table could not open.');
  const id = crypto.randomUUID();
  let drag = null;
  function point(event) {
    const matrix = svg.getScreenCTM();
    if (!matrix) throw new Error('The table is not visible.');
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  }
  function reset() {
    if (!drag) return;
    drag.element.removeAttribute('transform');
    if (svg.hasPointerCapture(drag.pointerId)) svg.releasePointerCapture(drag.pointerId);
    drag = null;
  }
  function send(method, value) {
    receiver.invokeMethodAsync(method, value).catch(error => console.warn('Atlas board callback unavailable; type=' + error.name));
  }
  function down(event) {
    if (svg.dataset.disabled === 'true' || drag || event.button !== 0) return;
    const element = event.target.closest('[data-atlas-group]');
    if (!element || !svg.contains(element)) return;
    const start = point(event);
    drag = { element, pointerId: event.pointerId, groupId: element.dataset.atlasGroup, groupVersion: Number(element.dataset.version), generation: Number(svg.dataset.generation), x: Number(element.dataset.x), y: Number(element.dataset.y), start, dx: 0, dy: 0 };
    svg.setPointerCapture(event.pointerId); event.preventDefault();
  }
  function move(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.element.isConnected || Number(svg.dataset.generation) !== drag.generation || Number(drag.element.dataset.version) !== drag.groupVersion) { reset(); return; }
    const current = point(event); drag.dx = current.x - drag.start.x; drag.dy = current.y - drag.start.y;
    drag.element.setAttribute('transform', 'translate(' + drag.dx + ' ' + drag.dy + ')');
  }
  function up(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const value = drag;
    const valid = value.element.isConnected && Number(svg.dataset.generation) === value.generation && Number(value.element.dataset.version) === value.groupVersion;
    reset();
    if (!valid || svg.dataset.disabled === 'true') return;
    if (Math.hypot(value.dx, value.dy) < .015) send('OnSelected', { groupId: value.groupId, generation: value.generation });
    else send('OnDragged', { groupId: value.groupId, groupVersion: value.groupVersion, x: value.x + value.dx, y: value.y + value.dy, generation: value.generation });
  }
  function cancel() { reset(); }
  svg.addEventListener('pointerdown', down); svg.addEventListener('pointermove', move); svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', cancel); svg.addEventListener('lostpointercapture', cancel);
  bindings.set(id, { dispose() { reset(); svg.removeEventListener('pointerdown', down); svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', cancel); svg.removeEventListener('lostpointercapture', cancel); } });
  return id;
}
/** Removes a specific board's listeners and temporary drag pose while retaining the saved game. */
export function dispose(id) { bindings.get(id)?.dispose(); bindings.delete(id); }
