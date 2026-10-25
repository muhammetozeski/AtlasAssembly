import {PREFIX,AtlasError,fail,json} from './rules.mjs';
import {config,roomRoutes} from './rooms.mjs';

/** Main-host adapter supplies only its D1 binding and canonical production origin. */
export async function handleAtlasAssembly({request,env}){
 try{
  if(!env.DB||!env.SITE_ORIGIN||new URL(request.url).origin!==env.SITE_ORIGIN)fail(503,'Rooms are unavailable. You can still play solo.','configuration');
  if(!['GET','POST'].includes(request.method))fail(405,'Use GET or POST.','method');
  const url=new URL(request.url);if(!url.pathname.startsWith(PREFIX))fail(404,'This room action was not found.','not_found');
  if(request.method==='POST'&&request.headers.get('Origin')!==env.SITE_ORIGIN)fail(403,'Open Atlas Assembly to use this action.','origin');
  const parts=url.pathname.slice(PREFIX.length).split('/').filter(Boolean);if(parts.some(part=>part.length>100||/%|\.|\\/.test(part)))fail(404,'This room action was not found.','not_found');
  if(parts.length===1&&parts[0]==='config'&&request.method==='GET'){await env.DB.prepare('SELECT id FROM atlas_rooms LIMIT 1').first();return json(config);}
  const result=await roomRoutes({request,env,db:env.DB},parts);if(result)return result;
  fail(404,'This room action was not found.','not_found');
 }catch(error){
  if(error instanceof AtlasError)return json({error:error.message,code:error.code,...(error.receipt?{receipt:error.receipt}:{})},error.status);
  console.error('Atlas room action failed',{type:error?.name??'Error'});return json({error:'The action could not finish. Keep your room open and check the saved move.','code':'service_failure'},500);
 }
}
