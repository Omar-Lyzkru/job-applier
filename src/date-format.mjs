export function dateFormatCompatible(field,value) {
  const answer=String(value).trim(),hint=`${field.label} ${field.placeholder||''}`;
  if(field.pattern){
    try{if(!new RegExp(`^(?:${field.pattern})$`,'v').test(answer))return false;}catch{return false;}
  }
  if(field.type==='date'){
    const parsed=/^(\d{4})-(\d{2})-(\d{2})$/.exec(answer);
    if(!parsed)return false;
    const date=new Date(`${answer}T00:00:00Z`);
    return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===answer;
  }
  const format=hint.match(/\b(yyyy|year|mm|month|dd|day)(\s*[/.-]\s*|\s+)(yyyy|year|mm|month|dd|day)(?:\2(yyyy|year|mm|month|dd|day))?\b/i);
  if(format){
    const units=[format[1],format[3],format[4]].filter(Boolean).map(unit=>unit.toLowerCase());
    const separator=format[2].trim(),parts=separator?answer.split(separator):answer.split(/\s+/);
    if(parts.length!==units.length)return false;
    const values={};
    for(let i=0;i<units.length;i++){
      const unit=units[i],part=parts[i].trim(),kind=/^(?:yyyy|year)$/.test(unit)?'year':/^(?:mm|month)$/.test(unit)?'month':'day';
      if(values[kind]!==undefined)return false;
      if(unit==='month'){
        const names=['january','february','march','april','may','june','july','august','september','october','november','december'];
        values.month=names.findIndex(name=>[name,name.slice(0,3)].includes(part.toLowerCase()))+1;
      }else{
        if(!(kind==='year'?/^\d{4}$/:/^\d{2}$/).test(part))return false;
        values[kind]=Number(part);
      }
    }
    if(values.year===undefined||values.month===undefined||values.month<1||values.month>12)return false;
    if(values.day!==undefined){
      if(values.day<1||values.day>31)return false;
      const iso=`${String(values.year).padStart(4,'0')}-${String(values.month).padStart(2,'0')}-${String(values.day).padStart(2,'0')}`;
      const date=new Date(`${iso}T00:00:00Z`);
      return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===iso;
    }
  }
  return true;
}
