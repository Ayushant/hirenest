import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {mkdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const output=path.resolve('node_modules/.cache/upstream-port-test.mjs');
await mkdir(path.dirname(output),{recursive:true});
await build({stdin:{contents:"export {getHomeRouteForRole} from './src/auth/AuthProvider';",resolveDir:process.cwd(),loader:'ts'},outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'auth-client-stub',setup(b){b.onResolve({filter:/\/supabase$/},()=>({path:'supabase',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const supabase={};export const isSupabaseConfigured=false;',loader:'js'}));}}]});
const {getHomeRouteForRole}=await import(pathToFileURL(output));await unlink(output);
test('updated Admin landing remains the CEO dashboard after porting onboarding',()=>{
 assert.equal(getHomeRouteForRole('admin','active'),'/admin/ceo');
});
test('pending and suspended accounts retain their access gates',()=>{
 assert.equal(getHomeRouteForRole('admin','pending_approval'),'/pending');
 assert.equal(getHomeRouteForRole('admin','suspended'),'/suspended');
});
test('recruitment, client and vendor workspace destinations stay intact',()=>{
 assert.equal(getHomeRouteForRole('recruiter','active'),'/recruiter');
 assert.equal(getHomeRouteForRole('client_manager','active'),'/client');
 assert.equal(getHomeRouteForRole('vendor_admin','active'),'/vendor');
 assert.equal(getHomeRouteForRole('candidate','active'),'/candidate');
});
