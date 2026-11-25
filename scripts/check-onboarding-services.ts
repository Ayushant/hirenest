import 'dotenv/config';
import {createClient} from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import {getSmtpConfig} from '../emailService';

// Read-only connection checks. Never send mail or print credential values.
async function main() {
  const url=process.env.VITE_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  let ready=true;
  if(!url || !key || key.startsWith('sb_publishable_')) {
    console.log('MISSING: server-only Supabase service-role key');ready=false;
  } else {
    const sb=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const {error}=await sb.auth.admin.listUsers({page:1,perPage:1});
    console.log(error ? 'FAIL: Supabase administrative connection' : 'PASS: Supabase administrative connection');
    if(error) ready=false;
  }
  if(!process.env.RESEND_API_KEY) {console.log('MISSING: Resend key for team invitations');ready=false;}
  else {
    const response=await fetch('https://api.resend.com/domains',{headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`},signal:AbortSignal.timeout(15000)});
    // Restricted send-only keys cannot list domains; this does not prove sending failed.
    console.log(response.ok ? 'PASS: Resend read-only connection (confirm the configured sender is verified)' : 'UNVERIFIED: Resend key cannot list domains; verify sender/key scope in Resend');
    if(!response.ok) ready=false;
  }
  const smtp=getSmtpConfig();
  if(smtp.configured) {
    const transport=nodemailer.createTransport({host:smtp.host,port:smtp.port,secure:smtp.secure,auth:{user:smtp.user,pass:smtp.pass},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:15000});
    try {await transport.verify();console.log('PASS: SMTP authentication (no email sent)');}
    catch {console.log('FAIL: SMTP authentication');ready=false;}
    finally {transport.close();}
  } else if(process.env.RESEND_API_KEY) console.log('INFO: operational notifications will use Resend fallback');
  else {console.log('MISSING: SMTP settings or Resend fallback for notifications');ready=false;}
  process.exitCode=ready ? 0 : 1;
}
main().catch(()=>{console.error('FAIL: service connection check; no email sent');process.exitCode=1;});
