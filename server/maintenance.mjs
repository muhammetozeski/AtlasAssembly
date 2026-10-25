/** Host maintenance may invoke this; request reads independently refuse expired rooms. */
export async function cleanupExpiredAtlasData(db,now=Date.now()){
 return db.batch([
  db.prepare('DELETE FROM atlas_rooms WHERE expires_at<=?').bind(now),
  db.prepare('DELETE FROM atlas_registrations WHERE expires_at<=?').bind(now),
  db.prepare('DELETE FROM atlas_rate_limits WHERE expires_at<=?').bind(now)
 ]);
}
