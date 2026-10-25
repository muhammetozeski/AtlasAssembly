import artworks from '../content/artworks.json' with {type:'json'};
import {createState,addPlayer,applyCommand} from '../shared/engine.mjs';
import {ROOM_MS,LEASE_MS,MAX_RECEIPTS,fail,json,shape,uuid,secret,nameOf,hash,keysFor,canonical,readBody,rate,commandOf} from './rules.mjs';
import {stateText,roomRow,authenticate,commit,settleRoom,envelope,receiptDto,receiptRow} from './store.mjs';
import {cleanupExpiredAtlasData} from './maintenance.mjs';

export const config={configured:true,rulesVersion:'aa-v1',artworkIds:artworks.map(art=>art.id),retentionSeconds:ROOM_MS/1000,leaseSeconds:90,heartbeatSeconds:20,pollSeconds:3,maxPlayers:3,trayLimit:6};
const responseError=(row)=>fail(row.http_status,row.error_message,row.error_code);
async function registrationRate(c){
 const now=Date.now(),address=c.request.headers.get('CF-Connecting-IP')?.trim();
 const scope=address&&/^[0-9a-f:.]{3,64}$/i.test(address)
  ?'atlas-register:cf:'+await hash(canonical({domain:'atlas-assembly/registration/ip/v1',minute:Math.floor(now/60000),address:address.toLowerCase()}))
  :'atlas-register:local';
 await rate(c.db,scope,90,60,now);
}
async function registration(c,kind,id){
 const body=await readBody(c.request);shape(body,kind==='create'?['opId','requestKey','name','seed']:['opId','requestKey','name']);const opId=uuid(body.opId),proof=secret(body.requestKey),name=nameOf(body.name);
 if(body.seed!==undefined&&(!Number.isInteger(body.seed)||body.seed<0||body.seed>4294967295))fail(400,'Choose a seed from 0 to 4294967295.','invalid_seed');
 await registrationRate(c);
 const signature=await hash(canonical({kind,roomId:id??null,...body}));
 let registered=await c.db.prepare('SELECT * FROM atlas_registrations WHERE op_id=?').bind(opId).first();
 if(registered&&registered.signature!==signature)fail(409,'This request belongs to a different room action.','operation_mismatch');
 if(!registered){
  await cleanupExpiredAtlasData(c.db);
  const current=kind==='join'?await settleRoom(c,id):null,now=Date.now(),roomId=id??crypto.randomUUID(),playerId=crypto.randomUUID(),seed=body.seed??crypto.getRandomValues(new Uint32Array(1))[0];
  await c.db.prepare("INSERT INTO atlas_registrations(op_id,kind,signature,room_id,player_id,seed,status,created_at,expires_at) VALUES(?,?,?,?,?,?,'pending',?,?) ON CONFLICT(op_id) DO NOTHING").bind(opId,kind,signature,roomId,playerId,seed,now,(current?.expires_at??now+ROOM_MS)+86400000).run();
  registered=await c.db.prepare('SELECT * FROM atlas_registrations WHERE op_id=?').bind(opId).first();
  if(registered.signature!==signature)fail(409,'This request belongs to a different room action.','operation_mismatch');
 }
 if(registered.expires_at<=Date.now())fail(410,'This saved room action has expired. Start again.','registration_expired');
 if(registered.status==='rejected')responseError(registered);
 const keys=await keysFor(proof,registered.room_id,registered.player_id,kind==='create'),playerHash=await hash(keys.playerKey);
 c.actorId=registered.player_id;c.keyHash=playerHash;
 if(registered.status!=='accepted'){
  try{
   if(kind==='create'){
    if(registered.created_at+ROOM_MS<=Date.now())fail(410,'This room has expired. Start a new room.','room_expired');
    const state=createState({seed:registered.seed,ownerId:registered.player_id,ownerName:name,now:registered.created_at,mode:'team',artworks}),write=crypto.randomUUID();
    await c.db.batch([
     c.db.prepare("INSERT INTO atlas_rooms(id,state,revision,owner_key_hash,write_id,created_at,updated_at,expires_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM atlas_registrations WHERE op_id=? AND signature=? AND status='pending') ON CONFLICT(id) DO NOTHING").bind(registered.room_id,stateText(state),state.revision,await hash(keys.ownerKey),write,registered.created_at,registered.created_at,registered.created_at+ROOM_MS,opId,signature),
     c.db.prepare('INSERT INTO atlas_players(room_id,id,key_hash,lease_until,last_seen) SELECT id,?,?,?,? FROM atlas_rooms WHERE id=? AND write_id=? ON CONFLICT(room_id,id) DO NOTHING').bind(registered.player_id,playerHash,Date.now()+LEASE_MS,Date.now(),registered.room_id,write),
     c.db.prepare("UPDATE atlas_registrations SET status='accepted' WHERE op_id=? AND signature=? AND status='pending' AND EXISTS(SELECT 1 FROM atlas_rooms WHERE id=? AND write_id=?)").bind(opId,signature,registered.room_id,write)
    ]);
   }else{
    let joined=false;
    for(let pass=0;pass<5&&!joined;pass++){
     registered=await c.db.prepare('SELECT * FROM atlas_registrations WHERE op_id=?').bind(opId).first();if(registered.status==='accepted'){joined=true;break;}
     const row=await settleRoom(c,id),count=await c.db.prepare('SELECT COUNT(*) AS count FROM atlas_players WHERE room_id=?').bind(id).first();if(count.count>=3)fail(409,'This room already has three players. Reconnect with your saved player access.','room_full');
     const result=addPlayer(JSON.parse(row.state),{id:registered.player_id,name},Date.now());if(!result.ok)fail(409,result.error.message,result.error.code);
     joined=await commit(c,row,result.state,[
      (write,now)=>c.db.prepare('INSERT INTO atlas_players(room_id,id,key_hash,lease_until,last_seen) SELECT id,?,?,?,? FROM atlas_rooms WHERE id=? AND write_id=?').bind(registered.player_id,playerHash,now+LEASE_MS,now,id,write),
      (write)=>c.db.prepare("UPDATE atlas_registrations SET status='accepted' WHERE op_id=? AND status='pending' AND EXISTS(SELECT 1 FROM atlas_rooms WHERE id=? AND write_id=?)").bind(opId,id,write)
     ],[{sql:"EXISTS(SELECT 1 FROM atlas_registrations WHERE op_id=? AND signature=? AND status='pending') AND (SELECT COUNT(*) FROM atlas_players WHERE room_id=atlas_rooms.id)<3",args:[opId,signature]}]);
    }
    if(!joined)fail(409,'The room changed. Try the same join action again.','room_changed');
   }
  }catch(error){
   if(error.status&&error.code!=='room_changed')await c.db.prepare("UPDATE atlas_registrations SET status='rejected',error_code=?,error_message=?,http_status=? WHERE op_id=? AND status='pending'").bind(error.code,error.message,error.status,opId).run();
   const recovered=await c.db.prepare('SELECT * FROM atlas_registrations WHERE op_id=?').bind(opId).first();
   if(recovered?.status==='accepted')registered=recovered;
   else throw error;
  }
 }
 registered=await c.db.prepare('SELECT * FROM atlas_registrations WHERE op_id=?').bind(opId).first();if(registered.status!=='accepted')fail(409,'The room is still being prepared. Retry the same action.','registration_pending');
 const row=await settleRoom(c,registered.room_id);return json(await envelope(c,row,{playerId:c.actorId,...keys,inviteUrl:c.env.SITE_ORIGIN+'/atlas-assembly/?room='+row.id}),kind==='create'?201:200);
}

async function reject(c,id,opId,status,message,code){await c.db.prepare("UPDATE atlas_receipts SET status='rejected',error_code=?,error_message=?,http_status=?,updated_at=? WHERE room_id=? AND player_id=? AND op_id=? AND status='pending'").bind(code,message,status,Date.now(),id,c.actorId,opId).run();const receipt=await receiptRow(c,id,opId);if(receipt.status==='accepted')return json(await envelope(c,await settleRoom(c,id),{receipt:receiptDto(receipt)}));fail(receipt.http_status,receipt.error_message,receipt.error_code,receiptDto(receipt));}

async function command(c,id){
 const body=await readBody(c.request);shape(body,['opId','revision','command']);const opId=uuid(body.opId);if(!Number.isSafeInteger(body.revision)||body.revision<0||!body.command||typeof body.command!=='object'||Array.isArray(body.command))fail(400,'Reload the room before trying this move.','invalid_body');
 const signature=await hash(canonical(body));let receipt=await receiptRow(c,id,opId);
 if(receipt&&receipt.signature!==signature)fail(409,'This request already belongs to another move.','operation_mismatch',receiptDto(receipt));
 if(!receipt){await rate(c.db,'atlas-command:'+id+':'+c.actorId,150);const count=await c.db.prepare('SELECT COUNT(*) AS count FROM atlas_receipts WHERE room_id=?').bind(id).first();if(count.count>=MAX_RECEIPTS)fail(429,'This room has reached its action limit. Start a new room.','action_limit');await c.db.prepare("INSERT INTO atlas_receipts(room_id,player_id,op_id,signature,status,created_at,updated_at) VALUES(?,?,?,?,'pending',?,?) ON CONFLICT(room_id,player_id,op_id) DO NOTHING").bind(id,c.actorId,opId,signature,Date.now(),Date.now()).run();receipt=await receiptRow(c,id,opId);}
 if(receipt.signature!==signature)fail(409,'This request already belongs to another move.','operation_mismatch',receiptDto(receipt));
 if(receipt.status==='accepted')return json(await envelope(c,await settleRoom(c,id),{receipt:receiptDto(receipt)}));
 if(receipt.status==='rejected')fail(receipt.http_status,receipt.error_message,receipt.error_code,receiptDto(receipt));
 let action;try{action=commandOf(body);}catch(error){if(error.status)return reject(c,id,opId,error.status,error.message,error.code);throw error;}
 const row=await settleRoom(c,id);
 if(action.type==='takeover'){
  const owner=c.request.headers.get('X-Atlas-Owner-Key');if(!owner||!/^[-_A-Za-z0-9]{43}$/.test(owner)||await hash(owner)!==row.owner_key_hash)return reject(c,id,opId,403,'Only the room owner can continue solo.','owner_required');
  const active=await c.db.prepare('SELECT COUNT(*) AS count FROM atlas_players WHERE room_id=? AND id<>? AND reclaimed_at IS NULL').bind(id,c.actorId).first();if(active.count)return reject(c,id,opId,409,'Wait for the other players to leave before continuing solo.','players_present');
 }
 const result=applyCommand(JSON.parse(row.state),c.actorId,action,Date.now());
 if(!result.ok)return reject(c,id,opId,result.error.code==='STALE_REVISION'?409:400,result.error.message,result.error.code);
 if(result.state.revision<=row.revision)return reject(c,id,opId,400,'Choose a different move.','unchanged_move');
 const changed=await commit(c,row,result.state,[(write,now)=>c.db.prepare("UPDATE atlas_receipts SET status='accepted',revision=?,updated_at=? WHERE room_id=? AND player_id=? AND op_id=? AND signature=? AND status='pending' AND EXISTS(SELECT 1 FROM atlas_rooms WHERE id=? AND write_id=?)").bind(result.state.revision,now,id,c.actorId,opId,signature,id,write)],[{sql:"EXISTS(SELECT 1 FROM atlas_receipts WHERE room_id=atlas_rooms.id AND player_id=? AND op_id=? AND signature=? AND status='pending')",args:[c.actorId,opId,signature]}]);
 receipt=await receiptRow(c,id,opId);if(!changed&&receipt.status!=='accepted')return reject(c,id,opId,409,'The room changed. Check it before choosing another move.','revision_conflict');
 return json(await envelope(c,await settleRoom(c,id),{receipt:receiptDto(receipt)}));
}

async function heartbeat(c,id){
 const body=await readBody(c.request,128);shape(body,[]);await rate(c.db,'atlas-heartbeat:'+id+':'+c.actorId,12);
 for(let pass=0;pass<5;pass++){
  const row=await settleRoom(c,id),now=Date.now(),player=await c.db.prepare('SELECT * FROM atlas_players WHERE room_id=? AND id=? AND key_hash=?').bind(id,c.actorId,c.keyHash).first();if(!player)fail(401,'Player access was not found.','authentication');
  if(player.reclaimed_at===null){const updated=await c.db.prepare('UPDATE atlas_players SET lease_until=?,last_seen=? WHERE room_id=? AND id=? AND key_hash=? AND reclaimed_at IS NULL AND EXISTS(SELECT 1 FROM atlas_rooms WHERE id=? AND expires_at>?)').bind(now+LEASE_MS,now,id,c.actorId,c.keyHash,id,now).run();if(updated.meta.changes)return json(await envelope(c,await settleRoom(c,id)));continue;}
  const result=addPlayer(JSON.parse(row.state),{id:c.actorId,name:JSON.parse(row.state).members.find(member=>member.id===c.actorId)?.name??'Player'},now);if(!result.ok)fail(403,result.error.message,result.error.code);
  if(await commit(c,row,result.state,[(write,time)=>c.db.prepare('UPDATE atlas_players SET lease_until=?,last_seen=?,reclaimed_at=NULL WHERE room_id=? AND id=? AND EXISTS(SELECT 1 FROM atlas_rooms WHERE id=? AND write_id=?)').bind(time+LEASE_MS,time,id,c.actorId,id,write)]))return json(await envelope(c,await settleRoom(c,id)));
 }
 fail(409,'The room changed while reconnecting. Refresh it.','room_changed');
}

export async function roomRoutes(c,parts){
 if(parts.length===1&&parts[0]==='rooms'&&c.request.method==='POST')return registration(c,'create');
 if(parts[0]!=='rooms'||parts.length<2)return null;const id=uuid(parts[1]);
 if(parts.length===3&&parts[2]==='join'&&c.request.method==='POST')return registration(c,'join',id);
 await roomRow(c.db,id);await authenticate(c,id);await rate(c.db,'atlas-read:'+id+':'+c.actorId,240);
 if(parts.length===2&&c.request.method==='GET')return json(await envelope(c,await settleRoom(c,id)));
 if(parts.length===4&&parts[2]==='receipts'&&c.request.method==='GET'){const opId=uuid(parts[3]),row=await settleRoom(c,id),receipt=await receiptRow(c,id,opId);return json(await envelope(c,row,{found:!!receipt,receipt:receiptDto(receipt)}));}
 if(parts.length===3&&parts[2]==='heartbeat'&&c.request.method==='POST')return heartbeat(c,id);
 if(parts.length===3&&parts[2]==='commands'&&c.request.method==='POST')return command(c,id);
 return null;
}
