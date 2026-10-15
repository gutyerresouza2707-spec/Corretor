/* Interface de recebimentos, tarefas, configurações e backup. */
function downloadFile(name,text,type) {
  const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function showDialog(id) {
  const el=document.getElementById(id);el._previousFocus=document.activeElement;el.style.display='flex';el.querySelector('input,select,button')?.focus();
}
function hideDialog(id) {
  const el=document.getElementById(id);el.style.display='none';el._previousFocus?.focus();
}
let receiptPolicyId=null;
function openReceiptDialog(id) {
  const p=policies.find(p=>p.id===id);if(!p)return;receiptPolicyId=id;document.getElementById('receipt-date').max=localDate();
  document.getElementById('receipt-client').textContent=p.clientName+' • '+p.vehiclePlate;
  document.getElementById('receipt-date').value=localDate();
  document.getElementById('receipt-amount').value=remainingCommission(p).toFixed(2);
  document.getElementById('receipt-history').replaceChildren();
  for(const r of p.receipts||[]) {const div=document.createElement('div');div.textContent=fmtDate(r.date)+' — '+fmt(r.amount);document.getElementById('receipt-history').append(div);}
  showDialog('receipt-dialog');
}
async function saveReceipt(event) {
  event.preventDefault();const p=policies.find(p=>p.id===receiptPolicyId);if(!p)return;
  const date=document.getElementById('receipt-date').value;const amount=money(document.getElementById('receipt-amount').value);
  if(!validDate(date) || date>localDate() || !Number.isFinite(amount) || amount<=0 || amount>remainingCommission(p)) {showNotif('Confira a data e o valor, limitado ao saldo da comissão.','error');return;}
  const receipts=[...(p.receipts||[]),{id:crypto.randomUUID(),date,amount}];
  const updated={...p,receipts,commissionStatus:money(receipts.reduce((s,r)=>s+r.amount,0))>=p.brokerEarning?'Recebida':'Pendente'};
  const owner=accountId;event.submitter.disabled=true;
  try{if(await commitOperation('policies','upsert',updated)&&accountId===owner)hideDialog('receipt-dialog');}finally{event.submitter.disabled=false;}
}
function refreshClientSelect() {
  const select=document.getElementById('f-clientId');if(!select)return;const selected=select.value;
  select.replaceChildren(new Option('Novo cliente', ''));
  [...clientRegistry].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')).forEach(c=>select.add(new Option(c.name+(c.document?' • '+c.document:' • sem documento'),c.id)));
  select.value=selected;
}
function selectRegisteredClient() {
  const c=clientRegistry.find(c=>c.id===document.getElementById('f-clientId').value);if(!c)return;
  document.getElementById('f-clientName').value=c.name;document.getElementById('f-cpf').value=c.document||'';document.getElementById('f-clientContact').value=c.contact||'';
}
function renderActionCenter() {
  const container=document.getElementById('action-center');if(!container)return;container.replaceChildren();
  const today=localDate();
  const renewals=policies.filter(p=>{const s=getStatus(p.validityEnd);return s.label==='A Vencer' && !['Renovado','Recusado'].includes(p.renewal?.stage);});
  const late=policies.filter(p=>p.commissionStatus==='Pendente' && expectedReceiptDate(p) && expectedReceiptDate(p)<today);
  const tasks=policies.filter(p=>p.renewal?.nextAction && p.renewal.nextAction<=today && !['Renovado','Recusado'].includes(p.renewal.stage));
  const legacy=policies.filter(p=>isPaid(p.commissionStatus)&&!(p.receipts||[]).length);
  const heading=document.createElement('h2');heading.textContent='Próximas ações';container.append(heading);
  const summary=document.createElement('p');summary.textContent=renewals.length+' renovações próximas • '+late.length+' comissões atrasadas • '+tasks.length+' retornos para hoje';container.append(summary);
  for(const p of [...new Map([...tasks,...late,...renewals].map(p=>[p.id,p])).values()].slice(0,8)) {
    const row=document.createElement('div');row.className='action-row';
    const label=document.createElement('span');label.textContent=p.clientName+' • '+p.vehiclePlate+(late.includes(p)?' • comissão atrasada '+fmt(remainingCommission(p)):' • '+(p.renewal?.stage||'A contatar'));
    const button=document.createElement('button');button.className='btn-ghost';button.textContent=late.includes(p)?'Recebimento':'Acompanhar';button.onclick=()=>late.includes(p)?openReceiptDialog(p.id):openRenewalDialog(p.id);
    row.append(label,button);container.append(row);
  }
  if(legacy.length){const warn=document.createElement('p');warn.className='migration-note';warn.textContent=legacy.length+' apólice(s) marcada(s) como recebida(s) na versão anterior sem data confirmada. Registre os recebimentos no painel abaixo; esses valores não entram no caixa até a confirmação.';container.append(warn);}
  renderOperationsPanel();
}
let renewalPolicyId=null;
function openRenewalDialog(id) {
  const p=policies.find(p=>p.id===id);if(!p)return;renewalPolicyId=id;
  document.getElementById('renewal-client').textContent=p.clientName+' • '+p.vehiclePlate;
  document.getElementById('renewal-stage').value=p.renewal?.stage||'A contatar';
  document.getElementById('renewal-next').value=p.renewal?.nextAction||'';
  document.getElementById('renewal-note').value='';
  const history=document.getElementById('renewal-history');history.replaceChildren();
  for(const h of p.renewal?.history||[]){const row=document.createElement('p');row.textContent=fmtDate(h.date)+' • '+h.stage+(h.note?' — '+h.note:'');history.append(row);}
  showDialog('renewal-dialog');
}
async function saveRenewal(event) {
  event.preventDefault();const p=policies.find(p=>p.id===renewalPolicyId);if(!p)return;
  const stage=document.getElementById('renewal-stage').value;const nextAction=document.getElementById('renewal-next').value;const note=document.getElementById('renewal-note').value.trim();
  const renewal={stage,nextAction:['Renovado','Recusado'].includes(stage)?'':nextAction,history:[...(p.renewal?.history||[]),{date:localDate(),stage,note}]};
  event.submitter.disabled=true;try{if(await commitOperation('policies','upsert',{...p,renewal}))hideDialog('renewal-dialog');}finally{event.submitter.disabled=false;}
}
function renderOperationsPanel() {
  const target=document.getElementById('operations-list');if(!target)return;
  target.replaceChildren();const search=(document.getElementById('operations-search').value||'').toLowerCase();
  const rows=policies.filter(p=>(p.clientName+' '+p.vehiclePlate).toLowerCase().includes(search)).sort((a,b)=>(a.validityEnd||'').localeCompare(b.validityEnd||''));
  for(const p of rows.slice(0,100)) {
    const row=document.createElement('div');row.className='action-row';
    const text=document.createElement('span');text.textContent=p.clientName+' • '+p.vehiclePlate+' • '+(p.renewal?.stage||'A contatar')+' • saldo '+fmt(remainingCommission(p))+' • previsto '+fmtDate(expectedReceiptDate(p));
    const actions=document.createElement('div');actions.className='toolbar';
    const receive=document.createElement('button');receive.className='btn-ghost';receive.textContent='Recebimentos';receive.onclick=()=>openReceiptDialog(p.id);
    const renew=document.createElement('button');renew.className='btn-ghost';renew.textContent='Renovação';renew.onclick=()=>openRenewalDialog(p.id);
    actions.append(receive,renew);row.append(text,actions);target.append(row);
  }
  if(rows.length>100){const p=document.createElement('p');p.textContent='Mostrando 100 resultados. Use a busca para localizar outra apólice.';target.append(p);}
}
function exportBackup() {
  if(!accountId)return;
  downloadFile('corretorpro_backup_'+localDate()+'.json',JSON.stringify({format:'CorretorPro',version:3,exportedAt:new Date().toISOString(),owner:accountId,policies,expenses,notes:localNotes,clients:clientRegistry,goals:readScoped(LS_GOALS,{qty:0,val:0}),preferences},null,2),'application/json');
}
function validateBackup(data) {
  if(data?.format!=='CorretorPro'||data.version!==3)throw Error('Formato de backup incompatível.');
  if(data.owner!==accountId)throw Error('O backup deve pertencer à conta conectada.');
  for(const key of ['policies','expenses','notes','clients'])if(!Array.isArray(data[key])||data[key].length>50000)throw Error('Lista inválida: '+key);
  const text=(v,max=1000)=>typeof v==='string'&&v.length<=max;
  const date=validDate;
  const number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
  for(const key of ['policies','expenses','notes','clients']){const ids=new Set();for(const r of data[key]){if(!r||!text(r.id,100)||!r.id||ids.has(r.id))throw Error('Identificador inválido ou repetido.');ids.add(r.id);}}
  for(const p of data.policies){if(!text(p.clientName)||!text(p.cpf)||!text(p.clientContact)||!text(p.insurer)||!text(p.vehicleModel)||!text(p.vehiclePlate)||!text(p.clientId,100)||!date(p.validityStart)||!date(p.validityEnd)||!number(p.brokerEarning)||!number(p.premiumAmount)||!number(p.commissionRate)||!number(p.commissionAmount)||!number(p.monthlyInstallment)||!number(p.createdAt)||!['Pendente','Recebida','Recebido','Cancelado'].includes(p.commissionStatus)||!Array.isArray(p.receipts)||p.receipts.some(r=>!text(r.id,100)||!date(r.date)||!number(r.amount)||r.amount===0)||receiptTotal(p)>p.brokerEarning)throw Error('Apólice inválida no backup.');if(p.expectedReceiptDate&&!date(p.expectedReceiptDate))throw Error('Data prevista inválida.');if(p.renewal?.history && (!Array.isArray(p.renewal.history)||p.renewal.history.some(h=>!date(h.date)||!text(h.stage)||!text(h.note,10000))))throw Error('Histórico inválido.');}
  for(const e of data.expenses)if(!text(e.description)||!text(e.category)||!date(e.date)||!number(e.amount)||!number(e.createdAt))throw Error('Despesa inválida.');
  for(const n of data.notes)if(!text(n.client_name)||!text(n.note,10000)||!number(n.created_at)||!number(n.updated_at)||(n.client_id&&!text(n.client_id,100)))throw Error('Observação inválida.');
  for(const c of data.clients)if(!text(c.name)||!text(c.document)||!text(c.contact))throw Error('Cliente inválido.');
  if(!number(data.goals?.qty)||!number(data.goals?.val)||!text(data.preferences?.brokerName)||!Array.isArray(data.preferences.commissionRules)||data.preferences.commissionRules.some(r=>!text(r.insurer)||!number(r.amount)))throw Error('Configurações inválidas.');
  return data;
}
async function importBackup(event) {
  const file=event.target.files[0];event.target.value='';if(!file)return;
  try{
    if(file.size>20*1024*1024)throw Error('O backup excede 20 MB.');
    const data=validateBackup(JSON.parse(await file.text()));const restoreOwner=accountId;
    openModal('Restaurar '+data.policies.length+' apólices e '+data.expenses.length+' despesas? Registros com o mesmo identificador serão atualizados; os demais serão mantidos.',async()=>{
      try{
        if(accountId!==restoreOwner)throw Error('A conta foi alterada. Selecione o backup novamente.');
        const ops=[...data.policies.map(record=>({table:'policies',record})),...data.expenses.map(record=>({table:'expenses',record})),...data.notes.map(record=>({table:'client_notes',record}))].map(o=>({...o,id:o.record.id,kind:'upsert',owner:accountId,opId:crypto.randomUUID()}));
        writeScoped('queue',[...pendingOps,...ops]);pendingOps.push(...ops);dataRevision++;ops.forEach(op=>applyOperation(op,{policies,expenses,notes:localNotes}));
        const clients=new Map([...clientRegistry,...data.clients].map(c=>[c.id,c]));clientRegistry=[...clients.values()];preferences=data.preferences;
        writeScoped('clients',clientRegistry);writeScoped('preferences',preferences);writeScoped(LS_GOALS,data.goals);saveLS(LS_KEY_POLICIES,policies);saveLS(LS_KEY_EXPENSES,expenses);writeScoped('notes',localNotes);render();syncStatus();showNotif('Backup restaurado neste dispositivo. Sincronização pendente.');await syncQueue();
      }catch(error){showNotif('Falha ao restaurar: '+error.message,'error');}
    });
  }catch(error){showNotif(error.message,'error');}
}
function openSettings() {
  document.getElementById('settings-broker').value=preferences.brokerName||'';
  document.getElementById('settings-rules').value=(preferences.commissionRules||[]).map(r=>r.insurer+';'+r.amount).join('\n');showDialog('settings-dialog');
}
function saveSettings(event) {
  event.preventDefault();const rules=document.getElementById('settings-rules').value.split('\n').filter(s=>s.trim()).map(s=>{const parts=s.split(';');return {insurer:parts[0].trim(),amount:Number((parts[1]||'').replace(',','.'))};});
  if(rules.some(r=>!r.insurer||!Number.isFinite(r.amount)||r.amount<0)){showNotif('Use Seguradora;valor em cada linha.','error');return;}
  const next={brokerName:document.getElementById('settings-broker').value.trim(),commissionRules:rules};
  try{writeScoped('preferences',next);preferences=next;hideDialog('settings-dialog');showNotif('Configurações salvas neste dispositivo. Incluídas no backup.');}catch{showNotif('Não foi possível salvar.','error');}
}
async function recoverPassword() {
  const email=document.getElementById('auth-email').value.trim();if(!email){showNotif('Preencha seu e-mail para recuperar a senha.','error');return;}
  if(!window._sb){showNotif('Conexão indisponível.','error');return;}
  if(location.protocol==='file:'){showNotif('Abra a versão hospedada para receber um link de recuperação válido.','error');return;}
  const {error}=await window._sb.client.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
  showNotif(error?'Não foi possível solicitar recuperação. Tente novamente.':'Se houver uma conta, você receberá o link por e-mail.',error?'error':'success');
}
async function updatePassword(event) {
  event.preventDefault();const value=document.getElementById('new-password').value;
  if(value.length<8){showNotif('Use pelo menos 8 caracteres.','error');return;}
  const {error}=await window._sb.client.auth.updateUser({password:value});
  if(error){showNotif('Não foi possível atualizar a senha.','error');return;}hideDialog('password-dialog');showNotif('Senha atualizada.');
}
function improveAccessibility() {
  document.querySelectorAll('input,select,textarea').forEach(el=>{
    const field=el.closest('.field');const label=field?.querySelector('label');if(label&&el.id)label.htmlFor=el.id;
    if(!el.labels?.length&&!el.hasAttribute('aria-label'))el.setAttribute('aria-label',el.placeholder||el.id||'Campo');
  });
  document.querySelectorAll('button').forEach(el=>{if(!el.textContent.trim()&&!el.hasAttribute('aria-label'))el.setAttribute('aria-label',el.title||'Abrir menu');});
  document.querySelectorAll('.modal-overlay,[id$="-overlay"]').forEach(el=>{if(el.id==='mobile-overlay'||el.id==='auth-overlay')return;el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label',el.querySelector('h2,.syne')?.textContent||'Detalhes');});
  document.getElementById('hamburger').setAttribute('aria-label','Abrir menu de navegação');
}
document.addEventListener('keydown',event=>{
  const dialog=[...document.querySelectorAll('[role="dialog"]')].find(el=>getComputedStyle(el).display!=='none');if(!dialog)return;
  if(event.key==='Escape'){if(dialog.id==='modal')closeModal();else if(dialog.id==='client-detail-overlay')closeClientDetail();else if(dialog.id==='refuse-ticket-overlay')closeRefuseTicket();else hideDialog(dialog.id);}
  if(event.key==='Tab'){
    const items=[...dialog.querySelectorAll('button,input,select,textarea,a[href]')].filter(el=>!el.disabled&&el.getClientRects().length);const first=items[0],last=items[items.length-1];
    if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first?.focus();}
  }
});
new MutationObserver(()=>improveAccessibility()).observe(document.getElementById('app-wrap'),{childList:true,subtree:true});
improveAccessibility();
document.getElementById('exp-date').value=localDate();

/* Seleção das comissões a receber no Financeiro, isolada por conta. */
let selectedCommissions=new Set();
let commissionSelectionOwner=null;
let bulkReceiptSnapshot=null;
let bulkReceiptSaving=false;
function clearCommissionSelection() {
  selectedCommissions.clear(); commissionSelectionOwner=accountId; bulkReceiptSnapshot=null;
  document.getElementById('paid-clients-paste').value='';
  document.getElementById('paste-review-results').replaceChildren();
  document.getElementById('paste-review-summary').textContent='';
}
function visibleReceivablePolicies() {
  const search=normalizeCommissionName(document.getElementById('finance-commission-search').value);
  return policies.filter(canReceiveCommission).filter(p=>!search || normalizeCommissionName(p.clientName+' '+(p.vehiclePlate||'')).includes(search));
}
function reconcileCommissionSelection() {
  if(commissionSelectionOwner!==accountId) clearCommissionSelection();
  const visible=new Set(visibleReceivablePolicies().map(p=>p.id));
  selectedCommissions=new Set([...selectedCommissions].filter(id=>visible.has(id)));
  updateCommissionSelection();
}
function toggleCommissionSelection(id,checked) {
  if(commissionSelectionOwner!==accountId) clearCommissionSelection();
  if(checked && visibleReceivablePolicies().some(p=>p.id===id)) selectedCommissions.add(id);
  else selectedCommissions.delete(id);
  updateCommissionSelection();
}
function selectAllCommissions(checked) {
  selectedCommissions=new Set(checked?visibleReceivablePolicies().map(p=>p.id):[]);
  commissionSelectionOwner=accountId; renderFinanceCommissions();
}
function updateCommissionSelection() {
  const rows=visibleReceivablePolicies().filter(p=>selectedCommissions.has(p.id));
  const total=money(rows.reduce((s,p)=>s+remainingCommission(p),0));
  document.getElementById('commission-selection-summary').textContent=rows.length
    ? rows.length+' selecionada(s) · '+fmt(total)
    : 'Selecione as comissões que você recebeu';
  document.getElementById('receive-selected-btn').disabled=!rows.length || bulkReceiptSaving;
  const selectButton=document.getElementById('select-all-receivable-btn');
  if(selectButton)selectButton.disabled=!visibleReceivablePolicies().length || bulkReceiptSaving;
  const clearButton=document.getElementById('clear-commission-selection-btn');
  if(clearButton)clearButton.disabled=!rows.length || bulkReceiptSaving;
  const all=document.getElementById('select-all-commissions');
  all.checked=rows.length>0 && rows.length===visibleReceivablePolicies().length;
  all.indeterminate=rows.length>0 && !all.checked;
  all.disabled=!visibleReceivablePolicies().length || bulkReceiptSaving;
  document.querySelectorAll('.finance-policy-checkbox').forEach(input=>{input.checked=selectedCommissions.has(input.dataset.policyId);input.disabled=bulkReceiptSaving;});
}
function openBulkReceiptDialog() {
  reconcileCommissionSelection();
  const rows=visibleReceivablePolicies().filter(p=>selectedCommissions.has(p.id));
  if(!accountId || !rows.length || bulkReceiptSaving)return;
  bulkReceiptSnapshot={owner:accountId,rows:rows.map(p=>({id:p.id,amount:remainingCommission(p),receipts:JSON.stringify(p.receipts||[])}))};
  document.getElementById('bulk-receipt-summary').textContent='Confirmar '+rows.length+' comissão(ões), no total de '+fmt(money(rows.reduce((s,p)=>s+remainingCommission(p),0)))+'?';
  const list=document.getElementById('bulk-receipt-list'); list.replaceChildren();
  for(const p of rows){const row=document.createElement('p');row.textContent=p.clientName+' · '+(p.vehiclePlate||'Sem placa')+' — '+fmt(remainingCommission(p));list.append(row);}
  const date=document.getElementById('bulk-receipt-date'); date.max=localDate(); date.value=localDate();
  showDialog('bulk-receipt-dialog');
}
async function saveBulkReceipts(event) {
  event.preventDefault();
  if(bulkReceiptSaving)return;
  const snapshot=bulkReceiptSnapshot;
  const date=document.getElementById('bulk-receipt-date').value;
  if(!snapshot || snapshot.owner!==accountId || !snapshot.rows.length){showNotif('Selecione novamente as comissões desta conta.','error');return;}
  if(!validDate(date) || date>localDate()){showNotif('Informe a data efetiva, até hoje.','error');return;}
  const records=[];
  for(const item of snapshot.rows){
    const p=policies.find(p=>p.id===item.id);
    if(!p || !canReceiveCommission(p) || remainingCommission(p)!==item.amount || JSON.stringify(p.receipts||[])!==item.receipts){
      bulkReceiptSnapshot=null;hideDialog('bulk-receipt-dialog');renderFinanceCommissions();showNotif('Uma comissão mudou. Confira a seleção e abra o recebimento novamente.','error');return;
    }
    records.push({...p,commissionStatus:'Recebida',receipts:[...(p.receipts||[]),{id:crypto.randomUUID(),date,amount:item.amount}]});
  }
  bulkReceiptSaving=true; event.submitter.disabled=true;
  try {
    if(await commitPolicyBatch(records) && accountId===snapshot.owner){
      clearCommissionSelection(); hideDialog('bulk-receipt-dialog'); render(); renderFinanceCommissions();
      showNotif(records.length+' comissão(ões) registrada(s) neste dispositivo.'+(pendingOps.length?' Sincronização pendente.':''));
    }
  } finally {bulkReceiptSaving=false;event.submitter.disabled=false;updateCommissionSelection();}
}

function renderFinanceCommissions() {
  reconcileCommissionSelection();
  const rows=visibleReceivablePolicies().sort((a,b)=>(expectedReceiptDate(a)||'').localeCompare(expectedReceiptDate(b)||''));
  document.getElementById('pending-badge').textContent=rows.length;
  document.getElementById('pending-list').innerHTML=rows.length?rows.map(p=>
    '<div class="pending-item finance-pending-item"><label class="finance-policy-label"><input type="checkbox" class="commission-checkbox finance-policy-checkbox" data-policy-id="'+escapeHTML(p.id)+'" aria-label="Selecionar comissão de '+escapeHTML(p.clientName)+'" '+(selectedCommissions.has(p.id)?'checked':'')+' '+(bulkReceiptSaving?'disabled':'')+' onchange="toggleCommissionSelection('+jsArgument(p.id)+',this.checked)"/><span><strong>'+escapeHTML(p.clientName)+'</strong><small>'+escapeHTML(p.vehiclePlate||'Sem placa')+' · '+escapeHTML(p.insurer||'')+'</small><small>Previsto: '+fmtDate(expectedReceiptDate(p))+'</small></span></label><div class="finance-pending-value"><strong>'+fmt(remainingCommission(p))+'</strong><span class="commission-status commission-'+commissionState(p).key+'">'+commissionState(p).label+'</span><button class="mark-paid-btn" onclick="openReceiptDialog('+jsArgument(p.id)+')">Registrar recebimento</button></div></div>'
  ).join(''):'<div class="empty-state"><span>Nenhuma comissão a receber nestes resultados.</span></div>';
}
function invalidatePastedCommissions() {
  bulkReceiptSnapshot=null;selectedCommissions.clear();
  document.getElementById('paste-review-summary').textContent='';
  document.getElementById('paste-review-results').replaceChildren();
  renderFinanceCommissions();
}
function clearPastedCommissions() {
  document.getElementById('paid-clients-paste').value='';invalidatePastedCommissions();
}
function analyzePastedCommissions() {
  if(!accountId){showNotif('Entre na sua conta para conferir os nomes.','error');return;}
  const text=document.getElementById('paid-clients-paste').value;
  if(!text.trim()){showNotif('Cole os nomes dos clientes que pagaram.','error');return;}
  let results;
  try{results=matchPastedCommissions(text,policies);}catch(error){showNotif(error.message,'error');return;}
  document.getElementById('finance-commission-search').value='';
  selectedCommissions=new Set(results.filter(r=>r.status==='matched').map(r=>r.policyId));
  commissionSelectionOwner=accountId;bulkReceiptSnapshot=null;
  renderFinanceCommissions();
  const matches=results.filter(r=>r.status==='matched').length;
  const needsReview=results.filter(r=>['ambiguous','unmatched','legacy'].includes(r.status)).length;
  document.getElementById('paste-review-summary').textContent=matches+' comissão(ões) selecionada(s) automaticamente · '+needsReview+' linha(s) para conferir. Nenhum recebimento foi gravado.';
  const target=document.getElementById('paste-review-results');target.replaceChildren();
  const labels={matched:'Encontrada e selecionada',duplicate:'Repetida · selecionada uma única vez',ambiguous:'Mais de uma correspondência · escolha abaixo',unmatched:'Não encontrado · confira o nome completo ou a placa',paid:'Comissão já recebida · não será repetida',legacy:'Recebida na versão antiga · confirme a data em Recebimentos e acompanhamento de renovações',cancelled:'Sem comissão pendente · cancelada',header:'Cabeçalho ignorado'};
  for(const result of results){
    const row=document.createElement('div');row.className='paste-review-row';
    const line=document.createElement('strong');line.textContent='Linha '+result.number+': '+result.line;
    const status=document.createElement('p');status.textContent=labels[result.status];status.className='paste-status-'+result.status;
    row.append(line,status);
    for(const p of result.candidates.filter(canReceiveCommission)){
      const label=document.createElement('label');label.className='paste-candidate';
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.className='commission-checkbox finance-policy-checkbox';checkbox.dataset.policyId=p.id;checkbox.checked=selectedCommissions.has(p.id);checkbox.onchange=()=>toggleCommissionSelection(p.id,checkbox.checked);
      const info=document.createElement('span');info.textContent=p.clientName+' · '+(p.vehiclePlate||'Sem placa')+' · '+(p.insurer||'Sem seguradora')+(p.cpf?' · documento '+p.cpf:'')+' · início '+fmtDate(p.validityStart)+' · saldo '+fmt(remainingCommission(p));
      label.append(checkbox,info);row.append(label);
    }
    target.append(row);
  }
}
