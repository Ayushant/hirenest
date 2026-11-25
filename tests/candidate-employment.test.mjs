import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {mkdir,unlink} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const output=path.resolve('node_modules/.cache/candidate-employment-test.mjs');
await mkdir(path.dirname(output),{recursive:true});
await build({stdin:{contents:`
 export {emptyOnboarding,candidateEmploymentPayload,validateCandidateEmployment} from './src/lib/onboarding';
 import React from 'react';
 import {renderToStaticMarkup} from 'react-dom/server';
 import {OnboardingFields} from './src/components/domain/OnboardingFields';
 import {CandidateEmploymentSummary} from './src/components/domain/CandidateEmploymentSummary';
 export const fields = value => renderToStaticMarkup(React.createElement(OnboardingFields,{value,onChange:()=>{},kind:'candidate',employmentOnly:true}));
 export const summary = value => renderToStaticMarkup(React.createElement(CandidateEmploymentSummary,{candidate:{candidate_employment:value}}));
`,resolveDir:process.cwd(),loader:'tsx'},outfile:output,bundle:true,platform:'node',format:'esm',packages:'external'});
const {emptyOnboarding,candidateEmploymentPayload,validateCandidateEmployment,fields,summary}=await import(pathToFileURL(output));
await unlink(output);
test('FTE upload form provides editable salary and all notice choices; serving notice exposes LWD',()=>{
 const html=fields({...emptyOnboarding,notice_period:'serving'});
 for(const text of ['FTE','C2C','C2H','Current annual CTC','Expected annual CTC','Immediate Joiner','15–30 Days','30 Days+','Serving Notice Period','Last working day'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('Current contract rate'));
});
test('contract upload form uses commercial rates without FTE-only salary or notice fields',()=>{
 for(const employment_type of ['C2C','C2H']){
 const html=fields({...emptyOnboarding,employment_type});
 assert.ok(html.includes('Current contract rate'));
 assert.ok(!html.includes('Current annual CTC'));
 assert.ok(!html.includes('Notice period'));
 }
});
test('switching models clears incompatible fields and never copies identity data into employment',()=>{
 const fte=candidateEmploymentPayload({...emptyOnboarding,current_rate:'500',current_ctc:'600000',phone:'1234567890'});
 assert.equal(fte.current_rate,null);assert.equal(fte.current_ctc,'600000');assert.ok(!('phone' in fte));
 const contract=candidateEmploymentPayload({...emptyOnboarding,employment_type:'C2H',current_ctc:'600000',notice_period:'15_30',expected_rate:'2000'});
 assert.equal(contract.current_ctc,null);assert.equal(contract.notice_period,null);assert.equal(contract.expected_rate,'2000');
});
test('employment validation rejects negative salary and missing serving-notice LWD',()=>{
 assert.throws(()=>validateCandidateEmployment({...emptyOnboarding,current_ctc:'-1'}));
 assert.throws(()=>validateCandidateEmployment({...emptyOnboarding,notice_period:'serving'}));
});
test('submission summary displays linked salary, notice, LWD and joining details; hidden data stays unavailable',()=>{
 const html=summary({employment_type:'FTE',currency:'INR',current_company:'Agency',current_ctc:500000,expected_ctc:700000,notice_period:'serving',last_working_day:'2026-12-01',expected_joining_date:'2026-12-02',joining_availability:'After notice'});
 for(const text of ['FTE','Agency','500,000','700,000','Serving Notice Period','2026-12-01','2026-12-02','After notice'])assert.ok(html.includes(text));
 assert.ok(summary(null).includes('Employment details unavailable'));
});
