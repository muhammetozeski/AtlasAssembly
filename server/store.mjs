import {reclaimPlayer,renderSnapshot,validateState} from '../shared/engine.mjs';
import {fail,hash,secret,uuid,MAX_STATE_BYTES} from './rules.mjs';

export function stateText(state){if(!validateState(state).ok)fail(500,'The room could not be opened. Try again.','invalid_state');const value=JSON.stringify(state);if(new TextEncoder().encode(value).length>MAX_STATE_BYTES)fail(409,'This room has reached its history limit. Start a new room.','state_limit');return value;}
export async function roomRow(db,id){uuid(id);const row=await db.prepare('SELECT * FROM atlas_rooms WHERE id=?').bind(id).first();if(!row)fail(404,'This room was not found. Check the invitation.','room_missing');if(row.expires_at<=Date.now())fail(410,'This room has expired. Start a new room.','room_expired');return row;}
export async function authenticate(c,id){const header=c.request.headers.get('Authorization')||'';if(!/^Bearer [A-Za-z0-9_-]{43}$/.test(header))fail(401,'Open this room with its saved player access.','authentication');const keyHash=await hash(secret(header.slice(7))),player=await c.db.prepare('SELECT * FROM atlas_players WHERE room_id=? AND key_hash=?').bind(id,keyHash).first();if(!player)fail(401,'Player access was not found on this device.','authentication');c.player=player;c.keyHash=keyHash;c.actorId=player.id;return player;}

/** Conditional state and its related rows commit together; callers provide only trusted SQL changes. */
export async function commit(c,row,next,extra=[],conditions=[]){
 const token=crypto.randomUUID(),now=Date.now(),clauses=['id=?','revision=?','expires_at>?'],args=[row.id,row.revision,now];
 if(c.player){clauses.push('EXISTS(SELECT 1 FROM atlas_players p WHERE p.room_id=atlas_rooms.id AND p.id=? AND p.key_hash=?)');args.push(c.actorId,c.keyHash);}
 for(const condition of conditions){clauses.push(condition.sql);args.push(...condition.args);}
 const statements=[c.db.prepare('UPDATE atlas_rooms SET state=?,revision=?,write_id=?,updated_at=? WHERE '+clauses.join(' AND ')).bind(stateText(next),next.revision,token,now,...args),...extra.map(make=>make(token,now))];
 const result=await c.db.batch(statements);return !!result[0].meta.changes;
}

/** The old lease is part of the same state admission, preventing stale reclamation after a heartbeat. */
export async function settleRoom(c,id){
 for(let pass=0;pass<5;pass++){
  const row=await roomRow(c.db,id),now=Date.now(),expired=(await c.db.prepare('SELECT * FROM atlas_players WHERE room_id=? AND reclaimed_at IS NULL AND lease_until<=? ORDER BY id').bind(id,now).all()).results;
  if(!expired.length)return row;
  let state=JSON.parse(row.state);for(const player of expired){const result=reclaimPlayer(state,player.id,now);if(!result.ok)fail(500,'The room could not be reopened. Try again.','reclaim_failed');state=result.state;}
  const conditions=expired.map(player=>({sql:'EXISTS(SELECT 1 FROM atlas_players p WHERE p.room_id=atlas_rooms.id AND p.id=? AND p.lease_until=? AND p.lease_until<=? AND p.reclaimed_at IS NULL)',args:[player.id,player.lease_until,now]}));
  const updates=expired.map(player=>(token)=>c.db.prepare('UPDATE atlas_players SET reclaimed_at=? WHERE room_id=? AND id=? AND reclaimed_at IS NULL AND EXISTS(SELECT 1 FROM atlas_rooms WHERE id=? AND write_id=?)').bind(now,id,player.id,id,token));
  if(await commit(c,row,state,updates,conditions))return roomRow(c.db,id);
 }
 fail(409,'The room changed while reconnecting. Refresh it.','room_changed');
}

export async function envelope(c,row,extra={}){
 const presence=(await c.db.prepare('SELECT id AS playerId,lease_until AS leaseUntil,reclaimed_at AS reclaimedAt FROM atlas_players WHERE room_id=? ORDER BY id').bind(row.id).all()).results;
 return{room:{id:row.id,revision:row.revision,state:renderSnapshot(JSON.parse(row.state),c.actorId),createdAt:row.created_at,updatedAt:row.updated_at,expiresAt:row.expires_at,presence},me:{playerId:c.actorId,isOwner:JSON.parse(row.state).ownerId===c.actorId},serverTime:Date.now(),...extra};
}

export const receiptDto=row=>row?{opId:row.op_id,status:row.status,revision:row.revision,error:row.error_code?{code:row.error_code,error:row.error_message}:null}:null;
export async function receiptRow(c,id,opId){return c.db.prepare('SELECT * FROM atlas_receipts WHERE room_id=? AND player_id=? AND op_id=?').bind(id,c.actorId,opId).first();}
