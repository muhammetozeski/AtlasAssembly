import { createState, applyCommand, renderSnapshot, validateState } from './shared/engine.mjs';

const storageKey = 'atlas-assembly:sessions:v1';
const memory = new Map();
let storageBlocked = false, warning = '', loaded = false;
const visibilityObservers = new Map();

function validSession(value) {
  if (!value || typeof value.id !== 'string' || !value.id || !['solo', 'room'].includes(value.mode) || typeof value.name !== 'string' || !Number.isSafeInteger(value.savedAt) || value.savedAt < 0 || value.savedAt > 253402300799999) return false;
  const known = new Set(['id', 'mode', 'name', 'roomId', 'playerId', 'playerKey', 'ownerKey', 'state', 'registration', 'pending', 'savedAt', 'knownRegistrationError']);
  if (Object.keys(value).some(key => !known.has(key))) return false;
  if (value.knownRegistrationError && (typeof value.knownRegistrationError.code !== 'string' || typeof value.knownRegistrationError.error !== 'string')) return false;
  const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);
  const validKey = key => typeof key === 'string' && /^[A-Za-z0-9_-]{43}$/.test(key);
  if (value.pending && (!validId(value.pending.opId) || !Number.isSafeInteger(value.pending.revision) || value.pending.revision < 0 || !value.pending.command || typeof value.pending.command.type !== 'string')) return false;
  if (value.mode === 'solo') return value.state && validateState(value.state).ok && value.state.members.some(member => member.id === value.playerId);
  if (value.registration) {
    const registration = value.registration, body = registration.body;
    return ['create', 'join'].includes(registration.kind) && (registration.kind === 'create' || validId(registration.roomId)) && body && validId(body.opId) && validKey(body.requestKey) && body.name === value.name;
  }
  return validId(value.roomId) && validId(value.playerId) && validKey(value.playerKey) && (value.ownerKey == null || validKey(value.ownerKey)) && (!value.state || validateState(value.state).ok);
}
function storedLibrary() {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return { schema: 1, sessions: [] };
  const value = JSON.parse(raw);
  if (value?.schema !== 1 || Object.keys(value).some(key => !['schema','sessions'].includes(key)) || !Array.isArray(value.sessions) || !value.sessions.every(validSession) || new Set(value.sessions.map(item => item.id)).size !== value.sessions.length) throw new Error('Saved assemblies could not be opened.');
  return value;
}
function blockStorage() {
  storageBlocked = true;
  warning = 'Saved assemblies could not be opened or updated. Existing saved data has not been reset. Keep this tab open to continue your current assembly.';
}
/** Opens the private browser library without replacing an unreadable stored value. */
export function initialize() {
  if (!loaded) {
    try { for (const session of storedLibrary().sessions) memory.set(session.id, session); }
    catch { blockStorage(); }
    loaded = true;
  }
  return library();
}
/** Returns only display fields; player and registration capabilities never enter the gallery list. */
export function library() {
  return { sessions: [...memory.values()].sort((a, b) => b.savedAt - a.savedAt).map(({ id, mode, name, roomId, savedAt, knownRegistrationError }) => ({ id, mode, name, roomId, savedAt, entryUnavailable: !!knownRegistrationError })), warning, writable: !storageBlocked };
}
/** Saves one session while preserving other tabs' records; network writes require a confirmed private recovery record first. */
export function save(session, requirePersistence = false) {
  initialize();
  if (!validSession(session)) throw new Error('This saved assembly is incomplete.');
  if (requirePersistence && storageBlocked) throw new Error('This browser cannot save room access. Use solo play or enable browser storage before creating or joining a room.');
  session = structuredClone(session); session.savedAt = Date.now();
  memory.set(session.id, session);
  if (!storageBlocked) {
    try {
      const latest = storedLibrary();
      const merged = new Map(latest.sessions.map(item => [item.id, item]));
      merged.set(session.id, session);
      const text = JSON.stringify({ schema: 1, sessions: [...merged.values()] });
      localStorage.setItem(storageKey, text);
      if (localStorage.getItem(storageKey) !== text) throw new Error('Saving was not confirmed.');
    } catch { blockStorage(); }
  }
  if (requirePersistence && storageBlocked) throw new Error('Room access could not be saved. No room action was sent.');
  return library();
}
/** Reopens a separate local record, retaining unfinished solo and room sessions. */
export function open(id) {
  initialize();
  const session = memory.get(id);
  if (!session) throw new Error('This assembly was not found on this device.');
  return structuredClone(session);
}
/** Starts local play with the exact production engine used by the room service. */
export function newSolo(artworks, name = 'You') {
  initialize();
  const playerId = crypto.randomUUID();
  const state = createState({ seed: crypto.getRandomValues(new Uint32Array(1))[0], ownerId: playerId, ownerName: name, now: Date.now(), mode: 'solo', artworks });
  const session = { id: crypto.randomUUID(), mode: 'solo', name, playerId, state, savedAt: Date.now() };
  save(session); return session;
}
/** Persists a registration proof before its first request; a missing response can recover the same server-issued player. */
export function prepareRegistration(kind, name, roomId = null) {
  initialize();
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const requestKey = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const body = { opId: crypto.randomUUID(), requestKey, name };
  const session = { id: crypto.randomUUID(), mode: 'room', name, roomId, registration: { kind, roomId, body }, savedAt: Date.now() };
  try { save(session, true); return { ok: true, session }; }
  catch (error) { return { ok: false, error: error.message }; }
}
/** Projects a canonical state for the renderer without duplicating its rules. */
export function snapshot(state, playerId) { return renderSnapshot(state, playerId); }
/** Applies a solo command through production rules; refused commands never replace the saved state. */
export function applyLocal(session, command) {
  const result = applyCommand(session.state, session.playerId, command, Date.now());
  if (!result.ok) return { ok: false, error: result.error?.message || 'That move is not available.' };
  session = structuredClone(session); session.state = result.state; save(session); return { ok: true, session };
}
/** Uses the production rules to preview a possible join after a drag; this is never an online acceptance receipt. */
export function dragCandidate(state, playerId, groupId, x, y) {
  const moved = applyCommand(state, playerId, { type: 'move', groupId, x, y, expectedRevision: state.revision }, Date.now());
  if (!moved.ok) return null;
  for (const target of moved.state.groups) {
    if (target.id === groupId || target.location !== 'tray' || target.ownerId !== playerId) continue;
    const joined = applyCommand(moved.state, playerId, { type: 'join', groupId, targetGroupId: target.id, expectedRevision: moved.state.revision }, Date.now());
    if (joined.ok) return target.id;
  }
  return null;
}
/** Reports browser visibility only; resuming reads actual room state before another action. */
export function observeVisibility(receiver) {
  const id = crypto.randomUUID();
  const changed = () => receiver.invokeMethodAsync('OnVisibilityChanged', !document.hidden).catch(error => console.warn('Atlas visibility callback unavailable; type=' + error.name));
  document.addEventListener('visibilitychange', changed);
  visibilityObservers.set(id, changed); return id;
}
/** Removes a specific session observer without affecting other pages or tabs. */
export function stopObserving(id) { const handler = visibilityObservers.get(id); if (handler) document.removeEventListener('visibilitychange', handler); visibilityObservers.delete(id); }
/** Generates an operation identifier without deriving it from player identity or private content. */
export function operationId() { return crypto.randomUUID(); }
/** Copies only the public room invitation, never a player capability. */
export async function copyInvitation(value) {
  if (!navigator.clipboard?.writeText) return false;
  try { await navigator.clipboard.writeText(value); return true; }
  catch (error) { console.warn('Atlas clipboard unavailable; type=' + error.name); return false; }
}
