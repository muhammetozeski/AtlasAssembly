export const ENGINE_VERSION = 'aa-v1';
export const ARTWORK_IDS = Object.freeze(['met-436535', 'met-45434', 'met-436121']);
export const TRAY_LIMIT = 6;
export const BOARD = Object.freeze({ width: 14, height: 10, snapDistance: 0.28 });
const GRID = 4, MAX_OFFERS = 64;

class RuleError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new RuleError(code, message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const idValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const nameValid = value => typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 30 && !/[\u0000-\u001f\u007f]/.test(value);
function clock(now) { if (!integer(now)) fail('INVALID_TIME', 'A valid service time is required.'); return now; }
function member(state, id) { return state.members.find(item => item.id === id); }
function group(state, id) { return state.groups.find(item => item.id === id); }
function tray(state, id) { return state.groups.filter(item => item.location === 'tray' && item.ownerId === id); }
function clone(state) {
  return {
    schema: state.schema, engineVersion: state.engineVersion, seed: state.seed, revision: state.revision,
    mode: state.mode, status: state.status, ownerId: state.ownerId, createdAt: state.createdAt, updatedAt: state.updatedAt,
    artworks: state.artworks.map(({ id, width, height }) => ({ id, width, height })),
    pieces: state.pieces.map(({ id, artworkId, col, row }) => ({ id, artworkId, col, row })),
    groups: state.groups.map(({ id, artworkId, pieceIds, location, ownerId, x, y, rotation, version, contributors }) => ({ id, artworkId, pieceIds: [...pieceIds], location, ownerId, x, y, rotation, version, contributors: [...contributors] })),
    members: state.members.map(({ id, name, status, joinedAt, rejoinedAt }) => ({ id, name, status, joinedAt, rejoinedAt })),
    offers: state.offers.map(({ id, fromId, toId, groupId, groupVersion, status, createdAt, resolvedAt }) => ({ id, fromId, toId, groupId, groupVersion, status, createdAt, resolvedAt })),
    contributors: state.contributors.map(({ id, name, claims, joins, transfers, completedArtworks }) => ({ id, name, claims, joins, transfers, completedArtworks: [...completedArtworks] })),
    nextOffer: state.nextOffer, takeover: state.takeover ? { by: state.takeover.by, at: state.takeover.at } : null, completedAt: state.completedAt
  };
}
function pieceMap(state) { return new Map(state.pieces.map(piece => [piece.id, piece])); }
function rotate(x, y, turns) {
  switch ((turns % 4 + 4) % 4) { case 0: return { x, y }; case 1: return { x: -y, y: x }; case 2: return { x: -x, y: -y }; default: return { x: y, y: -x }; }
}
function aspect(state, artId) { const art = state.artworks.find(item => item.id === artId); return art.height / art.width; }
function sourcePoint(piece, ratio) { return { x: piece.col - 1.5, y: (piece.row - 1.5) * ratio }; }
function tiles(state, item) {
  const map = pieceMap(state), ratio = aspect(state, item.artworkId);
  return item.pieceIds.map(id => {
    const piece = map.get(id), point = sourcePoint(piece, ratio), turned = rotate(point.x, point.y, item.rotation);
    return { pieceId: id, artworkId: piece.artworkId, col: piece.col, row: piece.row, x: item.x + turned.x, y: item.y + turned.y, width: 1, height: ratio, rotation: item.rotation };
  });
}
function bounds(state, item) {
  const visible = tiles(state, item), ratio = aspect(state, item.artworkId), halfX = (item.rotation % 2 ? ratio : 1) / 2, halfY = (item.rotation % 2 ? 1 : ratio) / 2;
  return { left: Math.min(...visible.map(tile => tile.x - halfX)), right: Math.max(...visible.map(tile => tile.x + halfX)), top: Math.min(...visible.map(tile => tile.y - halfY)), bottom: Math.max(...visible.map(tile => tile.y + halfY)) };
}
function inside(state, item) { const b = bounds(state, item); return b.left >= -1e-8 && b.top >= -1e-8 && b.right <= BOARD.width + 1e-8 && b.bottom <= BOARD.height + 1e-8; }
function centerInSlot(state, item, index) {
  const target = { x: 2.5 + (index % 3) * 4.5, y: index < 3 ? 2.5 : 7.5 }, b = bounds(state, item);
  item.x += target.x - (b.left + b.right) / 2; item.y += target.y - (b.top + b.bottom) / 2;
  const shifted = bounds(state, item);
  item.x += Math.max(0, -shifted.left) - Math.max(0, shifted.right - BOARD.width);
  item.y += Math.max(0, -shifted.top) - Math.max(0, shifted.bottom - BOARD.height);
}
function connected(ids, map) {
  const remaining = new Set(ids), queue = [ids[0]]; remaining.delete(ids[0]);
  for (let i = 0; i < queue.length; i++) {
    const a = map.get(queue[i]);
    for (const id of remaining) { const b = map.get(id); if (Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1) { remaining.delete(id); queue.push(id); } }
  }
  return remaining.size === 0;
}
function neighbors(first, second, map) {
  return first.pieceIds.some(a => second.pieceIds.some(b => Math.abs(map.get(a).col - map.get(b).col) + Math.abs(map.get(a).row - map.get(b).row) === 1));
}
function assertState(state) {
  const bad = () => fail('INVALID_STATE', 'This assembly state is invalid. Reload its saved room.');
  if (!object(state) || state.schema !== 1 || state.engineVersion !== ENGINE_VERSION || !integer(state.revision) || !integer(state.seed) || state.seed > 0xffffffff || !integer(state.createdAt) || !integer(state.updatedAt) || !['solo', 'team', 'solo-takeover'].includes(state.mode) || !['playing', 'complete'].includes(state.status)) bad();
  if (!Array.isArray(state.artworks) || state.artworks.length !== 3 || new Set(state.artworks.map(art => art?.id)).size !== 3) bad();
  for (const art of state.artworks) if (!ARTWORK_IDS.includes(art?.id) || !Number.isSafeInteger(art.width) || !Number.isSafeInteger(art.height) || art.width <= 0 || art.height <= 0 || art.width > 100000 || art.height > 100000 || art.height / art.width < 0.25 || art.height / art.width > 2) bad();
  if (!Array.isArray(state.members) || state.members.length < 1 || state.members.length > 3 || new Set(state.members.map(item => item?.id)).size !== state.members.length || !idValid(state.ownerId)) bad();
  for (const person of state.members) if (!idValid(person?.id) || !nameValid(person.name) || !['active', 'reclaimed'].includes(person.status) || !integer(person.joinedAt) || person.rejoinedAt !== null && !integer(person.rejoinedAt)) bad();
  if (!member(state, state.ownerId) || state.mode === 'solo' && state.members.length !== 1 || state.mode === 'solo-takeover' && state.members.some(item => item.id !== state.ownerId && item.status === 'active')) bad();
  if (!Array.isArray(state.pieces) || state.pieces.length !== 48 || new Set(state.pieces.map(piece => piece?.id)).size !== 48) bad();
  const artCells = new Set();
  for (const piece of state.pieces) {
    if (!idValid(piece?.id) || !ARTWORK_IDS.includes(piece.artworkId) || !Number.isInteger(piece.col) || piece.col < 0 || piece.col >= GRID || !Number.isInteger(piece.row) || piece.row < 0 || piece.row >= GRID) bad();
    const key = piece.artworkId + ':' + piece.col + ':' + piece.row; if (artCells.has(key)) bad(); artCells.add(key);
  }
  if (!Array.isArray(state.groups) || state.groups.length < 3 || state.groups.length > 48 || new Set(state.groups.map(item => item?.id)).size !== state.groups.length) bad();
  const map = pieceMap(state), seen = new Set(), completed = new Set();
  for (const item of state.groups) {
    if (!idValid(item?.id) || !ARTWORK_IDS.includes(item.artworkId) || !Array.isArray(item.pieceIds) || item.pieceIds.length < 1 || item.pieceIds.length > 16 || !integer(item.version) || !Number.isFinite(item.x) || !Number.isFinite(item.y) || Math.abs(item.x) > 100 || Math.abs(item.y) > 100 || !Number.isInteger(item.rotation) || item.rotation < 0 || item.rotation > 3 || !['rack', 'tray', 'completed'].includes(item.location) || !Array.isArray(item.contributors) || new Set(item.contributors).size !== item.contributors.length || item.contributors.some(id => !member(state, id))) bad();
    for (const id of item.pieceIds) { if (!map.has(id) || map.get(id).artworkId !== item.artworkId || seen.has(id)) bad(); seen.add(id); }
    if (!connected(item.pieceIds, map)) bad();
    if (item.location === 'tray') { if (member(state, item.ownerId)?.status !== 'active' || !inside(state, item)) bad(); }
    else if (item.ownerId !== null) bad();
    if (item.location === 'completed') { if (item.pieceIds.length !== 16 || completed.has(item.artworkId)) bad(); completed.add(item.artworkId); }
    else if (item.pieceIds.length === 16) bad();
  }
  if (seen.size !== 48 || state.members.some(person => tray(state, person.id).length > TRAY_LIMIT) || (state.status === 'complete') !== (completed.size === 3)) bad();
  if (!Array.isArray(state.contributors) || state.contributors.length !== state.members.length || new Set(state.contributors.map(item => item?.id)).size !== state.contributors.length) bad();
  for (const person of state.contributors) if (!member(state, person?.id) || person.name !== member(state, person.id).name || !['claims', 'joins', 'transfers'].every(key => integer(person[key])) || !Array.isArray(person.completedArtworks) || new Set(person.completedArtworks).size !== person.completedArtworks.length || person.completedArtworks.some(id => !completed.has(id))) bad();
  if (!integer(state.nextOffer) || !Array.isArray(state.offers) || state.offers.length > MAX_OFFERS || new Set(state.offers.map(offer => offer?.id)).size !== state.offers.length) bad();
  for (const offer of state.offers) {
    if (!idValid(offer?.id) || !member(state, offer.fromId) || !member(state, offer.toId) || offer.fromId === offer.toId || !idValid(offer.groupId) || !integer(offer.groupVersion) || !['open', 'accepted', 'cancelled', 'stale'].includes(offer.status) || !integer(offer.createdAt) || offer.resolvedAt !== null && !integer(offer.resolvedAt)) bad();
    if (offer.status === 'open') { const held = group(state, offer.groupId); if (!held || held.location !== 'tray' || held.ownerId !== offer.fromId || held.version !== offer.groupVersion || member(state, offer.toId).status !== 'active') bad(); }
  }
  if (state.mode === 'solo-takeover') { if (!object(state.takeover) || state.takeover.by !== state.ownerId || !integer(state.takeover.at)) bad(); }
  else if (state.takeover !== null) bad();
  if (state.status === 'complete' ? !integer(state.completedAt) : state.completedAt !== null) bad();
}
export function validateState(state) {
  try { assertState(state); return { ok: true }; }
  catch (error) { if (!(error instanceof RuleError)) throw error; return { ok: false, error: { code: error.code, message: error.message } }; }
}
function random(seed) { return () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296); }
function contribution(id, name) { return { id, name, claims: 0, joins: 0, transfers: 0, completedArtworks: [] }; }
export function createState(options) {
  if (!object(options) || !integer(options.seed) || options.seed > 0xffffffff || !idValid(options.ownerId) || !nameValid(options.ownerName) || !['solo', 'team'].includes(options.mode)) fail('INVALID_OPTIONS', 'Choose a valid assembly and player name.');
  clock(options.now);
  if (!Array.isArray(options.artworks) || options.artworks.length !== 3) fail('INVALID_ARTWORKS', 'The three verified artworks are required.');
  const artworks = ARTWORK_IDS.map(id => { const matches = options.artworks.filter(art => art?.id === id); if (matches.length !== 1) fail('INVALID_ARTWORKS', 'The verified artwork collection does not match.'); return { id, width: matches[0].width, height: matches[0].height }; });
  const state = { schema: 1, engineVersion: ENGINE_VERSION, seed: options.seed, revision: 0, mode: options.mode, status: 'playing', ownerId: options.ownerId, createdAt: options.now, updatedAt: options.now, artworks, pieces: [], groups: [], members: [{ id: options.ownerId, name: options.ownerName.trim(), status: 'active', joinedAt: options.now, rejoinedAt: null }], offers: [], contributors: [contribution(options.ownerId, options.ownerName.trim())], nextOffer: 1, takeover: null, completedAt: null };
  const rng = random(options.seed);
  for (const art of artworks) for (let i = 0; i < 16; i++) {
    const id = 'p' + state.pieces.length;
    state.pieces.push({ id, artworkId: art.id, col: i % GRID, row: Math.floor(i / GRID) });
    state.groups.push({ id: 'g' + (state.pieces.length - 1), artworkId: art.id, pieceIds: [id], location: 'rack', ownerId: null, x: 7, y: 5, rotation: Math.floor(rng() * 4), version: 0, contributors: [] });
  }
  for (let i = state.groups.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [state.groups[i], state.groups[j]] = [state.groups[j], state.groups[i]]; }
  assertState(state); return state;
}
function reject(state, error) { if (!(error instanceof RuleError)) throw error; return { ok: false, error: { code: error.code, message: error.message }, revision: state?.revision ?? 0 }; }
function finish(state, next, events, now) {
  next.revision = state.revision + 1; next.updatedAt = now;
  while (next.offers.length > MAX_OFFERS) { const closed = next.offers.findIndex(item => item.status !== 'open'); if (closed < 0) fail('OFFER_LIMIT', 'Resolve an existing offer first.'); next.offers.splice(closed, 1); }
  assertState(next); return { ok: true, state: next, events, changed: true };
}
function staleOffers(state, groupId, now) { for (const offer of state.offers) if (offer.status === 'open' && offer.groupId === groupId) { offer.status = 'stale'; offer.resolvedAt = now; } }
function touch(state, item, now) { item.version++; staleOffers(state, item.id, now); }
function addContributor(item, actorId) { if (!item.contributors.includes(actorId)) item.contributors.push(actorId); }
function held(state, actorId, groupId) { const item = group(state, groupId); if (!item) fail('GROUP_NOT_FOUND', 'This cluster is no longer available.'); if (item.location !== 'tray' || item.ownerId !== actorId) fail('NOT_YOUR_CLUSTER', 'Choose a cluster on your own tray.'); return item; }
function active(state, actorId) { const person = member(state, actorId); if (!person || person.status !== 'active') fail('PLAYER_INACTIVE', 'Rejoin the room before making a move.'); if (state.mode === 'solo-takeover' && actorId !== state.ownerId) fail('SOLO_TAKEOVER', 'The owner is continuing this room alone.'); return person; }
export function addPlayer(state, player, now) {
  try {
    assertState(state); clock(now);
    if (!object(player) || !idValid(player.id) || !nameValid(player.name)) fail('INVALID_PLAYER', 'Use a player name between 1 and 30 characters.');
    if (state.mode !== 'team' && player.id !== state.ownerId) fail('SOLO_ROOM', 'This assembly is being played alone.');
    const previous = member(state, player.id);
    if (previous?.status === 'active') return { ok: true, state, events: [], changed: false };
    const next = clone(state);
    if (previous) { const person = member(next, player.id); person.status = 'active'; person.rejoinedAt = now; }
    else {
      if (state.status === 'complete') fail('ROOM_COMPLETE', 'This room is already complete.');
      if (next.members.length >= 3) fail('ROOM_FULL', 'This room already has three player identities.');
      next.members.push({ id: player.id, name: player.name.trim(), status: 'active', joinedAt: now, rejoinedAt: null }); next.contributors.push(contribution(player.id, player.name.trim()));
    }
    return finish(state, next, [{ type: previous ? 'player-rejoined' : 'player-joined', memberId: player.id, at: now }], now);
  } catch (error) { return reject(state, error); }
}
export function reclaimPlayer(state, memberId, now) {
  try {
    assertState(state); clock(now);
    const previous = member(state, memberId); if (!previous) fail('PLAYER_NOT_FOUND', 'This player is not in the room.');
    if (previous.status === 'reclaimed') return { ok: true, state, events: [], changed: false };
    const next = clone(state), returned = [];
    for (const item of tray(next, memberId)) { touch(next, item, now); item.location = 'rack'; item.ownerId = null; returned.push(item.id); }
    member(next, memberId).status = 'reclaimed';
    for (const offer of next.offers) if (offer.status === 'open' && (offer.fromId === memberId || offer.toId === memberId)) { offer.status = 'stale'; offer.resolvedAt = now; }
    return finish(state, next, [{ type: 'tray-reclaimed', memberId, groupIds: returned, at: now }], now);
  } catch (error) { return reject(state, error); }
}
export function applyCommand(state, actorId, command, serverNow) {
  try {
    assertState(state); clock(serverNow); active(state, actorId);
    if (!object(command) || typeof command.type !== 'string') fail('INVALID_COMMAND', 'Choose an assembly action.');
    if (command.expectedRevision !== state.revision) fail('STALE_REVISION', 'The room changed. Refresh it before making this move.');
    if (state.status === 'complete') fail('ROOM_COMPLETE', 'All three paintings are complete.');
    const next = clone(state), stats = next.contributors.find(item => item.id === actorId), events = [], now = serverNow;
    switch (command.type) {
      case 'claim': {
        const item = group(next, command.groupId); if (!item || item.location !== 'rack') fail('NOT_ON_RACK', 'This cluster has already left the rack.');
        const count = tray(next, actorId).length; if (count >= TRAY_LIMIT) fail('TRAY_FULL', 'Join, offer or return a cluster to make room.');
        touch(next, item, now); item.location = 'tray'; item.ownerId = actorId; centerInSlot(next, item, count); addContributor(item, actorId); stats.claims++;
        events.push({ type: 'cluster-claimed', actorId, groupId: item.id, at: now }); break;
      }
      case 'move': {
        const item = held(next, actorId, command.groupId);
        if (!Number.isFinite(command.x) || !Number.isFinite(command.y)) fail('INVALID_POSITION', 'Choose a position inside the work area.');
        if (item.x === command.x && item.y === command.y) fail('NO_CHANGE', 'The cluster is already at that position.');
        item.x = command.x; item.y = command.y; if (!inside(next, item)) fail('OUTSIDE_TRAY', 'Keep the whole cluster inside the work area.'); touch(next, item, now);
        events.push({ type: 'cluster-moved', actorId, groupId: item.id, at: now }); break;
      }
      case 'rotate': {
        const item = held(next, actorId, command.groupId); if (![1, -1].includes(command.quarterTurns)) fail('INVALID_ROTATION', 'Turn the cluster one quarter clockwise or counterclockwise.');
        const before = tiles(next, item), cx = before.reduce((sum,tile) => sum + tile.x, 0) / before.length, cy = before.reduce((sum,tile) => sum + tile.y, 0) / before.length;
        item.rotation = (item.rotation + command.quarterTurns + 4) % 4;
        const after = tiles(next, item); item.x += cx - after.reduce((sum,tile) => sum + tile.x, 0) / after.length; item.y += cy - after.reduce((sum,tile) => sum + tile.y, 0) / after.length;
        if (!inside(next, item)) fail('OUTSIDE_TRAY', 'Move the cluster away from the edge before rotating.'); touch(next, item, now);
        events.push({ type: 'cluster-rotated', actorId, groupId: item.id, at: now }); break;
      }
      case 'join': {
        if (command.groupId === command.targetGroupId) fail('SAME_CLUSTER', 'Choose two different clusters.');
        const moving = held(next, actorId, command.groupId), target = held(next, actorId, command.targetGroupId);
        if (moving.artworkId !== target.artworkId || !neighbors(moving, target, pieceMap(next))) fail('NOT_NEIGHBORS', 'These pieces do not share an edge in the same painting.');
        if (moving.rotation !== target.rotation || Math.hypot(moving.x - target.x, moving.y - target.y) > BOARD.snapDistance + 1e-10) fail('NOT_ALIGNED', 'Match the rotation and align the shared edges before joining.');
        touch(next, moving, now); touch(next, target, now); target.pieceIds = [...target.pieceIds, ...moving.pieceIds].sort((a,b) => Number(a.slice(1)) - Number(b.slice(1))); target.contributors = [...new Set([...target.contributors, ...moving.contributors, actorId])];
        next.groups.splice(next.groups.indexOf(moving), 1); stats.joins++;
        if (!inside(next, target)) fail('OUTSIDE_TRAY', 'Move both clusters inward before joining.');
        events.push({ type: 'clusters-joined', actorId, groupId: moving.id, targetGroupId: target.id, at: now });
        if (target.pieceIds.length === 16) { target.location = 'completed'; target.ownerId = null; target.x = 7; target.y = 5; target.rotation = 0; stats.completedArtworks.push(target.artworkId); events.push({ type: 'painting-completed', actorId, artworkId: target.artworkId, at: now }); }
        if (next.groups.filter(item => item.location === 'completed').length === 3) { next.status = 'complete'; next.completedAt = now; events.push({ type: 'assembly-completed', actorId, mode: next.mode, at: now }); }
        break;
      }
      case 'return': {
        const item = held(next, actorId, command.groupId); touch(next, item, now); item.location = 'rack'; item.ownerId = null;
        events.push({ type: 'cluster-returned', actorId, groupId: item.id, at: now }); break;
      }
      case 'offer': {
        const item = held(next, actorId, command.groupId); active(next, command.toId);
        if (command.toId === actorId) fail('SAME_PLAYER', 'Choose another player for this offer.');
        if (next.mode !== 'team') fail('SOLO_ROOM', 'Offers are available in a shared room.');
        if (next.offers.some(offer => offer.groupId === item.id && offer.status === 'open')) fail('OFFER_EXISTS', 'Cancel the existing offer before making another.');
        const offer = { id: 'o' + next.nextOffer++, fromId: actorId, toId: command.toId, groupId: item.id, groupVersion: item.version, status: 'open', createdAt: now, resolvedAt: null };
        next.offers.push(offer); events.push({ type: 'cluster-offered', actorId, offerId: offer.id, groupId: item.id, toId: command.toId, at: now }); break;
      }
      case 'accept': {
        const offer = next.offers.find(item => item.id === command.offerId); if (!offer) fail('OFFER_NOT_FOUND', 'This offer is no longer available.');
        if (offer.toId !== actorId) fail('NOT_YOUR_OFFER', 'This offer is for another player.');
        if (offer.status !== 'open') fail('OFFER_CLOSED', 'This offer has already changed or ended.');
        const item = group(next, offer.groupId); if (!item || item.location !== 'tray' || item.ownerId !== offer.fromId || item.version !== offer.groupVersion) fail('STALE_OFFER', 'The offered cluster changed. Ask for a new offer.');
        active(next, offer.fromId); const count = tray(next, actorId).length; if (count >= TRAY_LIMIT) fail('TRAY_FULL', 'Make room on your tray before accepting.');
        offer.status = 'accepted'; offer.resolvedAt = now; touch(next, item, now); item.ownerId = actorId; centerInSlot(next, item, count); addContributor(item, actorId); stats.transfers++;
        events.push({ type: 'cluster-transferred', actorId, fromId: offer.fromId, offerId: offer.id, groupId: item.id, at: now }); break;
      }
      case 'cancelOffer': {
        const offer = next.offers.find(item => item.id === command.offerId); if (!offer) fail('OFFER_NOT_FOUND', 'This offer is no longer available.');
        if (offer.fromId !== actorId && offer.toId !== actorId) fail('NOT_YOUR_OFFER', 'This offer belongs to other players.');
        if (offer.status !== 'open') fail('OFFER_CLOSED', 'This offer has already changed or ended.'); offer.status = 'cancelled'; offer.resolvedAt = now;
        events.push({ type: 'offer-cancelled', actorId, offerId: offer.id, at: now }); break;
      }
      case 'takeover': {
        if (actorId !== next.ownerId) fail('OWNER_ONLY', 'Only the room owner can continue alone.');
        if (next.mode !== 'team') fail('SOLO_ROOM', 'This assembly is already being played alone.');
        if (next.members.some(person => person.id !== actorId && person.status === 'active')) fail('PLAYERS_PRESENT', 'Other players still have active room access. Wait for their return window to end.');
        next.mode = 'solo-takeover'; next.takeover = { by: actorId, at: now };
        events.push({ type: 'solo-takeover', actorId, at: now }); break;
      }
      default: fail('INVALID_COMMAND', 'This assembly action is not supported.');
    }
    return finish(state, next, events, now);
  } catch (error) { return reject(state, error); }
}
export function renderSnapshot(state, actorId) {
  assertState(state); if (actorId !== null && !member(state, actorId)) fail('PLAYER_NOT_FOUND', 'This player is not in the room.');
  const view = clone(state); for (const item of view.groups) item.tiles = tiles(view, item);
  return { ...view, youId: actorId, board: { ...BOARD }, trayLimit: TRAY_LIMIT };
}
