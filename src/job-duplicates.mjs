import {createHash} from 'node:crypto';
import {normalizeText} from './job-parser.mjs';
import {blocksRetry} from './domain.mjs';
const placeholder=value=>!value||/^(?:company on linkedin|linkedin job|company|unknown(?: company)?|not available|n a)$/.test(value);
function equivalentTitle(value){return normalizeText(value).replace(/\bback[- ]end\b/g,'backend').replace(/\bfront[- ]end\b/g,'frontend').replace(/\bsoftware engineering\b/g,'software engineer').replace(/\binternship\b/g,'intern').replace(/\bsr\.?\b/g,'senior');}
export function jobFingerprint(job){
  const company=normalizeText(job.company),title=equivalentTitle(job.title),location=job.location?.key,hash=job.descriptionHash;
  if(placeholder(company)||placeholder(title)||!location||!(/^[a-f\d]{64}$/.test(hash||'')))return null;
  return createHash('sha256').update(JSON.stringify([company,title,normalizeText(location),job.location.workplace||null,hash])).digest('hex');
}
export function blockingDuplicate(job,history){
  const fingerprint=job.fingerprint||jobFingerprint(job);
  return history.find(record=>blocksRetry(record)&&(String(record.job.id)===String(job.id)||fingerprint&&(record.job.fingerprint||jobFingerprint(record.job))===fingerprint))||null;
}
export function compareCandidates(a,b){
  const scores=(b.assessment?.score??-Infinity)-(a.assessment?.score??-Infinity);if(scores)return scores;
  const left=Date.parse(a.postedAt),right=Date.parse(b.postedAt);
  if(Number.isFinite(left)!==Number.isFinite(right))return Number.isFinite(left)?-1:1;
  if(Number.isFinite(left)&&left!==right)return right-left;
  return (a.discoveryIndex??0)-(b.discoveryIndex??0);
}
