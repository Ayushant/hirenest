import React, {useEffect, useState} from 'react';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useAuth} from '../../auth/AuthProvider';
import {supabase} from '../../lib/supabase';
import {emptyOnboarding, cleanOnboarding, validateOnboarding, type OnboardingDetails} from '../../lib/onboarding';
import {OnboardingFields} from './OnboardingFields';
import {Button, Dialog, Input} from '../ui/kit';
import {useToast} from '../ui/Toast';

type Completion = {kind: 'candidate'|'client'|'vendor'|'member'; company_edit: boolean; needs_completion: boolean; candidate_link_required: boolean; details: Record<string, unknown>};
export function OnboardingCompletion() {
 const {profile, refreshProfile} = useAuth();
 const qc = useQueryClient();
 const {toast} = useToast();
 const [open,setOpen] = useState(false);
 const [saving,setSaving] = useState(false);
 const [name,setName] = useState('');
 const [value,setValue] = useState<OnboardingDetails>({...emptyOnboarding});
 const q = useQuery({queryKey:['my_onboarding',profile?.id],enabled:profile?.status==='active',queryFn:async()=>{
   const {data,error} = await supabase.rpc('my_onboarding_details');
   if(error) throw error;
   return data as Completion;
 }});
 useEffect(()=>{
   if(!q.data) return;
   setName(String(q.data.details.full_name || ''));
   const next={...emptyOnboarding};
   for(const key of Object.keys(emptyOnboarding) as Array<keyof OnboardingDetails>) {
     const raw=q.data.details[key];
     if(raw!=null) (next as Record<string,unknown>)[key]=Array.isArray(emptyOnboarding[key]) ? raw : String(raw);
   }
   setValue(next);
 },[q.data]);
 if(!q.data?.needs_completion) return null;
 const info=q.data;
 const fullForm=info.kind==='candidate' || info.company_edit;
 async function save(event:React.FormEvent) {
   event.preventDefault();setSaving(true);
   try {
     if(fullForm && info.kind!=='member') validateOnboarding(value,info.kind);
     const details=fullForm && info.kind!=='member' ? cleanOnboarding(value,info.kind) : {phone:value.phone,designation:value.designation,department:value.department,business_role:value.business_role};
     const {error}=await supabase.rpc('complete_my_onboarding',{p_details:{...details,full_name:name}});
     if(error) throw error;
     await refreshProfile();await qc.invalidateQueries();setOpen(false);
     toast({title:'Onboarding details updated',tone:'success'});
   } catch(error) {toast({title:'Could not complete your details',description:error instanceof Error ? error.message : String(error),tone:'error'});}
   finally {setSaving(false);}
 }
 return <section className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
   <p className="font-semibold">Complete your profile details</p>
   {info.candidate_link_required ? <p className="text-[13px]">Create your candidate profile in the Candidate workspace, or ask Admin to link an existing record. Submitted details transfer when linked.</p> : <>
     <p className="mb-2 text-[13px]">Add missing contact and onboarding information so your profile and organisation stay consistent.</p>
     <Button size="sm" onClick={()=>setOpen(true)}>Complete details</Button>
   </>}
   <Dialog open={open} onClose={()=>setOpen(false)} title="Complete your onboarding details">
     <form onSubmit={save} className="space-y-4">
       <Input label="Full name" value={name} required minLength={2} onChange={e=>setName(e.target.value)} />
       {fullForm && info.kind!=='member' ? <OnboardingFields value={value} onChange={setValue} kind={info.kind} /> : <>
         {(['phone',...(info.kind==='member' ? [] : ['designation','department','business_role'])] as Array<keyof OnboardingDetails>).map(key=><Input key={key} label={key.replaceAll('_',' ')} value={String(value[key])} required={key!=='business_role'} onChange={e=>setValue({...value,[key]:e.target.value})} />)}
       </>}
       <Button type="submit" loading={saving}>Save details</Button>
     </form>
   </Dialog>
 </section>;
}
