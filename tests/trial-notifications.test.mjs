import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {mkdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const output=path.resolve('node_modules/.cache/trial-notifications-test.mjs');
await mkdir(path.dirname(output),{recursive:true});
let sends=0;let delivery={ok:false,error:'Email is not configured'};
globalThis.__trialTestSend=async()=>{sends++;return delivery;};
await build({entryPoints:['trialNotifications.ts'],outfile:output,bundle:true,format:'esm',platform:'node',packages:'external',plugins:[{name:'fake-mail',setup(b){
 b.onResolve({filter:/emailService$/},()=>({path:'mail',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const sendNotificationEmailViaSmtp = (...args) => globalThis.__trialTestSend(...args);',loader:'js'}));
}}]});
const {runTrialNotificationJob}=await import(pathToFileURL(output));await unlink(output);
function fixture({paid=false,stale=false}={}) {
 const expiry=new Date(Date.now()+5*86400000-10000).toISOString();
 const updates=[];
 return {updates,rpc:async(name)=>({data:name==='claim_trial_notifications' ? [{id:'event',entity_id:'org',event_type:'TRIAL_REMINDER_REQUESTED',payload:{trial_ends_at:stale ? new Date(0).toISOString() : expiry,days_remaining:5}}] : null,error:null}),from(table){
  let update;
  const query={select(){return query;},eq(){return query;},in(){return query;},update(value){update=value;updates.push(value);return query;},maybeSingle:async()=>({data:{trial_ends_at:expiry,subscription_status:paid ? 'active':'trialing',plan_id:paid ? 'scale':'free_trial'},error:null}),single:async()=>({data:{processed_at:null},error:null}),then(resolve,reject){return Promise.resolve({data:table==='profiles' ? [{email:'recipient@test.invalid'}] : null,error:null}).then(resolve,reject);}};
  return query;
 }};
}
test('missing email configuration leaves reminder pending and releases its lease',async()=>{
 sends=0;delivery={ok:false,error:'Email is not configured'};const sb=fixture();await runTrialNotificationJob(sb);
 assert.equal(sends,1);assert.equal(sb.updates[0].processed_at,undefined);assert.equal(sb.updates[0].trial_claimed_until,null);assert.match(sb.updates[0].last_error,/not configured/);
});
test('paid conversion cancels queued reminder without sending email',async()=>{
 sends=0;const sb=fixture({paid:true});await runTrialNotificationJob(sb);assert.equal(sends,0);assert.equal(sb.updates[0].status,'processed');assert.match(sb.updates[0].last_error,/Cancelled/);
});
test('changed trial expiry cancels stale reminder without sending email',async()=>{
 sends=0;const sb=fixture({stale:true});await runTrialNotificationJob(sb);assert.equal(sends,0);assert.equal(sb.updates[0].status,'processed');
});
test('successful delivery marks reminder processed only after sending',async()=>{
 sends=0;delivery={ok:true};const sb=fixture();await runTrialNotificationJob(sb);assert.equal(sends,1);assert.ok(sb.updates[0].processed_at);assert.equal(sb.updates[0].last_error,null);
});
