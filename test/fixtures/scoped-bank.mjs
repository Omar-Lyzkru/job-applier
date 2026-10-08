import {randomUUID} from 'node:crypto';
import {describeBankQuestion} from '../../src/answer-bank.mjs';
export function scopedEntry(field,value,scope={kind:'job',jobId:String(field.jobId)},extra={}){const at='2026-10-07T12:00:00.000Z';return {id:randomUUID(),revision:1,state:'active',value,sourceQuestion:field.label,question:describeBankQuestion(field),scope,confirmedAt:at,updatedAt:at,expiresAt:null,provenance:{jobId:String(field.jobId),recordId:'observed',company:field.company||''},...extra};}
export const scopedBank=(...entries)=>({version:1,revision:1,entries});
