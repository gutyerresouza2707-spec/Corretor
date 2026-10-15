/* Regras de negócio e validação. Valores monetários são arredondados em centavos. */
const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const localDate = (d = new Date()) => [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const jsArgument = value => escapeHTML(JSON.stringify(String(value)));
const clientKey = p => p.clientId || (p.cpf?.replace(/\D/g,'') ? 'doc:' + p.cpf.replace(/\D/g,'') : 'policy:' + p.id);
function validDocument(value) {
  const s = value.replace(/\D/g,'');
  if (!s) return true;
  if (!/^(\d{11}|\d{14})$/.test(s) || /^(\d)\1+$/.test(s)) return false;
  if (s.length === 11) {
    for (let n=9;n<=10;n++) { let sum=0; for(let i=0;i<n;i++) sum+=Number(s[i])*(n+1-i); let d=(sum*10)%11; if(d===10)d=0; if(d!==Number(s[n]))return false; }
  } else {
    for(let n=12;n<=13;n++){let sum=0,w=n-7;for(let i=0;i<n;i++){sum+=Number(s[i])*w;w=w===2?9:w-1;}const d=sum%11<2?0:11-sum%11;if(d!==Number(s[n]))return false;}
  }
  return true;
}
function expectedReceiptDate(p) {
  const start = parseValidityStart(p);
  return p.expectedReceiptDate || (start ? localDate(firstBusinessDayOfNextMonth(start.getFullYear(),start.getMonth())) : '');
}
function receiptTotal(p) { return money((p.receipts || []).reduce((sum,r)=>sum+Number(r.amount),0)); }
function remainingCommission(p) { return Math.max(0,money(Number(p.brokerEarning||0)-receiptTotal(p))); }
function receiptsInPeriod(list, match) {
  return money(list.reduce((sum,p)=>sum+(p.receipts||[]).filter(r=>match(r.date)).reduce((a,r)=>a+Number(r.amount),0),0));
}
function registryForPolicy(p) {
  const doc = (p.cpf||'').replace(/\D/g,'');
  let c = clientRegistry.find(c=>c.id===p.clientId || (doc && c.document===doc));
  if(!c) { c={id:p.clientId || (doc ? 'doc:'+doc : 'policy:'+p.id),name:p.clientName,document:doc,contact:p.clientContact}; clientRegistry.push(c); }
  c.name=p.clientName; c.contact=p.clientContact; if(doc)c.document=doc;
  return c;
}
function migrateClientRegistry() {
  [...policies].sort((a,b)=>a.createdAt-b.createdAt).forEach(p=>{p.clientId=registryForPolicy(p).id;});
  if(accountId) {try {writeScoped('clients',clientRegistry);}catch {syncStatus('Cache de clientes indisponível. Exporte um backup.');}}
}

function validDate(value) { if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false; const d=new Date(value+'T12:00:00');return !isNaN(d.getTime())&&localDate(d)===value; }

// O status visual distingue quitação, pagamento parcial e recebimento antigo sem data.
function commissionState(p) {
  if (p.commissionStatus === 'Cancelado') return {key:'cancelled',label:'Cancelada'};
  if (Number(p.brokerEarning)>0 && remainingCommission(p)===0) return {key:'paid',label:'Recebida'};
  if (receiptTotal(p)>0) return {key:'partial',label:'Recebida parcialmente'};
  if (['Recebida','Recebido'].includes(p.commissionStatus)) return {key:'legacy',label:'Recebida · confirmar data'};
  return {key:'pending',label:'Não recebida'};
}
function canReceiveCommission(p) {
  return p.commissionStatus==='Pendente' && remainingCommission(p)>0;
}

/* Leitura local de nomes copiados de uma planilha, sem aproximações por primeiro nome. */
function normalizeCommissionName(value) {
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
}
function pastedCommissionCells(line) {
  const separator=line.includes('\t')?'\t':line.includes(';')?';':line.includes(',')?',':null;
  if(!separator)return [line.trim()];
  const cells=[];let cell='',quoted=false;
  for(let i=0;i<line.length;i++){
    const char=line[i];
    if(char==='"'){if(quoted && line[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(char===separator && !quoted){cells.push(cell.trim());cell='';}else cell+=char;
  }
  cells.push(cell.trim());return cells;
}
function matchPastedCommissions(text,list) {
  if(text.length>200000)throw Error('Cole até 200 mil caracteres por vez.');
  const lines=text.split(/\r?\n/).map((line,i)=>({line:line.trim(),number:i+1})).filter(r=>r.line);
  if(lines.length>2000)throw Error('Cole até 2.000 linhas por vez.');
  const index=new Map();
  for(const p of list){const name=normalizeCommissionName(p.clientName);if(!name)continue;if(!index.has(name))index.set(name,[]);index.get(name).push(p);}
  const seen=new Set();
  return lines.map(({line,number})=>{
    const cells=pastedCommissionCells(line);const names=cells.map(normalizeCommissionName);
    let candidates=[...new Map(names.flatMap(name=>index.get(name)||[]).map(p=>[p.id,p])).values()];
    const base={line,number,candidates:[]};
    if(!candidates.length){const header=names.some(n=>['nome','cliente','nome do cliente','segurado','nome do segurado'].includes(n));return {...base,status:header?'header':'unmatched'};}
    const plates=cells.map(c=>c.toUpperCase().replace(/[^A-Z0-9]/g,'')).filter(c=>/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(c));
    const docs=cells.map(c=>c.replace(/\D/g,'')).filter(c=>c.length===11||c.length===14);
    if(plates.length)candidates=candidates.filter(p=>plates.includes((p.vehiclePlate||'').toUpperCase().replace(/[^A-Z0-9]/g,'')));
    if(docs.length)candidates=candidates.filter(p=>docs.includes((p.cpf||'').replace(/\D/g,'')));
    if(!candidates.length)return {...base,status:'unmatched'};
    const pending=candidates.filter(canReceiveCommission);
    if(!pending.length){const status=candidates.some(p=>commissionState(p).key==='legacy')?'legacy':candidates.some(p=>commissionState(p).key==='paid')?'paid':'cancelled';return {...base,candidates,status};}
    if(pending.length!==1 || new Set(candidates.map(clientKey)).size>1)return {...base,candidates:pending,status:'ambiguous'};
    const p=pending[0];const duplicate=seen.has(p.id);seen.add(p.id);
    return {...base,candidates:[p],status:duplicate?'duplicate':'matched',policyId:p.id};
  });
}
