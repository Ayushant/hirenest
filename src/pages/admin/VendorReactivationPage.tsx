import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CalendarCheck, CheckCircle2, Clock3, MessageSquareText, RefreshCw, Send, Users } from 'lucide-react';
import { Button, PageHeader } from '../../components/ui/kit';
import { useToast } from '../../components/ui/Toast';
import { supabase } from '../../lib/supabase';

type Feedback = { trial_exploration:string;biggest_challenge:string;feature_suggestion_one:string;feature_suggestion_two:string;wants_onboarding_call:boolean;contact_number:string|null;preferred_call_time:string|null;additional_feedback:string|null;submitted_at:string };
type Invite = { id:string;status:string;created_at:string;responded_at:string|null;onboarding_call_scheduled_at:string|null;onboarding_call_completed_at:string|null;reactivation_days:number|null;reactivated_at:string|null;feedback:Feedback|null;invites?:Invite[] };
type Vendor = { id:string;name:string;email:string|null;contactName:string;contactPhone:string|null;trialEndsAt:string|null;expired:boolean;expiringSoon:boolean;latestInvite:Invite|null;invites:Invite[] };
type DashboardData = { vendors:Vendor[];stats:{expiredVendors:number;feedbackReceived:number;reactivatedVendors:number;onboardingCallsPending:number} };

async function api(path:string,init:RequestInit={}) {
  const {data}=await supabase.auth.getSession(); const headers=new Headers(init.headers);
  if(data.session?.access_token)headers.set('Authorization',`Bearer ${data.session.access_token}`);
  if(init.body)headers.set('Content-Type','application/json');
  const response=await fetch(path,{...init,headers}); const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||'The request could not be completed.'); return body;
}
const nice=(v:string)=>v.replaceAll('_',' ').replace(/^./,x=>x.toUpperCase());
const shortDate=(v:string|null)=>v?new Date(v).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}):'Not set';

export const VendorReactivationPage:React.FC=()=>{
  const {toast}=useToast(); const qc=useQueryClient(); const [reason,setReason]=useState<Record<string,string>>({}); const [callTime,setCallTime]=useState<Record<string,string>>({});
  const query=useQuery({queryKey:['vendor-reactivation'],queryFn:()=>api('/api/admin/vendor-reactivation') as Promise<DashboardData>});
  const refresh=()=>qc.invalidateQueries({queryKey:['vendor-reactivation']});
  const send=useMutation({mutationFn:(orgId:string)=>api('/api/admin/vendor-reactivation/send',{method:'POST',body:JSON.stringify({orgId})}),onSuccess:()=>{toast({title:'Feedback email sent',tone:'success'});refresh();},onError:e=>toast({title:'Email not sent',description:(e as Error).message,tone:'error'})});
  const call=useMutation({mutationFn:({id,completed,scheduledAt}:{id:string;completed?:boolean;scheduledAt?:string})=>api(`/api/admin/vendor-reactivation/${id}/call`,{method:'PATCH',body:JSON.stringify({completed,scheduledAt})}),onSuccess:()=>{toast({title:'Onboarding call updated',tone:'success'});refresh();},onError:e=>toast({title:'Could not update call',description:(e as Error).message,tone:'error'})});
  const reactivate=useMutation({mutationFn:({id,days}:{id:string;days:number})=>api(`/api/admin/vendor-reactivation/${id}/reactivate`,{method:'POST',body:JSON.stringify({days,reason:reason[id]||''})}),onSuccess:()=>{toast({title:'Vendor trial reactivated',tone:'success'});refresh();},onError:e=>toast({title:'Reactivation not approved',description:(e as Error).message,tone:'error'})});
  const stats=query.data?.stats;
  return <div className="mx-auto max-w-6xl space-y-7 px-4 py-6 md:px-8">
    <PageHeader title="Vendor reactivation" description="Collect feedback, arrange onboarding, and review complimentary access." />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        {label:'Expired vendors',value:stats?.expiredVendors,icon:Clock3},
        {label:'Feedback received',value:stats?.feedbackReceived,icon:MessageSquareText},
        {label:'Reactivated vendors',value:stats?.reactivatedVendors,icon:CheckCircle2},
        {label:'Onboarding calls pending',value:stats?.onboardingCallsPending,icon:CalendarCheck},
      ].map(s=><div key={s.label} className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between text-sm text-slate-600"><span>{s.label}</span><s.icon size={18} className="text-blue-700"/></div><div className="mt-3 text-3xl font-semibold text-slate-900">{s.value??'—'}</div></div>)}
    </div>
    <section className="rounded-xl border border-slate-200 bg-white p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">Reactivation workflow</h2><p className="mt-1 text-sm text-slate-600">Send one personal feedback invitation at a time. Trial access is only restored after feedback and onboarding.</p></div><Button variant="outline" onClick={()=>refresh()}><RefreshCw size={15} className="mr-2"/>Refresh</Button></div>
      {query.isLoading?<div className="py-12 text-center text-sm text-slate-500">Loading vendor accounts…</div>:query.error?<div className="my-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{(query.error as Error).message}<button className="ml-3 underline" onClick={()=>query.refetch()}>Retry</button></div>:!query.data?.vendors.length?<div className="my-7 rounded-lg border border-dashed border-slate-300 p-8 text-center"><Building2 className="mx-auto mb-3 text-slate-400"/><p className="font-medium text-slate-800">No expired or expiring vendor trials</p><p className="mt-1 text-sm text-slate-500">Approved vendor accounts on a free trial will appear here.</p></div>:<div className="mt-5 space-y-4">{query.data.vendors.map(v=>{
      const latest=v.latestInvite; const f=latest?.feedback;
        return <article key={v.id} className="rounded-xl border border-slate-200 p-4 md:p-5">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-semibold text-slate-900">{v.name}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${latest?.status==='reactivated'?'bg-emerald-50 text-emerald-700':v.expired?'bg-rose-50 text-rose-700':'bg-amber-50 text-amber-800'}`}>{latest?.status==='reactivated'?'Reactivated':v.expired?'Trial expired':'Expires soon'}</span></div><p className="mt-1 text-sm text-slate-600">{v.contactName}{v.email?` · ${v.email}`:' · No contact email'}</p><p className="mt-1 text-xs text-slate-500">Trial expiry: {shortDate(v.trialEndsAt)}</p></div><div className="flex flex-wrap gap-2">{v.email&&(!f||(latest?.status==='reactivated'&&v.expired&&latest.reactivation_days===30))&&<Button size="sm" onClick={()=>send.mutate(v.id)} disabled={send.isPending}><Send size={14} className="mr-1.5"/>{latest?'Start feedback cycle':'Send feedback email'}</Button>}</div></div>
          {latest&&<div className="mt-4 rounded-lg bg-slate-50 p-4"><div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium text-slate-800">Latest invitation: {nice(latest.status)}</span><span className="text-slate-500">Sent {shortDate(latest.created_at)}</span></div>
            {f?<div className="mt-4 grid gap-4 md:grid-cols-2"><div className="space-y-2 text-sm"><p><span className="font-medium">Trial experience:</span> {nice(f.trial_exploration)}</p><p><span className="font-medium">Biggest challenge:</span> {nice(f.biggest_challenge)}</p><p><span className="font-medium">Wants onboarding call:</span> {f.wants_onboarding_call?'Yes':'No'}</p>{f.wants_onboarding_call&&<p><span className="font-medium">Contact:</span> {f.contact_number} {f.preferred_call_time&&`· ${f.preferred_call_time}`}</p>}</div><div className="space-y-2 text-sm"><p><span className="font-medium">Suggestion 1:</span> {f.feature_suggestion_one}</p><p><span className="font-medium">Suggestion 2:</span> {f.feature_suggestion_two}</p>{f.additional_feedback&&<p><span className="font-medium">More feedback:</span> {f.additional_feedback}</p>}</div></div>:<p className="mt-3 text-sm text-slate-600">Waiting for feedback response.</p>}
            {f&&<div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">{f.wants_onboarding_call&&!latest.onboarding_call_completed_at&&<><input aria-label="Onboarding call date and time" type="datetime-local" value={callTime[latest.id]||''} onChange={e=>setCallTime({...callTime,[latest.id]:e.target.value})} className="rounded-md border border-slate-300 px-3 py-2 text-sm"/><Button size="sm" variant="outline" onClick={()=>call.mutate({id:latest.id,scheduledAt:new Date(callTime[latest.id]).toISOString()})} disabled={!callTime[latest.id]||call.isPending}>Schedule call</Button><Button size="sm" variant="outline" onClick={()=>call.mutate({id:latest.id,completed:true})} disabled={call.isPending}><CalendarCheck size={14} className="mr-1.5"/>Mark onboarding complete</Button></>}{latest.onboarding_call_completed_at&&<span className="inline-flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 size={15}/> Onboarding complete</span>}
              {!latest.reactivated_at&&<><input aria-label="Reactivation approval reason" value={reason[latest.id]||''} onChange={e=>setReason({...reason,[latest.id]:e.target.value})} placeholder="Approval reason" className="min-w-40 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"/><Button size="sm" variant="outline" onClick={()=>reactivate.mutate({id:latest.id,days:14})} disabled={!latest.onboarding_call_completed_at||!reason[latest.id]?.trim()||reactivate.isPending}>Reactivate 14 days</Button></>}
              {latest.reactivated_at&&latest.reactivation_days===14&&<><span className="text-sm text-emerald-700">14-day access granted · ends {shortDate(v.trialEndsAt)}</span><input aria-label="Additional 30-day approval reason" value={reason[latest.id]||''} onChange={e=>setReason({...reason,[latest.id]:e.target.value})} placeholder="Strategic extension reason" className="min-w-40 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"/><Button size="sm" onClick={()=>reactivate.mutate({id:latest.id,days:30})} disabled={!reason[latest.id]?.trim()||reactivate.isPending}>Approve additional 30 days</Button></>}
              {latest.reactivated_at&&latest.reactivation_days===30&&<span className="text-sm font-medium text-emerald-700">14-day reactivation plus additional 30 days approved</span>}</div>}
          </div>}
          {v.invites.length>1&&<details className="mt-3 text-sm"><summary className="cursor-pointer text-slate-600">View {v.invites.length} campaign records</summary><div className="mt-2 space-y-1">{v.invites.map(i=><p key={i.id} className="text-xs text-slate-500">{shortDate(i.created_at)} · {nice(i.status)}{i.reactivation_days?` · ${i.reactivation_days} days`:''}</p>)}</div></details>}
        </article>;
      })}</div>}
      <p className="mt-5 flex items-start gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500"><Users size={15} className="mt-0.5 shrink-0"/>The 30-day extension is offered only after an initial 14-day reactivation and requires Platform Admin or Super Admin approval. Every action is recorded in subscription history.</p>
    </section>
  </div>;
};
