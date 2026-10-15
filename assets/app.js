
/* ═══════════════════════════════════════════════════════════════
   STORAGE — LocalStorage como fallback (funciona sem Supabase)
═══════════════════════════════════════════════════════════════ */
const LS_KEY_POLICIES  = 'cp_policies';
const LS_KEY_EXPENSES  = 'cp_expenses';

function loadLS(key) { return readScoped(key === LS_KEY_POLICIES ? 'policies' : 'expenses', []); }
function saveLS(key,data) { writeScoped(key === LS_KEY_POLICIES ? 'policies' : 'expenses',data); }

/* ═══════════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════════ */
let policies    = [];
let expenses    = [];
let editingId   = null;
let activeTab   = 'dashboard';
let statusFilter= 'Todos';
let modalCb     = null;

/* ═══════════════════════════════════════════════════════════════
   SUPABASE SYNC (opcional — só ativa se configurado)
═══════════════════════════════════════════════════════════════ */

// Converte uma linha do banco (snake_case) para o formato usado no app (camelCase)
function policyFromDB(p) {
  return {
    clientId:p.client_id, receipts:Array.isArray(p.receipts)?p.receipts:[], expectedReceiptDate:p.expected_receipt_date, renewal:p.renewal || {},
    id: p.id, clientName: p.client_name || '', cpf: p.cpf || '', clientContact: p.client_contact || '',
    insurer: p.insurer || '', vehicleModel: p.vehicle_model || '', vehiclePlate: p.vehicle_plate || '',
    validityStart: p.validity_start, validityEnd: p.validity_end, referrer: p.referrer || '',
    premiumAmount: Number(p.premium_amount)||0, commissionRate: Number(p.commission_rate)||0, commissionAmount: Number(p.commission_amount)||0,
    brokerEarning: Number(p.broker_earning)||0, monthlyInstallment: Number(p.monthly_installment)||0,
    paymentMethod: p.payment_method || '', commissionStatus: p.commission_status || 'Pendente', createdAt: Number(p.created_at)||0,
  };
}
// Converte uma policy do app (camelCase) para o formato do banco (snake_case)
function policyToDB(p) {
  return {
    client_id:p.clientId, receipts:p.receipts || [], expected_receipt_date:p.expectedReceiptDate || null, renewal:p.renewal || {},
    client_name: p.clientName, cpf: p.cpf, client_contact: p.clientContact,
    insurer: p.insurer, vehicle_model: p.vehicleModel, vehicle_plate: p.vehiclePlate,
    validity_start: p.validityStart || null, validity_end: p.validityEnd || null, referrer: p.referrer,
    premium_amount: p.premiumAmount, commission_rate: p.commissionRate, commission_amount: p.commissionAmount,
    broker_earning: p.brokerEarning, monthly_installment: p.monthlyInstallment,
    payment_method: p.paymentMethod, commission_status: p.commissionStatus,
  };
}
function expenseFromDB(e) {return {id:e.id,description:e.description||'',category:e.category||'',amount:Number(e.amount)||0,date:e.date,createdAt:Number(e.created_at)||0};}

let _realtimeSubscribed = false;





function subscribeRealtime() {
  if (_realtimeSubscribed) return;
  _realtimeSubscribed = true;
  const sb = window._sb.client;
  // Mantém os dados sincronizados em tempo real entre abas/dispositivos
  sb.channel('policies-changes')
    .on('postgres_changes', { event:'*', schema:'public', table:'policies' }, () => loadFromSupabase())
    .subscribe();
  sb.channel('notes-changes').on('postgres_changes',{event:'*',schema:'public',table:'client_notes'},()=>loadFromSupabase()).subscribe();
  sb.channel('expenses-changes')
    .on('postgres_changes', { event:'*', schema:'public', table:'expenses' }, () => loadFromSupabase())
    .subscribe();
}
function unsubscribeRealtime() {
  if (!_realtimeSubscribed) return;
  _realtimeSubscribed = false;
  window._sb.client.removeAllChannels();
}

/* ═══════════════════════════════════════════════════════════════
   FLUXO DE TELA — AUTENTICAÇÃO x APP
═══════════════════════════════════════════════════════════════ */
function showAuthScreen() {
  document.getElementById('auth-overlay').style.display = 'flex';
  document.getElementById('app-wrap').style.display = 'none';
}
function showApp() {
  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('app-wrap').style.display = 'flex';
}

function handleAuthState() {
  const id = window._sbUser?.id;
  if (!id) { unsubscribeRealtime(); clearCommissionSelection(); accountId=null; policies=[]; expenses=[]; localNotes=[]; clientRegistry=[]; pendingOps=[]; preferences={commissionRules:[],brokerName:'Gutierre Seguros'}; editingId=null; clearForm(); _clientNotes=[]; closeClientDetail(); document.querySelectorAll('[role="dialog"]').forEach(el=>el.style.display='none'); document.getElementById('action-center').replaceChildren(); document.getElementById('operations-list').replaceChildren(); showAuthScreen(); return; }
  if (id !== accountId) { unsubscribeRealtime(); hydrateAccount(id); }
  showApp(); updateUserCard(); render(); loadFromSupabase();
}

function updateUserCard() {
  const card = document.getElementById('user-card-name');
  const emailEl = document.getElementById('user-card-email');
  if (!card || !window._sbUser) return;
  const name = window._sbUser.user_metadata?.name || window._sbUser.email?.split('@')[0] || 'Corretor';
  card.textContent = name;
  if (emailEl) emailEl.textContent = window._sbUser.email || '';
}

window.addEventListener('sb-ready', handleAuthState);
window.addEventListener('sb-auth-change', handleAuthState);

window.addEventListener('load', () => {
  // Se o módulo Supabase não estiver presente por algum motivo, libera o app direto.
  if (!window._sb) { showAuthScreen(); document.getElementById('auth-sub').textContent='Conexão indisponível. Reconecte para entrar com segurança.'; }
});

/* ═══════════════════════════════════════════════════════════════
   AUTENTICAÇÃO — LOGIN / CADASTRO / LOGOUT
═══════════════════════════════════════════════════════════════ */
let authMode = 'login'; // 'login' ou 'signup'

function toggleAuthMode(e) {
  if (e) e.preventDefault();
  authMode = authMode === 'login' ? 'signup' : 'login';
  document.getElementById('auth-title').textContent = authMode === 'login' ? 'Entrar' : 'Criar conta';
  document.getElementById('auth-sub').textContent = authMode === 'login' ? 'Acesse sua conta para continuar' : 'Cadastre-se para começar a usar';
  document.getElementById('auth-name-group').style.display = authMode === 'signup' ? 'block' : 'none';
  document.getElementById('auth-submit-label').textContent = authMode === 'login' ? 'Entrar' : 'Criar conta';
  document.getElementById('auth-toggle-text').textContent = authMode === 'login' ? 'Não tem conta?' : 'Já tem conta?';
  document.getElementById('auth-toggle-link').textContent = authMode === 'login' ? 'Criar conta' : 'Entrar';
  document.getElementById('auth-error').style.display = 'none';
}

async function handleAuth(e) {
  e.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const name = document.getElementById('auth-name').value.trim();
  const errEl = document.getElementById('auth-error');
  const btn = document.getElementById('auth-submit-btn');
  errEl.style.display = 'none';
  btn.disabled = true;

  if (!window._sb) {
    errEl.textContent = 'Conexão com o servidor não disponível. Tente novamente em alguns instantes.';
    errEl.style.display = 'block';
    btn.disabled = false;
    return;
  }

  const sb = window._sb.client;
  try {
    if (authMode === 'signup') {
      const { data, error } = await sb.auth.signUp({
        email, password, options: { data: { name: name || email.split('@')[0] } }
      });
      if (error) throw error;
      if (data.user && !data.session) {
        errEl.style.color = 'var(--green)';
        errEl.textContent = 'Conta criada! Verifique seu e-mail para confirmar antes de entrar.';
        errEl.style.display = 'block';
        btn.disabled = false;
        return;
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) {
    errEl.style.color = 'var(--red)';
    errEl.textContent = traduzErroAuth(err.message);
    errEl.style.display = 'block';
    btn.disabled = false;
  } finally { btn.disabled=false; }
}

function traduzErroAuth(msg) {
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/User already registered/i.test(msg)) return 'Já existe uma conta com esse e-mail. Tente entrar.';
  if (/Password should be at least/i.test(msg)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/Unable to validate email/i.test(msg)) return 'E-mail inválido.';
  return msg;
}

async function logout() {
  openModal('Você será desconectado do sistema. Deseja continuar?', async () => {
    if (window._sb) await window._sb.client.auth.signOut();
  });
}

/* ═══════════════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════════════ */
const fmt = v => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v||0);
const fmtDate = d => { if(!/^\d{4}-\d{2}-\d{2}$/.test(d||'')) return '—'; const [y,m,day]=d.split('-'); return day+'/'+m+'/'+y; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

// Reconhece "Recebida" ou "Recebido" (a planilha original tinha gênero misto)
function isPaid(status) {
  return status==='Recebida' || status==='Recebido';
}

function getStatus(endDate) {
  if (!endDate) return { label:'Sem data', cls:'pill-red', icon:'⚠', daysLeft:null };
  const today = new Date(); today.setHours(0,0,0,0);
  const end   = new Date(endDate);
  const diff  = Math.ceil((end - today) / 86400000);
  if (diff < 0)   return { label:'Vencido',  cls:'pill-red',    daysLeft:diff };
  if (diff <= 30) return { label:'A Vencer', cls:'pill-orange', daysLeft:diff };
  return              { label:'Ativo',     cls:'pill-green',  daysLeft:diff };
}

function pillHTML(status) {
  const icons = {
    'Vencido':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>',
    'A Vencer': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    'Ativo':    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  };
  return `<span class="pill ${status.cls}">${icons[status.label]||''} ${status.label}</span>`;
}

/* ═══════════════════════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════════════════════ */
function navigate(tab) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const page = document.getElementById('page-'+tab);
  if (page) { page.classList.add('active'); page.style.animation='none'; page.offsetHeight; page.style.animation=''; }
  const btn = document.querySelector(`[data-tab="${tab}"]`);
  if (btn) btn.classList.add('active');
  activeTab = tab;
  // Close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('mobile-overlay').classList.remove('show');
  render();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('mobile-overlay').classList.toggle('show');
  document.getElementById('hamburger').setAttribute('aria-expanded',String(document.getElementById('sidebar').classList.contains('open')));
}

/* ═══════════════════════════════════════════════════════════════
   NOTIFICATION
═══════════════════════════════════════════════════════════════ */
let notifTimer;
function showNotif(msg,type='success') {
  const el=document.getElementById('notif');el.textContent=msg;el.setAttribute('role',type==='error'?'alert':'status');el.style.display='flex';
  clearTimeout(window._noticeTimeout);window._noticeTimeout=setTimeout(()=>el.style.display='none',6000);
}

/* ═══════════════════════════════════════════════════════════════
   MODAL
═══════════════════════════════════════════════════════════════ */
function openModal(msg,cb) {
  modalCb=cb;document.getElementById('modal-msg').textContent=msg;const btn=document.getElementById('modal-confirm-btn');btn.textContent='Confirmar';btn.disabled=false;
  btn.onclick=async()=>{btn.disabled=true;try{await cb();closeModal();}catch(error){showNotif('Não foi possível concluir: '+error.message,'error');}finally{btn.disabled=false;}};
  showDialog('modal');
}
function closeModal() { hideDialog('modal'); modalCb=null; }

/* ── Comissão fixa por seguradora (preenche "Seu Ganho" automaticamente) ── */


function autoEndDate() {
  const value=document.getElementById('f-validityStart').value;if(!validDate(value))return;
  const [year,month,day]=value.split('-').map(Number);
  const lastDay=new Date(year+1,month,0).getDate();
  document.getElementById('f-validityEnd').value=localDate(new Date(year+1,month-1,Math.min(day,lastDay)));
  document.getElementById('f-expectedReceiptDate').value=localDate(firstBusinessDayOfNextMonth(year,month-1));
}
function applyFixedCommission() {
  const raw=document.getElementById('f-insurer').value.trim().toLowerCase();
  const found=(preferences.commissionRules||[]).find(r=>r.insurer.trim().toLowerCase()===raw);
  if(found)document.getElementById('f-brokerEarning').value=money(found.amount).toFixed(2);else calcCommission();
}

function calcCommission() {
  const insurer=document.getElementById('f-insurer').value.trim().toLowerCase();
  const fixed=(preferences.commissionRules||[]).find(r=>r.insurer.trim().toLowerCase()===insurer);
  if(fixed){document.getElementById('f-brokerEarning').value=money(fixed.amount).toFixed(2);document.getElementById('commission-hint').style.display='none';return;}
  const premium = parseFloat(document.getElementById('f-premiumAmount').value) || 0;
  const rate    = parseFloat(document.getElementById('f-commissionRate').value) || 0;
  const hint    = document.getElementById('commission-hint');
  if (premium > 0 && rate > 0) {
    const val = (premium * rate) / 100;
    document.getElementById('f-brokerEarning').value = val.toFixed(2);
    document.getElementById('commission-hint-val').textContent = fmt(val);
    hint.style.display = 'flex';
  } else {
    hint.style.display = 'none';
  }
}

function clearForm() {
  const clientSelect=document.getElementById('f-clientId');if(clientSelect)clientSelect.value='';const expected=document.getElementById('f-expectedReceiptDate');if(expected)expected.value='';
  ['clientName','cpf','clientContact','insurer','vehicleModel','vehiclePlate',
   'validityStart','validityEnd','referrer','premiumAmount','commissionRate',
   'brokerEarning','monthlyInstallment'].forEach(f => document.getElementById('f-'+f).value='');
  document.getElementById('f-paymentMethod').value='';
  document.getElementById('f-commissionStatus').value='Pendente';
  document.getElementById('commission-hint').style.display='none';
}

function populateForm(p) {
  refreshClientSelect(); document.getElementById('f-clientId').value=p.clientId||''; document.getElementById('f-expectedReceiptDate').value=expectedReceiptDate(p);
  const fields = ['clientName','cpf','clientContact','insurer','vehicleModel','vehiclePlate',
    'validityStart','validityEnd','referrer','premiumAmount','commissionRate',
    'brokerEarning','monthlyInstallment','paymentMethod','commissionStatus'];
  fields.forEach(f => { const el = document.getElementById('f-'+f); if(el) el.value = p[f]||''; });
}

function setEditMode(isEdit) {
  const set = (id, prop, value) => { const el = document.getElementById(id); if (el) el[prop] = value; };
  set('form-title', 'textContent', isEdit ? 'Editar Seguro' : 'Novo Seguro');
  set('form-sub',   'textContent', isEdit ? 'Atualize os dados do seguro' : 'Preencha os dados para cadastrar');
  const btnCancelEdit = document.getElementById('btn-cancel-edit');
  if (btnCancelEdit) btnCancelEdit.style.display = isEdit ? 'flex' : 'none';
  const btnCancel2 = document.getElementById('btn-cancel2');
  if (btnCancel2) btnCancel2.style.display = isEdit ? 'flex' : 'none';
  set('btn-submit-label', 'textContent', isEdit ? 'Guardar Alterações' : 'Cadastrar Seguro');
  const navNewSpan = document.querySelector('#nav-new span');
  if (navNewSpan) navNewSpan.textContent = isEdit ? 'Editar Seguro' : 'Novo Seguro';
}

function cancelEdit() { editingId=null; clearForm(); setEditMode(false); navigate('list'); }

/* ═══════════════════════════════════════════════════════════════
   CRUD — POLICIES
═══════════════════════════════════════════════════════════════ */
async function handleSubmit(e) {
  e.preventDefault();
  const get = id => document.getElementById('f-'+id).value;
  const premium = parseFloat(get('premiumAmount'))||0;
  const rate    = parseFloat(get('commissionRate'))||0;
  const p = {
    clientName: get('clientName'), cpf: get('cpf'), clientContact: get('clientContact'),
    insurer: get('insurer'), vehicleModel: get('vehicleModel'), vehiclePlate: get('vehiclePlate').toUpperCase(),
    validityStart: get('validityStart'), validityEnd: get('validityEnd'), referrer: get('referrer'),
    premiumAmount: premium, commissionRate: rate,
    commissionAmount: (premium*rate)/100,
    brokerEarning: parseFloat(get('brokerEarning'))||0,
    monthlyInstallment: parseFloat(get('monthlyInstallment'))||0,
    paymentMethod: get('paymentMethod'), commissionStatus: get('commissionStatus'),
  };


  const old = policies.find(row=>row.id===editingId);
  p.id = old?.id || crypto.randomUUID(); p.createdAt = old?.createdAt || Date.now();
  p.clientName=p.clientName.trim(); p.cpf=p.cpf.replace(/\D/g,''); p.clientContact=p.clientContact.replace(/\D/g,'');
  p.vehiclePlate=p.vehiclePlate.replace(/[^A-Z0-9]/g,''); p.insurer=p.insurer.trim();
  if (!p.clientName || !validDocument(p.cpf)) {showNotif('Confira o nome e o CPF/CNPJ informado.','error');return;}
  if (!/^(?:55)?\d{10,11}$/.test(p.clientContact)) {showNotif('Informe um telefone com DDD válido.','error');return;}
  if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(p.vehiclePlate)) {showNotif('Informe uma placa válida, antiga ou Mercosul.','error');return;}
  if (!validDate(p.validityStart) || !validDate(p.validityEnd) || p.validityEnd <= p.validityStart) {showNotif('O fim da vigência deve ser posterior ao início.','error');return;}
  if (![premium,rate,p.brokerEarning,p.monthlyInstallment].every(v=>Number.isFinite(v)&&v>=0) || premium===0 || rate>100) {showNotif('Confira os valores e a comissão entre 0 e 100%.','error');return;}
  const duplicate=policies.find(row=>row.id!==p.id && row.vehiclePlate.replace(/[^A-Z0-9]/g,'')===p.vehiclePlate && row.validityStart===p.validityStart);
  if(duplicate){showNotif('Já existe uma apólice para essa placa e início de vigência.','error');return;}
  p.brokerEarning=money(p.brokerEarning);p.commissionAmount=money(p.commissionAmount);p.premiumAmount=money(p.premiumAmount);p.monthlyInstallment=money(p.monthlyInstallment);
  const selected=document.getElementById('f-clientId')?.value;
  const registered=selected ? clientRegistry.find(c=>c.id===selected) : null;
  if(registered && registered.document && p.cpf !== registered.document){showNotif('O documento deve corresponder ao cliente selecionado.','error');return;}
  p.clientId=registered?.id || old?.clientId || (p.cpf ? 'doc:'+p.cpf : crypto.randomUUID());
  p.receipts=old?.receipts || []; p.renewal=old?.renewal || {};
  p.expectedReceiptDate=document.getElementById('f-expectedReceiptDate').value || expectedReceiptDate(p);
  if(p.expectedReceiptDate&&!validDate(p.expectedReceiptDate)){showNotif('Confira a data prevista.','error');return;}
  if(isPaid(p.commissionStatus) && receiptTotal(p)<p.brokerEarning) {
    showNotif('Registre o recebimento em Financeiro. O cadastro permanece pendente.','error'); p.commissionStatus='Pendente';
  }
  if(p.receipts.length && p.brokerEarning<receiptTotal(p)){showNotif('O ganho não pode ser menor que os recebimentos já registrados.','error');return;}
  const submitOwner=accountId; const btn=e.submitter; if(btn)btn.disabled=true;
  try { if(await commitOperation('policies','upsert',p) && accountId===submitOwner) {registryForPolicy(p);writeScoped('clients',clientRegistry);editingId=null;clearForm();setEditMode(false);navigate('list');} }
  finally {if(btn)btn.disabled=false;}
}

function editPolicy(id) {
  const p = policies.find(x=>x.id===id);
  if (!p) return;
  editingId = id;
  populateForm(p);
  setEditMode(true);
  navigate('new');
}

function deletePolicy(id) {
  openModal('Excluir esta apólice? Exporte um backup antes se precisar recuperar o registro.',()=>commitOperation('policies','delete',{id}));
}

/* ── AUTO-RECEBIMENTO DE COMISSÕES ──────────────────────────────
   Toda comissão "Pendente" é marcada automaticamente como
   "Recebida" quando chega o 1º dia útil do mês seguinte à
   vigência da apólice (pagamento das seguradoras).            */
function firstBusinessDayOfNextMonth(year, month) {
  let d = new Date(year, month + 1, 1);
  while (d.getDay() === 0 || d.getDay() === 6 || isHoliday(d)) d.setDate(d.getDate() + 1);
  d.setHours(0,0,0,0);
  return d;
}

function autoReceiveCommissions() { return false; }

async function markAsPaid(id) { openReceiptDialog(id); }

/* ═══════════════════════════════════════════════════════════════
   CRUD — EXPENSES
═══════════════════════════════════════════════════════════════ */
async function addExpense(e) {
  e.preventDefault();
  const description=document.getElementById('exp-desc').value.trim();
  const amount=money(document.getElementById('exp-amount').value);
  const date=document.getElementById('exp-date').value;
  if(!description || !Number.isFinite(amount) || amount<=0 || !date){showNotif('Informe descrição, data e valor positivo.','error');return;}
  const btn=e.submitter;if(btn)btn.disabled=true;
  try {if(await commitOperation('expenses','upsert',{id:crypto.randomUUID(),description,category:document.getElementById('exp-category').value,amount,date,createdAt:Date.now()})){document.getElementById('exp-desc').value='';document.getElementById('exp-amount').value='';}}
  finally {if(btn)btn.disabled=false;}
}

function deleteExpense(id) {openModal('Excluir esta despesa?',()=>commitOperation('expenses','delete',{id}));}

/* ═══════════════════════════════════════════════════════════════
   EXPORT CSV
═══════════════════════════════════════════════════════════════ */
function exportCSV() {
  const headers=['Cliente','CPF/CNPJ','Contato','Seguradora','Veículo','Placa','Início','Fim','Prêmio','% Comissão','Ganho','Parcela','Pagamento','Status'];
  const rows=getFiltered().map(p=>[p.clientName,p.cpf,p.clientContact,p.insurer,p.vehicleModel,p.vehiclePlate,p.validityStart,p.validityEnd,p.premiumAmount,p.commissionRate,p.brokerEarning,p.monthlyInstallment,p.paymentMethod,p.commissionStatus]);
  const cell=value=>{let s=String(value??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  downloadFile('apolices_'+localDate()+'.csv','\uFEFF'+[headers,...rows].map(r=>r.map(cell).join(';')).join('\r\n'),'text/csv;charset=utf-8');
}

/* ═══════════════════════════════════════════════════════════════
   FILTER / SEARCH
═══════════════════════════════════════════════════════════════ */
function getFiltered() {
  const q = (document.getElementById('search-input')?.value||'').toLowerCase();
  return policies.filter(p => {
    const matchQ = !q ||
      (p.clientName||'').toLowerCase().includes(q) ||
      (p.cpf||'').includes(q) ||
      (p.vehiclePlate||'').toLowerCase().includes(q) ||
      (p.insurer||'').toLowerCase().includes(q);
    const matchF = statusFilter==='Todos' || getStatus(p.validityEnd).label===statusFilter;
    return matchQ && matchF;
  });
}

function setFilter(f) {
  statusFilter = f;
  document.querySelectorAll('.filter-chip').forEach(el => {
    const map = { Todos:'f-all', Ativo:'f-green', 'A Vencer':'f-orange', Vencido:'f-red' };
    el.className = 'filter-chip' + (el.dataset.filter===f ? ' '+map[f] : '');
  });
  renderList();
}

function clearSearch() {
  document.getElementById('search-input').value='';
  document.getElementById('search-clear').style.display='none';
  renderList();
}

/* ═══════════════════════════════════════════════════════════════
   RENDER
═══════════════════════════════════════════════════════════════ */
function render() {
  migrateClientRegistry();
  renderActionCenter();
  refreshClientSelect();
  renderBadge();
  if (activeTab==='dashboard') renderDashboard();
  if (activeTab==='list')      renderList();
  if (activeTab==='clients')   renderClients();
  if (activeTab==='cashflow')  renderCashflow();
}

function renderBadge() {
  document.getElementById('badge-list').textContent = policies.length;
  const uniqueClients = new Set(policies.map(p=>(p.clientName||'').trim().toUpperCase()).filter(Boolean));
  document.getElementById('badge-clients').textContent = uniqueClients.size;
}

/* ── DASHBOARD ── */
let _charts = {}; // guarda instâncias do Chart.js para destruir antes de recriar

function destroyChart(id) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}

const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const DIAS_SEMANA_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

function parseValidityStart(p) {
  if (!p.validityStart) return null;
  const [y,m,d] = p.validityStart.split('-').map(Number);
  return new Date(y, m-1, d);
}

/* ── FERIADOS NACIONAIS (Brasil) ────────────────────────────────
   Fixos + móveis (Carnaval, Sexta-feira Santa e Corpus Christi,
   calculados a partir da Páscoa — algoritmo de Meeus).         */
function easterDate(y) {
  const a=y%19, b=Math.floor(y/100), c=y%100, d=Math.floor(b/4), e=b%4,
        f=Math.floor((b+8)/25), g=Math.floor((b-f+1)/3),
        h=(19*a+b-d-g+15)%30, i=Math.floor(c/4), k=c%4,
        l=(32+2*e+2*i-h-k)%7, m=Math.floor((a+11*h+22*l)/451),
        month=Math.floor((h+l-7*m+114)/31), day=((h+l-7*m+114)%31)+1;
  return new Date(y, month-1, day);
}
const _holidayCache = Object.create(null);

/* Feriados regionais (edite aqui se necessário): [mês, dia] — mês 1–12 */
const FERIADOS_REGIONAIS = [
  [7, 2],   // Independência da Bahia (estadual)
  [6, 13],  // Santo Antônio — padroeiro de Jequié (municipal)
  [6, 24],  // São João (municipal)
  [8, 20],  // Dia do Evangélico — Jequié, Lei 2053/2018 (municipal)
  [10, 25], // Aniversário de Jequié (municipal)
];

function isHoliday(date) {
  const y = date.getFullYear();
  if (!_holidayCache[y]) {
    const easter = easterDate(y);
    const off = n => { const d = new Date(easter); d.setDate(d.getDate()+n); return d; };
    const list = [
      new Date(y,0,1),    // Confraternização Universal
      off(-48), off(-47), // Carnaval (segunda e terça)
      off(-2),            // Sexta-feira Santa
      new Date(y,3,21),   // Tiradentes
      new Date(y,4,1),    // Dia do Trabalho
      off(60),            // Corpus Christi
      new Date(y,8,7),    // Independência
      new Date(y,9,12),   // N. Sra. Aparecida
      new Date(y,10,2),   // Finados
      new Date(y,10,15),  // Proclamação da República
      new Date(y,10,20),  // Consciência Negra
      new Date(y,11,25),  // Natal
      ...FERIADOS_REGIONAIS.map(([m,d]) => new Date(y, m-1, d)),
    ];
    _holidayCache[y] = new Set(list.map(d => `${d.getMonth()}-${d.getDate()}`));
  }
  return _holidayCache[y].has(`${date.getMonth()}-${date.getDate()}`);
}

function countWorkdays(start, end) {
  // Seg–sex = 1 dia útil · Sábado = 0,5 · Domingo e feriados = 0
  let wd=0; const d=new Date(start);
  while(d<=end){
    if (!isHoliday(d)) {
      if (d.getDay()===6) wd += 0.5;
      else if (d.getDay()!==0) wd++;
    }
    d.setDate(d.getDate()+1);
  }
  return wd;
}
const fmtWd = v => Number.isInteger(v) ? String(v) : String(v).replace('.', ',');

/* ── METAS MENSAIS ── */
const LS_GOALS = 'corretor_goals';

function loadGoals() {
  try { return JSON.parse(localStorage.getItem(storageKey(LS_GOALS))) || { qty: 0, val: 0 }; } catch { return { qty:0, val:0 }; }
}
function saveGoals() {
  const qty = parseInt(document.getElementById('goal-qty-input').value)||0;
  const val = parseFloat(document.getElementById('goal-val-input').value)||0;
  localStorage.setItem(storageKey(LS_GOALS), JSON.stringify({qty, val}));
  toggleGoalEdit();
  renderDashboard();
  showNotif('Metas salvas!');
}
function toggleGoalEdit() {
  const form = document.getElementById('goal-edit-form');
  const isOpen = form.style.display !== 'none';
  form.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    const goals = loadGoals();
    document.getElementById('goal-qty-input').value = goals.qty || '';
    document.getElementById('goal-val-input').value = goals.val || '';
  }
}
function cancelGoalEdit() {
  document.getElementById('goal-edit-form').style.display = 'none';
}

function renderGoals(thisMonthCount, monthEarnings) {
  const goals = loadGoals();
  const barsEl = document.getElementById('dash-goals-bars');
  const titleEl = document.getElementById('dash-goals-title');
  if (!barsEl) return;

  if (!goals.qty && !goals.val) {
    barsEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:12px 0;font-size:13px;color:var(--muted)">Nenhuma meta definida ainda. Clique em <strong style="color:var(--accent2)">Editar metas</strong> para começar.</div>`;
    if (titleEl) titleEl.textContent = 'Metas do Mês';
    return;
  }

  const pctQty = goals.qty > 0 ? Math.min((thisMonthCount / goals.qty) * 100, 100) : 0;
  const pctVal = goals.val > 0 ? Math.min((monthEarnings / goals.val) * 100, 100) : 0;

  const bar = (pct, color) => `
    <div style="height:8px;background:rgba(255,255,255,.07);border-radius:99px;overflow:hidden;margin:10px 0 6px">
      <div style="height:100%;width:${pct.toFixed(1)}%;background:${color};border-radius:99px;transition:width .5s"></div>
    </div>`;

  const colorQty = pctQty >= 100 ? 'var(--green)' : pctQty >= 70 ? 'var(--accent2)' : 'var(--orange)';
  const colorVal = pctVal >= 100 ? 'var(--green)' : pctVal >= 70 ? 'var(--accent2)' : 'var(--orange)';

  if (titleEl) {
    const avg = ((pctQty + pctVal) / 2).toFixed(0);
    titleEl.textContent = `Metas do Mês — ${avg}% concluído`;
  }

  barsEl.innerHTML = `
    <div>
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-size:12px;color:var(--muted2);font-weight:600">Seguros fechados</span>
        <span style="font-size:11px;color:${colorQty};font-weight:700">${pctQty.toFixed(0)}%</span>
      </div>
      ${bar(pctQty, colorQty)}
      <div style="display:flex;justify-content:space-between">
        <span style="font-size:22px;font-weight:700;color:${colorQty}">${thisMonthCount}</span>
        <span style="font-size:12px;color:var(--muted);align-self:flex-end;margin-bottom:2px">meta: ${goals.qty}</span>
      </div>
    </div>
    <div>
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-size:12px;color:var(--muted2);font-weight:600">Comissão a receber</span>
        <span style="font-size:11px;color:${colorVal};font-weight:700">${pctVal.toFixed(0)}%</span>
      </div>
      ${bar(pctVal, colorVal)}
      <div style="display:flex;justify-content:space-between">
        <span style="font-size:18px;font-weight:700;color:${colorVal}">${fmt(monthEarnings)}</span>
        <span style="font-size:12px;color:var(--muted);align-self:flex-end;margin-bottom:2px">meta: ${fmt(goals.val)}</span>
      </div>
    </div>
  `;
}

/* ── TAXA DE RENOVAÇÃO ── */
function calcRenewalRate(windowMonths = 12) {
  /* Mede a retenção RECENTE da carteira:
     — Elegível: cliente com apólice vencida nos últimos {windowMonths} meses
       cuja janela de decisão (45 dias) já fechou.
     — Renovado: nova apólice iniciando entre -15 e +45 dias do vencimento,
       ou confirmação registrada no acompanhamento.
     — Vencimentos há menos de 45 dias ficam como "em prazo" (não penalizam).
     — Também calcula a janela anterior para tendência.                    */

  const GRACE = 45;
  const today = new Date(); today.setHours(0,0,0,0);
  const decisionCutoff = new Date(today); decisionCutoff.setDate(decisionCutoff.getDate() - GRACE);
  const windowStart = new Date(today); windowStart.setMonth(windowStart.getMonth() - windowMonths);
  const prevWindowStart = new Date(windowStart); prevWindowStart.setMonth(prevWindowStart.getMonth() - windowMonths);

  // Agrupa apólices por cliente
  const groups = Object.create(null);
  policies.forEach(p => {
    const key = clientKey(p);
    if (!key) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });

  const clientRenewedAfter = (sorted, refEnd, refPolicy) => {
    if (refPolicy.renewal?.stage === 'Renovado') return {renewed:true,auto:false};
    const renewed = sorted.some(p => {
      if (!p.validityStart || p.id===refPolicy.id || (refPolicy.vehiclePlate && p.vehiclePlate!==refPolicy.vehiclePlate)) return false;
      const diff = (new Date(p.validityStart) - refEnd) / 86400000;
      return diff >= -15 && diff <= GRACE;
    });
    return { renewed, auto:false };
  };

  const evalWindow = (wStart, wEnd, collectLists) => {
    let eligible = 0, renewedCount = 0;
    const renewedClients = [], notRenewedClients = [];
    Object.values(groups).forEach(clientPolicies => {
      const sorted = clientPolicies
        .filter(p=>p.validityStart && p.validityEnd)
        .sort((a,b)=>new Date(a.validityStart)-new Date(b.validityStart));
      if (!sorted.length) return;

      // Vencimentos dentro da janela (decisão já fechada)
      const exps = sorted.filter(p => {
        const end = new Date(p.validityEnd); end.setHours(0,0,0,0);
        return end >= wStart && end <= wEnd;
      });
      if (!exps.length) return;

      eligible++;
      const ref = exps[exps.length-1];
      const refEnd = new Date(ref.validityEnd); refEnd.setHours(0,0,0,0);
      const { renewed, auto } = clientRenewedAfter(sorted, refEnd, ref);

      if (collectLists) {
        const latest = sorted[sorted.length-1];
        const client = { id:clientKey(clientPolicies[0]), name: clientPolicies[0].clientName, policies: sorted.length, insurer: latest.insurer, lastEnd: latest.validityEnd };
        if (renewed) renewedClients.push({...client, autoRenewed: auto});
        else notRenewedClients.push(client);
      }
      if (renewed) renewedCount++;
    });
    return { eligible, renewedCount, renewedClients, notRenewedClients };
  };

  // Janela atual: últimos 12 meses, excluindo os 45 dias de graça
  const cur  = evalWindow(windowStart, decisionCutoff, true);
  // Janela anterior: os 12 meses antes disso (para tendência)
  const prev = evalWindow(prevWindowStart, windowStart, false);

  // Clientes com vencimento recente ainda dentro do prazo de decisão
  let pendingDecision = 0;
  Object.values(groups).forEach(clientPolicies => {
    const sorted = clientPolicies.filter(p=>p.validityStart && p.validityEnd);
    const hasRecent = sorted.some(p => {
      const end = new Date(p.validityEnd); end.setHours(0,0,0,0);
      return end > decisionCutoff && end < today;
    });
    if (hasRecent) pendingDecision++;
  });

  const rate = cur.eligible > 0 ? Math.round((cur.renewedCount/cur.eligible)*100) : 0;
  const prevRate = prev.eligible > 0 ? Math.round((prev.renewedCount/prev.eligible)*100) : null;

  return {
    rate, prevRate, windowMonths, pendingDecision,
    totalRenewed: cur.renewedCount,
    totalWithExpired: cur.eligible,
    renewedClients: cur.renewedClients,
    notRenewedClients: cur.notRenewedClients,
  };
}

/* ── Plugin de quantidade em cima das barras (reutilizável) ── */
const datalabelsPlugin = {
  id: 'datalabels',
  afterDatasetsDraw(chart) {
    const ctx2 = chart.ctx;
    chart.data.datasets.forEach((dataset, i) => {
      const meta = chart.getDatasetMeta(i);
      if (meta.hidden) return;
      meta.data.forEach((bar, j) => {
        const val = dataset.data[j];
        if (!val) return;
        ctx2.save();
        ctx2.fillStyle = themeColor('label');
        ctx2.font = 'bold 9.5px Inter, sans-serif';
        ctx2.textAlign = 'center';
        ctx2.textBaseline = 'bottom';
        ctx2.fillText(val, bar.x, bar.y - 2);
        ctx2.restore();
      });
    });
  }
};

/* ── Filtro de mês/ano com checkboxes ── */
// selectedMonths: array de 0-11, vazio = todos
// selectedYears: array de anos, vazio = todos
let selectedMonths = [new Date().getMonth()];
let selectedYears  = [new Date().getFullYear()];
// Mantém compatibilidade com código legado
let dashboardMonth = selectedMonths[0];
let dashboardYear  = selectedYears[0];

function toggleFilterPanel() {
  const panel = document.getElementById('filter-panel');
  if (panel.style.display === 'none') {
    openFilterPanel();
  } else {
    panel.style.display = 'none';
  }
}

function openFilterPanel() {
  const panel = document.getElementById('filter-panel');
  const {minY, maxY} = getDashboardYearRange();

  // Anos
  const yearsEl = document.getElementById('filter-years');
  if (yearsEl) {
    let html = `<label style="display:flex;align-items:center;gap:7px;font-size:12.5px;cursor:pointer;color:var(--muted2)">
      <input type="checkbox" id="fy-all" onchange="toggleAllYears(this.checked)"
        style="width:14px;height:14px;accent-color:var(--accent2);cursor:pointer"
        ${selectedYears.length===0?'checked':''}> Todos
    </label>`;
    for (let y=maxY; y>=minY; y--) {
      html += `<label style="display:flex;align-items:center;gap:7px;font-size:12.5px;cursor:pointer">
        <input type="checkbox" class="fy-cb" value="${y}" onchange="onYearCbChange()"
          style="width:14px;height:14px;accent-color:var(--accent2);cursor:pointer"
          ${selectedYears.includes(y)?'checked':''}> ${y}
      </label>`;
    }
    yearsEl.innerHTML = html;
  }

  // Meses
  const monthsEl = document.getElementById('filter-months');
  if (monthsEl) {
    let html = `<label style="display:flex;align-items:center;gap:7px;font-size:12.5px;cursor:pointer;color:var(--muted2);grid-column:1/-1">
      <input type="checkbox" id="fm-all" onchange="toggleAllMonths(this.checked)"
        style="width:14px;height:14px;accent-color:var(--accent2);cursor:pointer"
        ${selectedMonths.length===0?'checked':''}> Todos
    </label>`;
    MESES_PT.forEach((m, i) => {
      html += `<label style="display:flex;align-items:center;gap:7px;font-size:12.5px;cursor:pointer">
        <input type="checkbox" class="fm-cb" value="${i}" onchange="onMonthCbChange()"
          style="width:14px;height:14px;accent-color:var(--accent2);cursor:pointer"
          ${selectedMonths.includes(i)?'checked':''}> ${m}
      </label>`;
    });
    monthsEl.innerHTML = html;
  }

  panel.style.display = 'block';

  // Fecha ao clicar fora
  setTimeout(()=>{
    document.addEventListener('click', closePanelOutside, {once:true});
  }, 10);
}

function closePanelOutside(e) {
  const panel = document.getElementById('filter-panel');
  const btn = document.getElementById('btn-filter-period');
  if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
    panel.style.display = 'none';
  } else if (panel && panel.style.display !== 'none') {
    document.addEventListener('click', closePanelOutside, {once:true});
  }
}

function toggleAllYears(checked) {
  document.querySelectorAll('.fy-cb').forEach(cb => cb.checked = false);
  if (checked) selectedYears = [];
}
function toggleAllMonths(checked) {
  document.querySelectorAll('.fm-cb').forEach(cb => cb.checked = false);
  if (checked) selectedMonths = [];
}
function onYearCbChange() {
  document.getElementById('fy-all').checked = false;
}
function onMonthCbChange() {
  document.getElementById('fm-all').checked = false;
}

function selectAllPeriod() {
  selectedYears = []; selectedMonths = [];
  applyFilterPanel();
}

function applyFilterPanel() {
  // Lê checkboxes de anos
  const allYearsCb = document.getElementById('fy-all');
  if (allYearsCb && allYearsCb.checked) {
    selectedYears = [];
  } else {
    selectedYears = [...document.querySelectorAll('.fy-cb:checked')].map(cb=>parseInt(cb.value));
    if (!selectedYears.length) selectedYears = [new Date().getFullYear()];
  }

  // Lê checkboxes de meses
  const allMonthsCb = document.getElementById('fm-all');
  if (allMonthsCb && allMonthsCb.checked) {
    selectedMonths = [];
  } else {
    selectedMonths = [...document.querySelectorAll('.fm-cb:checked')].map(cb=>parseInt(cb.value));
    if (!selectedMonths.length) selectedMonths = [new Date().getMonth()];
  }

  // Atualiza compatibilidade legada
  dashboardMonth = selectedMonths.length === 1 ? selectedMonths[0] : -1;
  dashboardYear  = selectedYears.length  === 1 ? selectedYears[0]  : 0;

  // Atualiza label do botão
  updateFilterLabel();
  document.getElementById('filter-panel').style.display = 'none';
  renderDashboard();
}

function updateFilterLabel() {
  const el = document.getElementById('filter-period-label');
  if (!el) return;
  if (!selectedYears.length && !selectedMonths.length) { el.textContent = 'Todo o período'; return; }
  if (!selectedYears.length) { el.textContent = selectedMonths.map(m=>MESES_PT[m]).join(', ') + ' (todos os anos)'; return; }
  if (!selectedMonths.length) { el.textContent = selectedYears.join(', '); return; }
  if (selectedMonths.length === 1 && selectedYears.length === 1) {
    el.textContent = `${MESES_PT[selectedMonths[0]]}/${selectedYears[0]}`; return;
  }
  const mLabel = selectedMonths.length <= 3 ? selectedMonths.map(m=>MESES_PT[m]).join(', ') : `${selectedMonths.length} meses`;
  const yLabel = selectedYears.length <= 2 ? selectedYears.join(', ') : `${selectedYears.length} anos`;
  el.textContent = `${mLabel} · ${yLabel}`;
}

function resetDashboardMonth() {
  const today = new Date();
  selectedMonths = [today.getMonth()];
  selectedYears  = [today.getFullYear()];
  dashboardMonth = selectedMonths[0];
  dashboardYear  = selectedYears[0];
  updateFilterLabel();
  renderDashboard();
}

// Compatibilidade com populateDashboardMonthSelect (não faz mais nada)
function getDashboardYearRange() {
  const years=[new Date().getFullYear(),...policies.map(p=>Number(p.validityStart?.slice(0,4))),...expenses.map(e=>Number(e.date?.slice(0,4)))].filter(y=>Number.isInteger(y)&&y>1900&&y<10000);
  return {minY:Math.min(...years),maxY:Math.max(...years)};
}
function populateDashboardMonthSelect() { updateFilterLabel(); }
function onDashboardMonthSelect() {}
function onDashboardYearSelect() {}
function changeDashboardMonth(delta) {}
function populateDashboardMonthSelect() { updateFilterLabel(); }
function renderDashboard() {
  populateDashboardMonthSelect();
  const today = new Date(); today.setHours(0,0,0,0);

  const allMonths = selectedMonths.length === 0;
  const allYears  = selectedYears.length  === 0;

  // Compatibilidade com código legado
  const cm = selectedMonths.length === 1 ? selectedMonths[0] : -1;
  const cy = selectedYears.length  === 1 ? selectedYears[0]  : 0;

  // Controla visibilidade do seletor de anos do gráfico mensal
  const yearSelEl = document.getElementById('chart-year-selectors');
  if (yearSelEl) yearSelEl.style.display = allMonths ? 'none' : 'flex';

  // Filtra pelo período selecionado (suporta múltiplos meses e anos)
  const policiesInSelectedMonth = policies.filter(p=>{
    const d = parseValidityStart(p);
    if (!d) return false;
    const yearMatch  = allYears  || selectedYears.includes(d.getFullYear());
    const monthMatch = allMonths || selectedMonths.includes(d.getMonth());
    return yearMatch && monthMatch;
  });
  const expensesInSelectedMonth = expenses.filter(e=>{
    if (!e.date) return false;
    const [y,m] = e.date.split('-').map(Number);
    const yearMatch  = allYears  || selectedYears.includes(y);
    const monthMatch = allMonths || selectedMonths.includes(m-1);
    return yearMatch && monthMatch;
  });

  const activePolicies  = policiesInSelectedMonth;
  const paidEarnings = receiptsInPeriod(policies,date=>{const [y,m]=date.split('-').map(Number);return (allYears||selectedYears.includes(y))&&(allMonths||selectedMonths.includes(m-1));});
  const pendingEarnings = policiesInSelectedMonth.filter(p=>p.commissionStatus==='Pendente').reduce((a,c)=>a+remainingCommission(c),0);
  const totalExp        = expensesInSelectedMonth.reduce((a,c)=>a+c.amount,0);
  const netProfit       = paidEarnings - totalExp;
  const renewals        = policies.filter(p=>getStatus(p.validityEnd).label==='A Vencer').sort((a,b)=>getStatus(a.validityEnd).daysLeft-getStatus(b.validityEnd).daysLeft);

  // Label do período para os cards
  const periodoLabel = allYears && allMonths ? 'Todo o período'
    : allYears  ? (selectedMonths.length===1?MESES_PT[selectedMonths[0]]:selectedMonths.map(m=>MESES_PT[m]).join(', ')) + ' (todos os anos)'
    : allMonths ? selectedYears.join(', ')
    : selectedMonths.length===1 && selectedYears.length===1 ? `${MESES_PT[selectedMonths[0]]}/${selectedYears[0]}`
    : document.getElementById('filter-period-label')?.textContent || 'Período selecionado';

  // KPIs
  document.getElementById('dash-kpis').innerHTML = `
    <div class="stat-card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="stat-icon" style="background:rgba(108,99,255,.15);color:var(--accent2)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
        </div>
        <span style="font-size:11px;color:var(--muted);font-weight:600">${periodoLabel}</span>
      </div>
      <div><div class="stat-label">Apólices no período</div><div class="stat-value">${activePolicies.length}</div></div>
    </div>
    <div class="stat-card accent">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="stat-icon" style="background:rgba(108,99,255,.2);color:var(--accent2)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
        </div>
        <span style="font-size:10px;color:${netProfit>=0?'var(--green)':'var(--red)'};font-weight:700;text-transform:uppercase">${netProfit>=0?'positivo':'negativo'}</span>
      </div>
      <div><div class="stat-label" style="color:rgba(167,139,250,.7)">Saldo de caixa</div>
      <div class="stat-value" style="color:${netProfit>=0?'var(--green)':'var(--red)'};font-size:22px">${fmt(netProfit)}</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background:rgba(249,115,22,.12);color:var(--orange)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </div>
      <div><div class="stat-label">A Receber</div><div class="stat-value" style="color:var(--orange);font-size:20px">${fmt(pendingEarnings)}</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background:rgba(244,63,94,.12);color:var(--red)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>
      </div>
      <div><div class="stat-label">Despesas</div><div class="stat-value" style="color:var(--red);font-size:20px">${fmt(totalExp)}</div></div>
    </div>
    <div class="stat-card received-card"><div class="stat-icon" style="background:rgba(34,211,165,.12);color:var(--green)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg></div><div><div class="stat-label">Comissões recebidas</div><div class="stat-value" style="color:var(--green);font-size:20px">${fmt(paidEarnings)}</div><div class="kpi-note">Pela data do recebimento</div></div></div>
  `;

  /* ═══ Card de taxa de renovação (últimos 12 meses) ═══ */
  const renewal = calcRenewalRate();
  const rateColor = renewal.rate >= 70 ? 'var(--green)' : renewal.rate >= 40 ? 'var(--orange)' : 'var(--red)';
  const rateHex   = renewal.rate >= 70 ? '#22d3a5' : renewal.rate >= 40 ? '#f97316' : '#f43f5e';
  const rateLabel = renewal.rate >= 70 ? 'Excelente' : renewal.rate >= 40 ? 'Regular' : 'Atenção';
  const trend = renewal.prevRate !== null ? renewal.rate - renewal.prevRate : null;
  const churn = renewal.totalWithExpired - renewal.totalRenewed;

  // Gauge circular SVG (donut)
  const R = 42, CIRC = 2 * Math.PI * R;
  const dash = CIRC * Math.min(renewal.rate,100) / 100;

  // Injeta card extra de renovação antes dos kpis-extra (usa um slot separado)
  let renewalCardEl = document.getElementById('dash-renewal-card');
  if (!renewalCardEl) {
    const el = document.createElement('div');
    el.id = 'dash-renewal-card';
    el.style.cssText = 'margin-bottom:22px';
    document.getElementById('dash-kpis-extra').before(el);
    renewalCardEl = el;
  }
  renewalCardEl.innerHTML = `
    <div class="perf-card" style="padding:22px 24px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
        <svg style="width:14px;height:14px;color:${rateColor}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
        <span class="syne" style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted2)">Taxa de Renovação</span>
        <span style="font-size:10px;font-weight:600;color:var(--muted);background:var(--surface2);border:1px solid var(--border);padding:2px 9px;border-radius:99px">últimos ${renewal.windowMonths} meses</span>
        <span style="margin-left:auto;font-size:11px;font-weight:700;color:${rateColor};background:${rateHex}22;padding:3px 11px;border-radius:99px">${rateLabel}</span>
      </div>

      <div class="renewal-overview" style="display:grid;grid-template-columns:auto 1fr auto;gap:26px;align-items:center">
        <!-- Gauge circular -->
        <div style="position:relative;width:112px;height:112px;flex-shrink:0">
          <svg viewBox="0 0 100 100" style="width:112px;height:112px;transform:rotate(-90deg)">
            <circle cx="50" cy="50" r="${R}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="9"/>
            <circle cx="50" cy="50" r="${R}" fill="none" stroke="${rateHex}" stroke-width="9" stroke-linecap="round"
              stroke-dasharray="${dash.toFixed(1)} ${CIRC.toFixed(1)}"
              style="filter:drop-shadow(0 0 6px ${rateHex}66);transition:stroke-dasharray .8s cubic-bezier(.4,0,.2,1)"/>
          </svg>
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
            <span class="syne" style="font-size:25px;font-weight:800;color:${rateColor};line-height:1">${renewal.rate}%</span>
            ${trend!==null ? `<span style="font-size:10px;font-weight:700;color:${trend>=0?'var(--green)':'var(--red)'};margin-top:2px">${trend>=0?'▲':'▼'} ${Math.abs(trend)} pts</span>` : ''}
          </div>
        </div>

        <!-- Métricas -->
        <div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
            <div class="perf-metric" style="padding:12px 14px">
              <div class="perf-label" style="color:rgba(34,211,165,.7)">Renovaram</div>
              <div class="syne" style="font-size:24px;font-weight:800;color:var(--green);line-height:1">${renewal.totalRenewed}</div>
            </div>
            <div class="perf-metric" style="padding:12px 14px">
              <div class="perf-label" style="color:rgba(244,63,94,.7)">Perderam</div>
              <div class="syne" style="font-size:24px;font-weight:800;color:var(--red);line-height:1">${churn}</div>
            </div>
            <div class="perf-metric" style="padding:12px 14px">
              <div class="perf-label" style="color:rgba(249,115,22,.7)">Em prazo</div>
              <div class="syne" style="font-size:24px;font-weight:800;color:var(--orange);line-height:1">${renewal.pendingDecision}</div>
              <div style="font-size:9.5px;color:var(--muted);margin-top:3px">venceu há &lt; 45 dias</div>
            </div>
          </div>
          <div style="font-size:10.5px;color:var(--muted);margin-top:10px;line-height:1.5">
            Base: ${renewal.totalWithExpired} cliente${renewal.totalWithExpired===1?'':'s'} com vencimento no período · renovação = nova apólice em até 45 dias
            ${trend!==null ? ` · tendência vs 12 meses anteriores (${renewal.prevRate}%)` : ''}
          </div>
        </div>

        <button onclick="navigate('clients');showRenewalTab()" style="background:var(--accent);border:none;color:#fff;cursor:pointer;font-size:12px;font-weight:600;padding:9px 16px;border-radius:9px;font-family:inherit;white-space:nowrap;box-shadow:0 4px 14px rgba(108,99,255,.35)">Ver detalhes →</button>
      </div>
    </div>
  `;

  /* ═══ Cálculos de período ═══ */
  // Para comparativos, usa o primeiro ano/mês selecionado como referência
  const refY = selectedYears.length ? Math.max(...selectedYears) : new Date().getFullYear();
  const refM = selectedMonths.length ? Math.max(...selectedMonths) : new Date().getMonth();
  const pm = refM===0?11:refM-1, pmYear = refM===0?refY-1:refY;
  const py = refY-1;
  const isCurrentMonth = selectedMonths.length===1 && selectedYears.length===1 &&
    selectedMonths[0]===today.getMonth() && selectedYears[0]===today.getFullYear();

  const policiesWithDate = policies.map(p=>({...p, _d: parseValidityStart(p)})).filter(p=>p._d);

  const thisMonth = policiesWithDate.filter(p=>{
    const yearMatch  = allYears  || selectedYears.includes(p._d.getFullYear());
    const monthMatch = allMonths || selectedMonths.includes(p._d.getMonth());
    return yearMatch && monthMatch;
  });
  const prevMonth = (selectedMonths.length===1 && selectedYears.length===1)
    ? policiesWithDate.filter(p=>p._d.getFullYear()===pmYear && p._d.getMonth()===pm)
    : [];
  const sameMonthLastYear = (selectedMonths.length===1 && selectedYears.length===1)
    ? policiesWithDate.filter(p=>p._d.getFullYear()===py && p._d.getMonth()===refM)
    : [];
  const thisYearPolicies = allYears
    ? policiesWithDate
    : policiesWithDate.filter(p=>selectedYears.includes(p._d.getFullYear()));
  const lastYearPolicies = policiesWithDate.filter(p=>p._d.getFullYear()===py);

  const monthEnd = isCurrentMonth ? today : (allMonths||allYears) ? today : new Date(refY, refM+1, 0);
  const singlePeriod = !(allMonths||allYears||selectedMonths.length>1||selectedYears.length>1);
  const wd = singlePeriod ? countWorkdays(new Date(refY,refM,1), monthEnd) : null;
  const wdFullMonth = singlePeriod ? countWorkdays(new Date(refY,refM,1), new Date(refY,refM+1,0)) : null;
  const avgNum = wd ? thisMonth.length/wd : null;
  const avg = avgNum!==null ? avgNum.toFixed(1).replace('.',',') : '—';

  // Média por dia útil do mês anterior (mês completo) para comparativo
  const wdPrevMonth = singlePeriod ? countWorkdays(new Date(pmYear,pm,1), new Date(pmYear,pm+1,0)) : null;
  const avgPrevNum = (wdPrevMonth && wdPrevMonth>0) ? prevMonth.length/wdPrevMonth : 0;
  const avgPrev = avgPrevNum ? avgPrevNum.toFixed(1).replace('.',',') : '0';
  const monthEarnings = thisMonth.filter(p=>isPaid(p.commissionStatus)).reduce((a,c)=>a+(c.brokerEarning||0),0);
  const monthEarningsPending = thisMonth.filter(p=>p.commissionStatus==='Pendente').reduce((a,c)=>a+(c.brokerEarning||0),0);

  renderGoals(thisMonth.length, monthEarningsPending);

  /* ═══ Projeção de vendas até o fim do mês (base: média por dia útil) ═══ */
  const projBlock = document.getElementById('dash-projection-block');
  if (projBlock) {
    if (isCurrentMonth && singlePeriod && wd && wdFullMonth) {
      const remainingWd = Math.max(wdFullMonth - wd, 0);
      const totalEarningsMonth = thisMonth.reduce((a,c)=>a+(c.brokerEarning||0),0);
      const avgEarningPerSale = thisMonth.length>0 ? totalEarningsMonth/thisMonth.length : 0;
      const projectedExtra  = avgNum * remainingWd;
      const projectedQty    = Math.round(thisMonth.length + projectedExtra);
      const projectedEarnings = totalEarningsMonth + (projectedExtra * avgEarningPerSale);

      projBlock.style.display = '';
      document.getElementById('dash-projection-body').innerHTML = `
        <div class="perf-metric">
          <div class="perf-label">Seguros Projetados</div>
          <div class="perf-val">${projectedQty}</div>
          <div style="font-size:11px;color:rgba(167,139,250,.4);margin-top:4px">base: ${avg} seg/dia útil</div>
        </div>
        <div class="perf-metric">
          <div class="perf-label">Comissão Projetada</div>
          <div class="syne" style="font-size:22px;font-weight:800;color:var(--green)">${fmt(projectedEarnings)}</div>
          <div style="font-size:11px;color:rgba(167,139,250,.4);margin-top:4px">${fmtWd(remainingWd)} dias úteis restantes</div>
        </div>
      `;
    } else {
      projBlock.style.display = 'none';
    }
  }

  const pctChange = (curr, prev) => prev===0 ? (curr>0?100:0) : Math.round(((curr-prev)/prev)*100);
  const momChange = pctChange(thisMonth.length, prevMonth.length);
  const yoyChange = pctChange(thisMonth.length, sameMonthLastYear.length);
  const earningsPrevMonth = prevMonth.reduce((a,c)=>a+(c.brokerEarning||0),0);
  const momEarningsChange = pctChange(monthEarnings, earningsPrevMonth);

  /* ═══ KPIs extras ═══ */
  const arrowIcon = up => `<svg style="width:13px;height:13px;display:inline;vertical-align:-2px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="${up?'18 15 12 9 6 15':'6 9 12 15 18 9'}"/></svg>`;
  const showComparativo = selectedMonths.length===1 && selectedYears.length===1;
  const changeBadge = (pct) => showComparativo
    ? `<span style="font-size:12px;color:${pct>=0?'var(--green)':'var(--red)'};font-weight:600">${arrowIcon(pct>=0)} ${Math.abs(pct)}% vs ${MESES_PT[pm]}</span>`
    : `<span style="font-size:11px;color:var(--muted)">período completo</span>`;

  // Comparativo da média por dia útil (mês atual vs mês anterior)
  const avgChange = pctChange(avgNum||0, avgPrevNum);
  const wdElapsedPct = (wd && wdFullMonth) ? Math.min(Math.round(wd/wdFullMonth*100), 100) : 0;

  const kpiIcon = (svg, color) => `
    <div class="stat-icon" style="width:30px;height:30px;background:${color}18;color:${color};margin-bottom:2px">
      <svg style="width:14px;height:14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${svg}</svg>
    </div>`;

  const yoyLine = showComparativo || lastYearPolicies.length
    ? `<span style="font-size:11px;color:${yoyChange>=0?'var(--green)':'var(--red)'};font-weight:600">${arrowIcon(yoyChange>=0)} ${Math.abs(yoyChange)}% vs ${showComparativo?`${MESES_PT[refM]}/${py}`:py}</span>`
    : '';

  document.getElementById('dash-kpis-extra').innerHTML = `
    <div class="stat-card">
      ${kpiIcon('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>', 'var(--accent2)')}
      <div>
        <div class="stat-label">Fechados ${periodoLabel}</div>
        <div class="stat-value" style="font-size:22px">${thisMonth.length}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px">
        <div>${changeBadge(momChange)}</div>
        ${yoyLine ? `<div>${yoyLine}</div>` : ''}
      </div>
    </div>

    <div class="stat-card">
      ${kpiIcon('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>', 'var(--green)')}
      <div>
        <div class="stat-label">Média por dia útil</div>
        <div class="stat-value" style="font-size:22px">${avg}<span style="font-size:12px;color:var(--muted);font-weight:600"> seg/dia</span></div>
      </div>
      ${showComparativo
        ? `<div><span style="font-size:12px;color:${avgChange>=0?'var(--green)':'var(--red)'};font-weight:600">${arrowIcon(avgChange>=0)} ${Math.abs(avgChange)}% vs ${MESES_PT[pm]} (${avgPrev}/dia)</span></div>`
        : `<div style="font-size:11px;color:var(--muted)">período selecionado</div>`}
    </div>

    <div class="stat-card">
      ${kpiIcon('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>', 'var(--orange)')}
      <div>
        <div class="stat-label">Dias Úteis ${isCurrentMonth?'· decorridos':'no mês'}</div>
        <div class="stat-value" style="font-size:22px">${wd!==null?fmtWd(wd):'—'}${wd!==null&&isCurrentMonth?`<span style="font-size:13px;color:var(--muted);font-weight:600"> / ${fmtWd(wdFullMonth)}</span>`:''}</div>
      </div>
      ${wd!==null ? `
        <div>
          <div class="progress-bar" style="margin-top:0"><div class="progress-fill" style="width:${isCurrentMonth?wdElapsedPct:100}%"></div></div>
          <div style="font-size:10.5px;color:var(--muted);margin-top:5px">sáb = ½ · dom/feriados = 0${isCurrentMonth?` · ${wdElapsedPct}% do mês`:''}</div>
        </div>`
        : `<div style="font-size:11px;color:var(--muted)">selecione um único mês</div>`}
    </div>

    <div class="stat-card">
      ${kpiIcon('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>', 'var(--green)')}
      <div>
        <div class="stat-label">Comissão ${periodoLabel}</div>
        <div class="stat-value" style="font-size:20px;color:var(--green)">${fmt(monthEarnings)}</div>
      </div>
      <div>${changeBadge(momEarningsChange)}</div>
    </div>
  `;

  /* ═══ Gráfico: fechamentos por dia do mês ═══ */
  // Monta mapa de dia -> contagem
  const byDay = Object.create(null);
  thisMonth.forEach(p=>{
    const day = p._d.getDate();
    byDay[day] = (byDay[day]||0) + 1;
  });

  // Gera todos os dias do mês selecionado
  const daysInMonth = new Date(cy, cm+1, 0).getDate();
  const dayLabels = [], dayData = [];
  for (let d=1; d<=daysInMonth; d++) {
    const date = new Date(cy, cm, d);
    const weekName = DIAS_SEMANA_PT[date.getDay()];
    dayLabels.push(`${weekName} ${String(d).padStart(2,'0')}`);
    dayData.push(byDay[d]||0);
  }

  // Encontra o máximo para destacar
  const maxVal = Math.max(...dayData, 0);
  const barColors = dayData.map(v => v === maxVal && v > 0 ? '#f97316' : '#22d3a5');

  // Atualiza título com o melhor dia
  const titleEl = document.getElementById('chart-weekday-title');
  if (titleEl && maxVal > 0) {
    const bestDayIdx = dayData.indexOf(maxVal);
    titleEl.textContent = `Fechamentos por Dia · Melhor: ${dayLabels[bestDayIdx]} (${maxVal} seguros)`;
  } else if (titleEl) {
    titleEl.textContent = `Fechamentos por Dia do Mês`;
  }

  destroyChart('weekday');
  const ctxW = document.getElementById('chart-weekday');
  if (ctxW) {
    _charts.weekday = new Chart(ctxW, {
      type:'bar',
      plugins: [datalabelsPlugin],
      data:{
        labels: dayLabels,
        datasets:[{ data: dayData, backgroundColor: barColors, borderRadius:4 }]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false},
          tooltip:{ callbacks:{ title: items => items[0].label, label: items => `${items[0].raw} seguro${items[0].raw!==1?'s':''}` } }
        },
        scales:{
          y:{ beginAtZero:true, ticks:{ precision:0, color:themeColor('text') }, grid:{color:themeColor('grid')} },
          x:{ ticks:{ color:themeColor('text'), font:{size:9.5}, maxRotation:45, minRotation:45 }, grid:{display:false} }
        }
      }
    });
  }

  /* ═══ Top indicadores do mês ═══ */
  const byReferrer = Object.create(null);
  thisMonth.forEach(p=>{
    const r = (p.referrer||'').trim();
    if (!r) return;
    if (!byReferrer[r]) byReferrer[r] = { count:0, earning:0, byInsurer:{} };
    byReferrer[r].count++;
    byReferrer[r].earning += (p.brokerEarning||0);
    const ins = (p.insurer||'Não informado').trim() || 'Não informado';
    byReferrer[r].byInsurer[ins] = (byReferrer[r].byInsurer[ins]||0) + 1;
  });
  const insurerBreakdownHTML = data => Object.entries(data.byInsurer)
    .sort((a,b)=>b[1]-a[1])
    .map(([ins,cnt])=>`${cnt} ${escapeHTML(ins)}`).join(' · ');
  const referrerRanked = Object.entries(byReferrer).sort((a,b)=>b[1].count-a[1].count).slice(0,8);
  const refList = document.getElementById('dash-referrers');
  if (refList) {
    refList.innerHTML = referrerRanked.length ? referrerRanked.map(([name,data], idx)=>{
      const medal = idx===0?'🥇':idx===1?'🥈':idx===2?'🥉':'';
      return `<div style="padding:9px 12px;background:rgba(255,255,255,.025);border-radius:9px;margin-bottom:7px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <span style="font-size:12.5px;color:var(--muted2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70%">${medal} ${escapeHTML(name)}</span>
          <span style="font-size:12.5px;font-weight:700;color:var(--accent2)">${data.count} indicaç${data.count===1?'ão':'ões'}</span>
        </div>
        <div style="font-size:10.5px;color:var(--muted2);margin-bottom:3px">${insurerBreakdownHTML(data)}</div>
        <div style="font-size:11px;color:var(--green);font-weight:600">${fmt(data.earning)} gerado</div>
      </div>`;
    }).join('') :
    `<div class="empty-state" style="padding:20px 0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/></svg><span>Nenhuma indicação este mês</span></div>`;
  }

  /* ═══ Ranking completo de indicadores ═══ */
  const fullTitle = document.getElementById('dash-referrers-full-title');
  if (fullTitle) fullTitle.textContent = `Ranking de Indicadores — ${MESES_PT[cm]}/${cy}`;

  const refFullEl = document.getElementById('dash-referrers-full');
  if (refFullEl) {
    const allReferrers = Object.entries(byReferrer).sort((a,b)=>b[1].earning-a[1].earning);
    if (!allReferrers.length) {
      refFullEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:12px 0;font-size:13px;color:var(--muted)">Nenhuma indicação registrada neste mês.</div>`;
    } else {
      const maxEarning = allReferrers[0][1].earning;
      refFullEl.innerHTML = allReferrers.map(([name, data], idx)=>{
        const pct = maxEarning > 0 ? (data.earning / maxEarning * 100).toFixed(0) : 0;
        const medal = idx===0?'🥇':idx===1?'🥈':idx===2?'🥉':`${idx+1}º`;
        return `<div style="background:rgba(255,255,255,.025);border-radius:10px;padding:11px 13px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <div style="display:flex;align-items:center;gap:7px">
              <span style="font-size:13px">${medal}</span>
              <span style="font-size:12.5px;font-weight:600;color:var(--muted2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px" title="${escapeHTML(name)}">${escapeHTML(name)}</span>
            </div>
            <span style="font-size:11px;color:var(--muted);flex-shrink:0">${data.count} seg.</span>
          </div>
          <div style="font-size:11px;color:var(--muted2);margin-bottom:6px" title="${escapeHTML(insurerBreakdownHTML(data))}">${insurerBreakdownHTML(data)}</div>
          <div style="height:5px;background:rgba(255,255,255,.06);border-radius:99px;overflow:hidden;margin-bottom:6px">
            <div style="height:100%;width:${pct}%;background:var(--accent2);border-radius:99px"></div>
          </div>
          <div style="font-size:13px;font-weight:700;color:var(--green)">${fmt(data.earning)}</div>
        </div>`;
      }).join('');
    }
  }
  /* ═══ Gráfico: comparativo mensal / anual ═══ */
  const monthlyTitleEl = document.getElementById('chart-monthly-title');

  // Popular seletores de ano
  const {minY: minYearChart, maxY: maxYearChart} = getDashboardYearRange();
  const yearSelA = document.getElementById('chart-year-a');
  const yearSelB = document.getElementById('chart-year-b');

  if (yearSelA && yearSelB) {
    const yearsKey = `${minYearChart}-${maxYearChart}`;
    if (yearSelA.dataset.range !== yearsKey) {
      const opts = [];
      for (let y=maxYearChart; y>=minYearChart; y--) opts.push(`<option value="${y}">${y}</option>`);
      yearSelA.innerHTML = opts.join('');
      yearSelB.innerHTML = opts.join('');
      yearSelA.value = String(maxYearChart - 1);
      yearSelB.value = String(maxYearChart);
      yearSelA.dataset.range = yearsKey;
    }
  }

  const selectedYearA = yearSelA ? parseInt(yearSelA.value) : py;
  const selectedYearB = yearSelB ? parseInt(yearSelB.value) : cy;

  destroyChart('monthly');
  const ctxM = document.getElementById('chart-monthly');
  if (ctxM) {
    if (allMonths) {
      // Modo "Todos os meses": compara totais por ano (todos os anos disponíveis)
      const policiesAll = policies.map(p=>({...p, _d: parseValidityStart(p)})).filter(p=>p._d);
      const years = [];
      for (let y=minYearChart; y<=maxYearChart; y++) years.push(y);
      const colors = ['rgba(167,139,250,.5)','#6c63ff','#22d3a5','#f97316','#f43f5e'];
      const datasets = years.map((y,i)=>({
        label: String(y),
        data: MESES_PT.map((_,m)=> policiesAll.filter(p=>p._d.getFullYear()===y && p._d.getMonth()===m).length),
        backgroundColor: colors[i%colors.length],
        borderRadius: 5
      }));
      if (monthlyTitleEl) monthlyTitleEl.textContent = 'Seguros Fechados por Mês — Comparativo Anual';
      _charts.monthly = new Chart(ctxM, {
        type:'bar',
        plugins: [datalabelsPlugin],
        data:{ labels: MESES_PT, datasets },
        options:{ responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{ display:true, position:'top', labels:{ color:themeColor('text'), boxWidth:11, font:{size:11} } },
            tooltip:{ callbacks:{ label: ctx=>` ${ctx.dataset.label}: ${ctx.raw} seguros` } }
          },
          scales:{ y:{ beginAtZero:true, ticks:{precision:0, color:themeColor('text')}, grid:{color:themeColor('grid')} },
                   x:{ ticks:{color:themeColor('text')}, grid:{display:false} } } }
      });
    } else {
      // Modo normal: compara os dois anos selecionados
      const policiesAll = policies.map(p=>({...p, _d: parseValidityStart(p)})).filter(p=>p._d);
      const dataA = MESES_PT.map((_,m)=> policiesAll.filter(p=>p._d.getFullYear()===selectedYearA && p._d.getMonth()===m).length);
      const dataB = MESES_PT.map((_,m)=> policiesAll.filter(p=>p._d.getFullYear()===selectedYearB && p._d.getMonth()===m).length);
      if (monthlyTitleEl) monthlyTitleEl.textContent = `Seguros Fechados por Mês — ${selectedYearA} vs ${selectedYearB}`;
      _charts.monthly = new Chart(ctxM, {
        type:'bar',
        plugins: [datalabelsPlugin],
        data:{ labels: MESES_PT,
          datasets:[
            { label:String(selectedYearA), data: dataA, backgroundColor:'rgba(167,139,250,.45)', borderRadius:5 },
            { label:String(selectedYearB), data: dataB, backgroundColor:'#6c63ff', borderRadius:5 }
          ]},
        options:{ responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{ display:true, position:'top', labels:{ color:themeColor('text'), boxWidth:11, font:{size:11} } },
            tooltip:{ callbacks:{ label: ctx=>` ${ctx.dataset.label}: ${ctx.raw} seguros` } }
          },
          scales:{ y:{ beginAtZero:true, ticks:{precision:0, color:themeColor('text')}, grid:{color:themeColor('grid')} },
                   x:{ ticks:{color:themeColor('text')}, grid:{display:false} } } }
      });
    }
  }

  /* ═══ Gráficos: seguradoras mês x mês e ano x ano ═══ */
  function insurerCounts(list) {
    const o={}; list.forEach(p=>{ const i=(p.insurer||'Não informado').trim(); o[i]=(o[i]||0)+1; }); return o;
  }
  const insThisMonth = insurerCounts(thisMonth);
  const insPrevMonth = insurerCounts(prevMonth);
  const insThisYear  = insurerCounts(thisYearPolicies);
  const insLastYear  = insurerCounts(lastYearPolicies);
  const allInsurersMonth = [...new Set([...Object.keys(insThisMonth), ...Object.keys(insPrevMonth)])]
    .sort((a,b)=>(insThisMonth[b]||0)-(insThisMonth[a]||0)).slice(0,8);
  const allInsurersYear = [...new Set([...Object.keys(insThisYear), ...Object.keys(insLastYear)])]
    .sort((a,b)=>(insThisYear[b]||0)-(insThisYear[a]||0)).slice(0,8);

  // Gráfico seguradoras mês a mês — com filtros de mês
  const insurerMonthTitle = document.getElementById('dash-insurer-month-title');
  if (insurerMonthTitle) insurerMonthTitle.textContent = 'Seguradoras — Comparativo Mensal';

  const imFiltersEl = document.getElementById('insurer-month-filters');
  if (imFiltersEl && !imFiltersEl.dataset.built) {
    const today2 = new Date();
    const curM = today2.getMonth(), curY = today2.getFullYear();
    const prevM2 = curM===0?11:curM-1, prevY2 = curM===0?curY-1:curY;
    const colors2 = ['#22d3a5','rgba(34,211,165,.45)','#6c63ff','rgba(108,99,255,.45)'];
    // Últimos 4 meses como opções padrão
    const monthOpts = [];
    for (let i=0; i<4; i++) {
      let m = curM-i, y = curY;
      if (m<0) { m+=12; y--; }
      monthOpts.push({m, y, label:`${MESES_PT[m]}/${y}`, checked: i<2});
    }
    imFiltersEl.innerHTML = monthOpts.map((o,i)=>`
      <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;background:var(--surface2);padding:4px 10px;border-radius:7px;border:1px solid var(--border)">
        <input type="checkbox" class="im-month-cb" value="${o.y}-${String(o.m).padStart(2,'0')}" onchange="renderInsurerMonthChart()"
          style="width:12px;height:12px;accent-color:${colors2[i]}" ${o.checked?'checked':''}> ${o.label}
      </label>`).join('');
    imFiltersEl.dataset.built = '1';
  }

  destroyChart('insurerMonth');
  renderInsurerMonthChart();
  destroyChart('insurerYear');
  const ctxIY = document.getElementById('chart-insurer-year');
  if (ctxIY) {
    // Monta filtros de ano para esse gráfico
    const {minY: minYI, maxY: maxYI} = getDashboardYearRange();
    const filtersEl = document.getElementById('insurer-year-filters');
    if (filtersEl && !filtersEl.dataset.built) {
      let html = '';
      for (let y=maxYI; y>=minYI; y--) {
        const checked = y >= maxYI-1; // padrão: últimos 2 anos
        const color = y===maxYI?'#f97316':y===maxYI-1?'rgba(249,115,22,.5)':y===maxYI-2?'#6c63ff':'rgba(108,99,255,.5)';
        html += `<label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;background:var(--surface2);padding:4px 10px;border-radius:7px;border:1px solid var(--border)">
          <input type="checkbox" class="iy-year-cb" value="${y}" onchange="renderInsurerYearChart()"
            style="width:12px;height:12px;accent-color:${color}" ${checked?'checked':''}> ${y}
        </label>`;
      }
      filtersEl.innerHTML = html;
      filtersEl.dataset.built = '1';
    }
    renderInsurerYearChart();
  }
  const titleEl2 = document.getElementById('insurer-year-title');
  if (titleEl2) titleEl2.textContent = 'Seguradoras — Comparativo Anual';

  const insurerRows = Object.entries(insThisMonth).sort((a,b)=>b[1]-a[1]).map(([ins,cnt])=>{
    const pct=(cnt/(thisMonth.length||1)*100).toFixed(0);
    return `<div class="insurer-row">
      <div class="insurer-row-header">
        <span class="insurer-name" title="${escapeHTML(ins)}">${escapeHTML(ins)}</span>
        <span class="insurer-count">${cnt} seguros (${pct}%)</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');

  document.getElementById('dash-perf').innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px">
      <svg style="width:17px;height:17px;color:var(--accent2)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
      <span class="syne" style="font-size:12px;font-weight:700;color:var(--accent2);text-transform:uppercase;letter-spacing:.07em">Desempenho · ${MESES_PT[cm]} de ${cy}</span>
    </div>
    <div class="grid-3">
      <div class="perf-metric">
        <div class="perf-label">Fechados</div>
        <div class="perf-val">${thisMonth.length}</div>
        <div style="font-size:11px;color:rgba(167,139,250,.4);margin-top:4px">apólices</div>
      </div>
      <div class="perf-metric">
        <div class="perf-label">Média/Dia</div>
        <div style="display:flex;align-items:baseline;gap:3px">
          <span class="perf-val">${avg}</span>
          <span style="font-size:11px;color:rgba(167,139,250,.4)">útil</span>
        </div>
      </div>
      <div class="perf-metric">
        <div class="perf-label">Ganhos</div>
        <div class="syne" style="font-size:16px;font-weight:800;color:var(--green)">${fmt(monthEarnings)}</div>
        <div style="font-size:11px;color:rgba(167,139,250,.4);margin-top:4px">este mês</div>
      </div>
    </div>
    ${insurerRows.length ? `
    <div style="margin-top:16px;padding:14px 16px;background:rgba(255,255,255,.025);border-radius:10px;border:1px solid rgba(255,255,255,.05)">
      <div style="font-size:10px;color:rgba(167,139,250,.5);font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">Por Seguradora</div>
      <div style="display:flex;flex-direction:column;gap:7px">${insurerRows}</div>
    </div>` : ''}
  `;

  // Renewals
  const badge = document.getElementById('renewal-badge');
  if (renewals.length) { badge.style.display='inline-flex'; badge.textContent=renewals.length; } else badge.style.display='none';
  const rList = document.getElementById('renewals-list');
  if (!renewals.length) {
    rList.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span>Nenhuma renovação próxima</span></div>`;
    return;
  }

  // Separa Seguro Ative (automático) das demais
  const ativeRenewals = renewals.filter(p=>(p.insurer||'').toLowerCase().includes('ativ'));
  const otherRenewals = renewals.filter(p=>!(p.insurer||'').toLowerCase().includes('ativ'));

  // Dashboard de renovações por seguradora
  const byInsurerRenewal = Object.create(null);
  renewals.forEach(p=>{ const i=p.insurer||'Não informado'; byInsurerRenewal[i]=(byInsurerRenewal[i]||0)+1; });
  const renewalByInsurerHTML = Object.entries(byInsurerRenewal).sort((a,b)=>b[1]-a[1]).map(([ins,cnt])=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;background:rgba(255,255,255,.03);border-radius:7px">
      <span style="font-size:11.5px;color:var(--muted2)">${escapeHTML(ins)}</span>
      <span style="font-size:12px;font-weight:700;color:var(--orange)">${cnt}</span>
    </div>`).join('');

  const whatsBtn = (p) => p.clientContact ? `<button onclick="sendRenewalReminder(${jsArgument(p.id)})" title="Enviar lembrete por WhatsApp"
    style="background:rgba(34,211,165,.12);border:none;color:var(--green);cursor:pointer;width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0"
    onmouseenter="this.style.background='rgba(34,211,165,.22)'" onmouseleave="this.style.background='rgba(34,211,165,.12)'">
    <svg style="width:14px;height:14px" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.44.79 3.07 1.2 4.74 1.2 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm5.8 14.07c-.24.68-1.42 1.3-1.96 1.38-.5.08-1.13.11-1.83-.12-.42-.13-.96-.31-1.65-.6-2.9-1.25-4.79-4.17-4.94-4.36-.14-.2-1.18-1.57-1.18-3 0-1.42.75-2.12 1.01-2.41.27-.29.58-.36.78-.36.19 0 .39 0 .56.01.18.01.42-.07.65.5.24.58.82 2 .89 2.15.07.15.12.32.02.52-.1.2-.15.32-.3.49-.15.17-.31.39-.45.52-.15.15-.3.31-.13.6.17.3.77 1.27 1.65 2.06 1.13 1.01 2.09 1.32 2.38 1.47.29.15.46.13.63-.08.17-.2.71-.83.9-1.12.19-.29.38-.24.64-.14.26.1 1.65.78 1.94.92.28.14.47.21.54.32.07.12.07.68-.17 1.36z"/></svg>
  </button>` : '';

  const refuseBtn = (p) => `<button onclick="openRefuseTicket(${jsArgument(p.id)})" title="Cliente não quer renovar"
    style="background:rgba(244,63,94,.1);border:none;color:var(--red);cursor:pointer;width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0"
    onmouseenter="this.style.background='rgba(244,63,94,.2)'" onmouseleave="this.style.background='rgba(244,63,94,.1)'" >
    <svg style="width:13px;height:13px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
  </button>`;

  rList.innerHTML = `
    <!-- Dashboard por seguradora -->
    <div style="background:rgba(255,255,255,.025);border-radius:10px;padding:10px 12px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted2);margin-bottom:8px">Por seguradora</div>
      <div style="display:flex;flex-direction:column;gap:5px">${renewalByInsurerHTML}</div>
    </div>

    ${ativeRenewals.length ? `
    <!-- Seguro Ative: renovação automática -->
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--green);margin:10px 0 6px;display:flex;align-items:center;gap:5px">
      <svg style="width:11px;height:11px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
      Ative Motos — Renovação Automática (${ativeRenewals.length})
    </div>
    ${ativeRenewals.map(p=>{
      const s=getStatus(p.validityEnd);
      const dLabel = s.daysLeft===0?'vence hoje':`${s.daysLeft}d`;
      return `<div class="renewal-item" style="border-color:rgba(34,211,165,.2);cursor:default">
        <div style="width:8px;height:8px;border-radius:50%;background:var(--green);flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(p.clientName)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:1px">${escapeHTML(p.vehicleModel||'')}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          <div style="text-align:right">
            <div style="font-size:11px;font-weight:700;color:var(--green)">${fmtDate(p.validityEnd)}</div>
            <div style="font-size:10px;color:var(--muted);margin-top:2px">${dLabel}</div>
          </div>
          ${whatsBtn(p)}
        </div>
      </div>`;
    }).join('')}` : ''}

    ${otherRenewals.length ? `
    <!-- Outras seguradoras: requer ação -->
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--orange);margin:10px 0 6px;display:flex;align-items:center;gap:5px">
      <svg style="width:11px;height:11px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      Requer confirmação do cliente (${otherRenewals.length})
    </div>
    ${otherRenewals.map(p=>{
      const s=getStatus(p.validityEnd);
      const dLabel = s.daysLeft===0?'vence hoje':`${s.daysLeft}d`;
      return `<div class="renewal-item" style="cursor:default">
        <div class="renewal-dot"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(p.clientName)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:1px">${escapeHTML(p.vehicleModel||'')} · ${escapeHTML(p.insurer||'')}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <div style="text-align:right">
            <div style="font-size:11px;font-weight:700;color:var(--orange)">${fmtDate(p.validityEnd)}</div>
            <div style="font-size:10px;color:var(--muted);margin-top:2px">${dLabel}</div>
          </div>
          ${whatsBtn(p)}
          ${refuseBtn(p)}
        </div>
      </div>`;
    }).join('')}` : ''}
  `;
}

/* ── TICKET DE RECUSA DE RENOVAÇÃO ── */
let _refusePolicyId = null;

function openRefuseTicket(policyId) {
  const p = policies.find(x=>x.id===policyId);
  if (!p) return;
  _refusePolicyId = policyId;
  document.getElementById('refuse-reason').value = '';
  document.getElementById('refuse-client-info').innerHTML = `
    <div style="font-weight:600;margin-bottom:4px">${escapeHTML(p.clientName)}</div>
    <div>${escapeHTML(p.insurer||'')} · ${escapeHTML(p.vehicleModel||'')} · vence ${fmtDate(p.validityEnd)}</div>
  `;
  showDialog('refuse-ticket-overlay');
}

function closeRefuseTicket() {
  hideDialog('refuse-ticket-overlay');
  _refusePolicyId = null;
}

async function refuseRenewal(action) {
  const p=policies.find(p=>p.id===_refusePolicyId);if(!p)return;
  const reason=document.getElementById('refuse-reason').value.trim();
  const renewal={...p.renewal,stage:'Recusado',nextAction:'',history:[...(p.renewal?.history||[]),{date:localDate(),stage:'Recusado',note:reason}]};
  if(await commitOperation('policies','upsert',{...p,renewal})) {closeRefuseTicket();render();}
}

function sendRenewalReminder(policyId) {
  const p=policies.find(p=>p.id===policyId);if(!p?.clientContact)return;
  const phone=p.clientContact.replace(/\D/g,'');
  const ddi=phone.length>11 && phone.startsWith('55')?phone:'55'+phone;
  const msg='Olá, '+p.clientName.trim().split(' ')[0]+'. Aqui é '+(preferences.brokerName||'seu corretor')+'. Sua apólice do veículo '+p.vehicleModel+' vence em '+fmtDate(p.validityEnd)+'. Deseja renovar?';
  window.open('https://wa.me/'+ddi+'?text='+encodeURIComponent(msg),'_blank','noopener,noreferrer');
}

/* ── LIST ── */
function renderList() {
  const filtered = getFiltered();
  const search   = document.getElementById('search-input')?.value||'';

  document.getElementById('list-sub').textContent = `${filtered.length} de ${policies.length} registros`;
  document.getElementById('search-clear').style.display = search ? 'block':'none';

  // Update chip counts
  const counts = { Todos:policies.length, Ativo:0, 'A Vencer':0, Vencido:0 };
  policies.forEach(p => { const l=getStatus(p.validityEnd).label; if(counts[l]!==undefined) counts[l]++; });
  document.getElementById('fc-all').textContent    = counts['Todos'];
  document.getElementById('fc-ativo').textContent  = counts['Ativo'];
  document.getElementById('fc-avencer').textContent= counts['A Vencer'];
  document.getElementById('fc-vencido').textContent= counts['Vencido'];

  const tbody = document.getElementById('list-body');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7">
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span>Nenhum seguro encontrado</span>
        ${(search||statusFilter!=='Todos')?'<button class="btn-ghost" style="margin-top:4px;font-size:12px" onclick="clearSearch();setFilter(\'Todos\')">Limpar filtros</button>':''}
      </div></td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(p => {
    const s = getStatus(p.validityEnd);
    const commission=commissionState(p);
    const daysNote = s.daysLeft!==null&&s.daysLeft>=0&&s.daysLeft<=30
      ? `<div style="font-size:10px;color:var(--orange);font-weight:600;margin-top:3px">${s.daysLeft===0?'vence hoje!':s.daysLeft+'d restantes'}</div>` : '';
    return `<tr>
      <td>
        <div style="font-weight:600;font-size:13.5px">${escapeHTML(p.clientName)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${escapeHTML(p.cpf||'')}</div>
        <div style="font-size:11px;color:var(--muted2);margin-top:2px;display:flex;align-items:center;gap:3px">
          <svg style="width:9px;height:9px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.22 1.22 2 2 0 012.18 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.06 6.06l1.27-.52a2 2 0 012.11.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
          ${escapeHTML(p.clientContact||'—')}
        </div>
      </td>
      <td>
        <div style="font-weight:600;font-size:13px">${escapeHTML(p.vehicleModel||'—')}</div>
        <span class="plate-chip" style="margin-top:4px;display:inline-block">${escapeHTML(p.vehiclePlate||'SEM PLACA')}</span>
      </td>
      <td>
        <div style="font-size:13px;color:var(--muted2)">${escapeHTML(p.insurer||'')}</div>
        ${p.referrer?`<div style="font-size:11px;color:var(--muted);margin-top:2px">via ${escapeHTML(p.referrer)}</div>`:''}
      </td>
      <td>
        <div style="font-size:12px;color:var(--muted)">${fmtDate(p.validityStart)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:1px">até ${fmtDate(p.validityEnd)}</div>
        ${daysNote}
      </td>
      <td>${pillHTML(s)}</td>
      <td>
        <div style="font-weight:700;font-size:14px;color:var(--accent2)">${fmt(p.brokerEarning)}</div>
        <span class="commission-status commission-${commission.key}">${commission.label}</span>
        ${commission.key==='partial'?'<div class="commission-balance">Falta '+fmt(remainingCommission(p))+'</div>':''}
        ${canReceiveCommission(p)?'<button class="commission-receive" onclick="openReceiptDialog('+jsArgument(p.id)+')">Registrar recebimento</button>':''}
        <div style="font-size:11px;color:var(--muted);margin-top:1px">Parcela: ${fmt(p.monthlyInstallment)}</div>
      </td>
      <td style="text-align:center">
        <div style="display:flex;justify-content:center;gap:5px">
          <button class="act-btn edit" onclick="editPolicy(${jsArgument(p.id)})" title="Editar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="act-btn del" onclick="deletePolicy(${jsArgument(p.id)})" title="Excluir">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderInsurerMonthChart() {
  const ctxIM = document.getElementById('chart-insurer-month');
  if (!ctxIM) return;

  const checkedMonths = [...document.querySelectorAll('.im-month-cb:checked')].map(cb=>cb.value);
  if (!checkedMonths.length) return;

  const policiesAll = policies.map(p=>({...p, _d: parseValidityStart(p)})).filter(p=>p._d);

  // Todas as seguradoras presentes nos meses selecionados
  const allIns = new Set();
  policiesAll.filter(p=>{
    const key = `${p._d.getFullYear()}-${String(p._d.getMonth()).padStart(2,'0')}`;
    return checkedMonths.includes(key);
  }).forEach(p=>allIns.add((p.insurer||'').trim()));
  const allInsList = [...allIns].sort();

  // Monta filtros de seguradora
  const insFiltersEl = document.getElementById('insurer-month-ins-filters');
  if (insFiltersEl && !insFiltersEl.dataset.built) {
    insFiltersEl.innerHTML = allInsList.map(ins=>`
      <label style="display:flex;align-items:center;gap:5px;font-size:11.5px;cursor:pointer;background:var(--surface2);padding:3px 9px;border-radius:7px;border:1px solid var(--border)">
        <input type="checkbox" class="im-ins-cb" value="${escapeHTML(ins)}" onchange="renderInsurerMonthChart()"
          style="width:12px;height:12px;accent-color:var(--accent2)" checked> ${escapeHTML(ins)}
      </label>`).join('');
    insFiltersEl.dataset.built = '1';
  }

  // Seguradoras selecionadas
  const checkedIns = [...document.querySelectorAll('.im-ins-cb:checked')].map(cb=>cb.value);
  const insurerList = allInsList.filter(i=>checkedIns.includes(i));
  if (!insurerList.length) return;

  const colors = ['#22d3a5','rgba(34,211,165,.5)','#6c63ff','rgba(108,99,255,.5)','#f97316'];
  const datasets = checkedMonths.map((ym,i)=>{
    const [y,m] = ym.split('-').map(Number);
    return {
      label: `${MESES_PT[m]}/${y}`,
      data: insurerList.map(ins=>policiesAll.filter(p=>p._d.getFullYear()===y && p._d.getMonth()===m && (p.insurer||'').trim()===ins).length),
      backgroundColor: colors[i%colors.length],
      borderRadius: 5
    };
  });

  destroyChart('insurerMonth');
  _charts.insurerMonth = new Chart(ctxIM, {
    type:'bar', plugins:[datalabelsPlugin],
    data:{ labels: insurerList, datasets },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:true, position:'top', labels:{ color:themeColor('text'), boxWidth:11, font:{size:11} } },
        tooltip:{ callbacks:{ label: ctx=>`${ctx.dataset.label}: ${ctx.raw} seguros` } } },
      scales:{ y:{ beginAtZero:true, ticks:{precision:0, color:themeColor('text')}, grid:{color:themeColor('grid')} },
               x:{ ticks:{color:themeColor('text'), font:{size:10.5}}, grid:{display:false} } } }
  });
}

function renderInsurerYearChart() {
  const ctxIY = document.getElementById('chart-insurer-year');
  if (!ctxIY) return;

  const checkedYears = [...document.querySelectorAll('.iy-year-cb:checked')].map(cb=>parseInt(cb.value));
  if (!checkedYears.length) return;
  checkedYears.sort((a,b)=>a-b);

  const policiesAll = policies.map(p=>({...p, _d: parseValidityStart(p)})).filter(p=>p._d);

  // Todas as seguradoras presentes nos anos selecionados
  const allIns = new Set();
  policiesAll.filter(p=>checkedYears.includes(p._d.getFullYear())).forEach(p=>allIns.add((p.insurer||'').trim()));
  const allInsList = [...allIns].sort();

  // Monta filtros de seguradora
  const insFiltersEl = document.getElementById('insurer-year-ins-filters');
  if (insFiltersEl && !insFiltersEl.dataset.built) {
    insFiltersEl.innerHTML = allInsList.map(ins=>`
      <label style="display:flex;align-items:center;gap:5px;font-size:11.5px;cursor:pointer;background:var(--surface2);padding:3px 9px;border-radius:7px;border:1px solid var(--border)">
        <input type="checkbox" class="iy-ins-cb" value="${escapeHTML(ins)}" onchange="renderInsurerYearChart()"
          style="width:12px;height:12px;accent-color:var(--accent2)" checked> ${escapeHTML(ins)}
      </label>`).join('');
    insFiltersEl.dataset.built = '1';
  }

  // Seguradoras selecionadas
  const checkedIns = [...document.querySelectorAll('.iy-ins-cb:checked')].map(cb=>cb.value);
  const insurerList = allInsList.filter(i=>checkedIns.includes(i));
  if (!insurerList.length) return;

  const colors = ['#f97316','#6c63ff','#22d3a5','#f43f5e','#facc15'];
  const datasets = checkedYears.map((y,i)=>({
    label: String(y),
    data: insurerList.map(ins=>policiesAll.filter(p=>p._d.getFullYear()===y && (p.insurer||'').trim()===ins).length),
    backgroundColor: colors[i%colors.length],
    borderRadius: 5
  }));

  destroyChart('insurerYear');
  _charts.insurerYear = new Chart(ctxIY, {
    type:'bar', plugins:[datalabelsPlugin],
    data:{ labels: insurerList, datasets },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:true, position:'top', labels:{ color:themeColor('text'), boxWidth:11, font:{size:11} } },
        tooltip:{ callbacks:{ label: ctx=>`${ctx.dataset.label}: ${ctx.raw} seguros` } } },
      scales:{ y:{ beginAtZero:true, ticks:{precision:0, color:themeColor('text')}, grid:{color:themeColor('grid')} },
               x:{ ticks:{color:themeColor('text'), font:{size:10.5}}, grid:{display:false} } } }
  });
}

/* ── CLIENTS ── */
let _clientFilter = 'all'; // 'all' | 'renewed' | 'not-renewed'

function setClientFilter(filter) {
  _clientFilter = filter;
  document.querySelectorAll('#clients-filter-chips .filter-chip').forEach(b => b.classList.remove('f-all'));
  const map = { 'all':'cf-all', 'renewed':'cf-renewed', 'not-renewed':'cf-not-renewed' };
  document.getElementById(map[filter])?.classList.add('f-all');
  renderClients();
}

function showRenewalTab() {
  setClientFilter('not-renewed');
}
function getClientGroups() {
  const groups=new Map();
  policies.forEach(p=>{const key=clientKey(p);if(!groups.has(key))groups.set(key,{id:key,name:p.clientName,contact:p.clientContact||'',policies:[]});groups.get(key).policies.push(p);});
  return [...groups.values()];
}

function clearClientsSearch() {
  document.getElementById('clients-search-input').value = '';
  renderClients();
}

function renderClients() {
  const search = (document.getElementById('clients-search-input')?.value||'').trim().toLowerCase();
  let groups = getClientGroups();
  const renewal = calcRenewalRate();

  // Monta sets de nomes renovados/não renovados
  const renewedNames = new Set(renewal.renewedClients.map(c=>c.id));
  const notRenewedNames = new Set(renewal.notRenewedClients.map(c=>c.id));

  // Atualiza contadores das abas
  const cfAll = document.getElementById('cfc-all');
  const cfRenewed = document.getElementById('cfc-renewed');
  const cfNotRenewed = document.getElementById('cfc-not-renewed');
  if (cfAll) cfAll.textContent = groups.length;
  if (cfRenewed) cfRenewed.textContent = renewal.totalRenewed;
  if (cfNotRenewed) cfNotRenewed.textContent = renewal.totalWithExpired - renewal.totalRenewed;

  // Aplica filtro de renovação
  if (_clientFilter === 'renewed') {
    groups = groups.filter(g => renewedNames.has(g.id));
  } else if (_clientFilter === 'not-renewed') {
    groups = groups.filter(g => notRenewedNames.has(g.id));
  }

  if (search) {
    groups = groups.filter(g =>
      g.name.toLowerCase().includes(search) ||
      (g.contact||'').toLowerCase().includes(search) ||
      g.policies.some(p => (p.vehiclePlate||'').toLowerCase().includes(search) || (p.cpf||'').includes(search))
    );
  }
  groups.sort((a,b) => a.name.localeCompare(b.name, 'pt-BR'));

  const label = _clientFilter==='renewed' ? 'renovaram' : _clientFilter==='not-renewed' ? 'não renovaram' : 'clientes';
  document.getElementById('clients-sub').textContent = `${groups.length} ${label}`;
  document.getElementById('clients-search-clear').style.display = search ? 'block':'none';

  const tbody = document.getElementById('clients-body');
  if (!groups.length) {
    tbody.innerHTML = `<tr><td colspan="7">
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span>Nenhum cliente encontrado</span>
      </div></td></tr>`;
    return;
  }

  tbody.innerHTML = groups.map(g => {
    const sorted = [...g.policies].sort((a,b)=>new Date(b.validityStart||0)-new Date(a.validityStart||0));
    const latest = sorted[0];
    const totalEarning = g.policies.reduce((a,c)=>a+(c.brokerEarning||0),0);
    const upcoming = g.policies
      .filter(p=>{ const s=getStatus(p.validityEnd).label; return s==='Ativo' || s==='A Vencer'; })
      .sort((a,b)=>new Date(a.validityEnd||0)-new Date(b.validityEnd||0))[0];
    const keyEsc = jsArgument(g.id);
    const nameKey = g.id;
    const isRenewed = renewedNames.has(nameKey);
    const isNotRenewed = notRenewedNames.has(nameKey);
    const isAutoRenewed = isRenewed && renewal.renewedClients.find(c=>c.id===nameKey)?.autoRenewed;
    const renewalBadge = isAutoRenewed
      ? `<span style="font-size:9.5px;font-weight:700;color:#22d3a5;background:rgba(34,211,165,.12);padding:1px 7px;border-radius:99px;margin-left:6px">⟳ auto (Ative)</span>`
      : isRenewed
      ? `<span style="font-size:9.5px;font-weight:700;color:var(--green);background:rgba(34,211,165,.12);padding:1px 7px;border-radius:99px;margin-left:6px">✓ renovou</span>`
      : isNotRenewed
      ? `<span style="font-size:9.5px;font-weight:700;color:var(--red);background:rgba(244,63,94,.1);padding:1px 7px;border-radius:99px;margin-left:6px">✗ não renovou</span>`
      : '';
    return `<tr style="cursor:pointer" onclick="openClientDetail(${keyEsc})">
      <td>
        <div style="font-weight:600;font-size:13.5px;display:flex;align-items:center">${escapeHTML(g.name)}${renewalBadge}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${escapeHTML(latest?.cpf||'')}</div>
      </td>
      <td>
        <div style="font-size:12.5px;color:var(--muted2);display:flex;align-items:center;gap:4px">
          <svg style="width:10px;height:10px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.22 1.22 2 2 0 012.18 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.06 6.06l1.27-.52a2 2 0 012.11.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
          ${escapeHTML(g.contact || '—')}
        </div>
      </td>
      <td style="text-align:center">
        <span class="badge" style="position:static">${g.policies.length}</span>
      </td>
      <td><div style="font-size:13px;color:var(--muted2)">${escapeHTML(latest?.insurer||'—')}</div></td>
      <td>
        ${upcoming ? `<div style="font-size:12px;color:var(--orange);font-weight:600">${fmtDate(upcoming.validityEnd)}</div>` : `<div style="font-size:12px;color:var(--muted)">—</div>`}
      </td>
      <td><div style="font-weight:700;font-size:14px;color:var(--accent2)">${fmt(totalEarning)}</div></td>
      <td style="text-align:center" onclick="event.stopPropagation()">
        <button class="act-btn edit" onclick="openClientDetail(${keyEsc})" title="Ver histórico">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('');
}

function openClientDetail(clientName) {
  const groups = getClientGroups();
  const group = groups.find(g => g.id === clientName);
  if (!group) return;

  _currentDetailClient = group.id;

  const sorted = [...group.policies].sort((a,b)=>new Date(b.validityStart||0)-new Date(a.validityStart||0));
  const totalEarning = group.policies.reduce((a,c)=>a+(c.brokerEarning||0),0);
  const activeCount = group.policies.filter(p=>getStatus(p.validityEnd).label==='Ativo').length;

  document.getElementById('cd-name').textContent = group.name;
  document.getElementById('cd-contact').innerHTML = group.contact
    ? `<a href="https://wa.me/55${group.contact.replace(/\D/g,'')}" target="_blank" style="color:var(--accent2);text-decoration:none">${escapeHTML(group.contact)}</a>`
    : 'Sem contato registrado';

  document.getElementById('cd-summary').innerHTML = `
    <div style="background:var(--surface2);border-radius:10px;padding:10px;text-align:center">
      <div style="font-size:18px;font-weight:700">${group.policies.length}</div>
      <div style="font-size:10px;color:var(--muted);margin-top:2px">Apólices</div>
    </div>
    <div style="background:var(--surface2);border-radius:10px;padding:10px;text-align:center">
      <div style="font-size:18px;font-weight:700;color:var(--green)">${activeCount}</div>
      <div style="font-size:10px;color:var(--muted);margin-top:2px">Ativas</div>
    </div>
    <div style="background:var(--surface2);border-radius:10px;padding:10px;text-align:center">
      <div style="font-size:15px;font-weight:700;color:var(--accent2)">${fmt(totalEarning)}</div>
      <div style="font-size:10px;color:var(--muted);margin-top:2px">Total Ganho</div>
    </div>
  `;

  document.getElementById('cd-policies').innerHTML = sorted.map(p=>{
    const s = getStatus(p.validityEnd);
    const showReminder = (s.label==='A Vencer' || s.label==='Vencido') && group.contact;
    return `<div style="background:var(--surface2);border-radius:10px;padding:11px 13px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:13px;font-weight:600">${escapeHTML(p.insurer||'—')} · ${escapeHTML(p.vehicleModel||'')}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:3px">${fmtDate(p.validityStart)} até ${fmtDate(p.validityEnd)}</div>
        </div>
        ${pillHTML(s)}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
        <div style="font-size:11px;color:${isPaid(p.commissionStatus)?'var(--green)':'var(--orange)'};font-weight:600">${escapeHTML(p.commissionStatus)}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="font-size:13px;font-weight:700;color:var(--accent2)">${fmt(p.brokerEarning)}</div>
          ${showReminder ? `<button onclick="sendRenewalReminder(${jsArgument(p.id)})" title="Enviar lembrete por WhatsApp"
            style="background:rgba(34,211,165,.12);border:none;color:var(--green);cursor:pointer;width:26px;height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .14s"
            onmouseenter="this.style.background='rgba(34,211,165,.22)'" onmouseleave="this.style.background='rgba(34,211,165,.12)'">
            <svg style="width:13px;height:13px" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.44.79 3.07 1.2 4.74 1.2 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm5.8 14.07c-.24.68-1.42 1.3-1.96 1.38-.5.08-1.13.11-1.83-.12-.42-.13-.96-.31-1.65-.6-2.9-1.25-4.79-4.17-4.94-4.36-.14-.2-1.18-1.57-1.18-3 0-1.42.75-2.12 1.01-2.41.27-.29.58-.36.78-.36.19 0 .39 0 .56.01.18.01.42-.07.65.5.24.58.82 2 .89 2.15.07.15.12.32.02.52-.1.2-.15.32-.3.49-.15.17-.31.39-.45.52-.15.15-.3.31-.13.6.17.3.77 1.27 1.65 2.06 1.13 1.01 2.09 1.32 2.38 1.47.29.15.46.13.63-.08.17-.2.71-.83.9-1.12.19-.29.38-.24.64-.14.26.1 1.65.78 1.94.92.28.14.47.21.54.32.07.12.07.68-.17 1.36z"/></svg>
          </button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  showDialog('client-detail-overlay');
  document.getElementById('cd-note-form').style.display = 'none';
  document.getElementById('cd-note-input').value = '';
  loadClientNotes(group.id);
}

function closeClientDetail() {
  hideDialog('client-detail-overlay');
  _currentDetailClient = null;
}

/* ── OBSERVAÇÕES DE CLIENTES ── */
let _currentDetailClient = null;
let _clientNotes = [];

async function loadClientNotes(clientId) {
  _clientNotes=localNotes.filter(n=>n.client_id===clientId || (!n.client_id && getClientGroups().filter(g=>g.name===n.client_name).length===1 && getClientGroups().find(g=>g.id===clientId)?.name===n.client_name));
  renderClientNotes();
}

function renderClientNotes() {
  const notesList = document.getElementById('cd-notes-list');
  if (!notesList) return;
  if (!_clientNotes.length) {
    notesList.innerHTML = `<div style="font-size:12px;color:var(--muted);text-align:center;padding:8px 0">Nenhuma observação ainda.</div>`;
    return;
  }
  notesList.innerHTML = _clientNotes.map(n => {
    const date = new Date(n.created_at).toLocaleDateString('pt-BR');
    return `<div style="background:var(--surface2);border-radius:10px;padding:10px 12px;position:relative">
      <div style="font-size:13px;color:var(--text);line-height:1.5;white-space:pre-wrap">${escapeHTML(n.note)}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
        <div style="font-size:10px;color:var(--muted)">${date}</div>
        <button onclick="deleteClientNote(${jsArgument(n.id)})" title="Excluir observação"
          style="background:none;border:none;color:var(--muted);cursor:pointer;padding:2px;border-radius:5px;display:flex;transition:color .14s"
          onmouseenter="this.style.color='var(--red)'" onmouseleave="this.style.color='var(--muted)'">
          <svg style="width:12px;height:12px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

function addClientNote() {
  document.getElementById('cd-note-form').style.display = 'block';
  document.getElementById('cd-note-input').focus();
}

function cancelClientNote() {
  document.getElementById('cd-note-form').style.display = 'none';
  document.getElementById('cd-note-input').value = '';
}

async function saveClientNote() {
  const note=document.getElementById('cd-note-input').value.trim();
  const group=getClientGroups().find(g=>g.id===_currentDetailClient);
  if(!note||!group)return;
  const saved=await commitOperation('client_notes','upsert',{id:crypto.randomUUID(),client_id:group.id,client_name:group.name,note,created_at:Date.now(),updated_at:Date.now()});
  if(saved){cancelClientNote();loadClientNotes(group.id);}
}

async function deleteClientNote(id) {openModal('Excluir esta observação?',async()=>{await commitOperation('client_notes','delete',{id});if(_currentDetailClient)loadClientNotes(_currentDetailClient);});}

/* ── CASHFLOW ── */
let cashflowMonth = new Date().getMonth();
let cashflowYear  = new Date().getFullYear();

function getCashflowYearRange() {
  const allDates = [
    ...policies.map(p=>p.validityStart).filter(Boolean),
    ...expenses.map(e=>e.date).filter(Boolean)
  ].map(d=>parseInt(d.split('-')[0]));
  const today = new Date();
  let minY = today.getFullYear(), maxY = today.getFullYear();
  allDates.forEach(y=>{ if(y<minY) minY=y; if(y>maxY) maxY=y; });
  return {minY, maxY};
}

function populateCashflowMonthSelect() {
  const monthSel = document.getElementById('cashflow-month-only-select');
  const yearSel  = document.getElementById('cashflow-year-only-select');
  if (!monthSel || !yearSel) return;

  // Popula meses (sempre os 12, sem filtrar — mês é independente do ano escolhido)
  if (!monthSel.dataset.filled) {
    monthSel.innerHTML = MESES_PT.map((nome,i)=>`<option value="${i}">${nome}</option>`).join('');
    monthSel.dataset.filled = '1';
  }
  monthSel.value = cashflowMonth;

  // Popula anos com base no intervalo real de dados
  const {minY, maxY} = getCashflowYearRange();
  const yearsKey = `${minY}-${maxY}`;
  if (yearSel.dataset.range !== yearsKey) {
    const opts = [];
    for (let y=maxY; y>=minY; y--) opts.push(`<option value="${y}">${y}</option>`);
    yearSel.innerHTML = opts.join('');
    yearSel.dataset.range = yearsKey;
  }
  yearSel.value = cashflowYear;
}

function onCashflowMonthOnlySelect() {
  const sel = document.getElementById('cashflow-month-only-select');
  cashflowMonth = parseInt(sel.value);
  renderCashflow();
}

function onCashflowYearOnlySelect() {
  const sel = document.getElementById('cashflow-year-only-select');
  cashflowYear = parseInt(sel.value);
  renderCashflow();
}

function changeCashflowMonth(delta) {
  cashflowMonth += delta;
  if (cashflowMonth > 11) { cashflowMonth = 0; cashflowYear++; }
  if (cashflowMonth < 0)  { cashflowMonth = 11; cashflowYear--; }
  renderCashflow();
}

function resetCashflowMonth() {
  const today = new Date();
  cashflowMonth = today.getMonth();
  cashflowYear = today.getFullYear();
  renderCashflow();
}

function isInCashflowMonth(dateStr) {
  if (!dateStr) return false;
  const [y,m] = dateStr.split('-').map(Number);
  return y===cashflowYear && (m-1)===cashflowMonth;
}

function renderCashflow() {
  populateCashflowMonthSelect();

  const policiesInMonth = policies.filter(p=>isInCashflowMonth(expectedReceiptDate(p)));
  const expensesInMonth = expenses.filter(e=>isInCashflowMonth(e.date));

  const paidEarnings = receiptsInPeriod(policies,isInCashflowMonth);
  const pendingEarnings= policiesInMonth.filter(p=>p.commissionStatus==='Pendente').reduce((a,c)=>a+remainingCommission(c),0);
  const totalExp       = expensesInMonth.reduce((a,c)=>a+c.amount,0);
  const netProfit      = paidEarnings - totalExp;

  // KPIs
  document.getElementById('cash-kpis').innerHTML = [
    { label:'Ganhos Recebidos', value:fmt(paidEarnings),    color:'var(--green)',  bg:'rgba(34,211,165,.07)' },
    { label:'A Receber',        value:fmt(pendingEarnings), color:'var(--orange)', bg:'rgba(249,115,22,.07)' },
    { label:'Despesas Pagas',   value:fmt(totalExp),        color:'var(--red)',    bg:'rgba(244,63,94,.07)' },
    { label:'Saldo de caixa',    value:fmt(netProfit),       color:netProfit>=0?'var(--green)':'var(--red)', accent:true },
  ].map(c=>`
    <div class="stat-card${c.accent?' accent':''}" style="${c.accent?'':'background:'+c.bg+';border:1px solid '+c.color+'22'}">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:${c.accent?'rgba(167,139,250,.55)':c.color};opacity:${c.accent?1:.75}">${c.label}</div>
      <div class="stat-value" style="color:${c.color};font-size:18px">${c.value}</div>
    </div>`).join('');

  // A seleção de recebimentos tem filtros próprios, independentes dos indicadores mensais.
  renderFinanceCommissions();

  /* ═══ Evolução 12 meses (receita vs despesa) ═══ */
  const evoLabels = [], evoReceita = [], evoDespesa = [];
  for (let i=11; i>=0; i--) {
    let m = cashflowMonth - i, y = cashflowYear;
    while (m < 0) { m += 12; y--; }
    evoLabels.push(`${MESES_PT[m]}/${String(y).slice(2)}`);
    const polsDoMes = policies.filter(p=>{
      if (!p.validityStart) return false;
      const [py,pm] = p.validityStart.split('-').map(Number);
      return py===y && (pm-1)===m;
    });
    const expsDoMes = expenses.filter(e=>{
      if (!e.date) return false;
      const [ey,em] = e.date.split('-').map(Number);
      return ey===y && (em-1)===m;
    });
    evoReceita.push(receiptsInPeriod(policies,date=>{const [ry,rm]=date.split('-').map(Number);return ry===y&&rm===m+1;}));
    evoDespesa.push(expsDoMes.reduce((a,c)=>a+c.amount,0));
  }
  destroyChart('evolucao');
  const ctxEvo = document.getElementById('chart-evolucao');
  if (ctxEvo) {
    _charts.evolucao = new Chart(ctxEvo, {
      type:'line',
      data:{ labels: evoLabels,
        datasets:[
          { label:'Receita', data:evoReceita, borderColor:'#22d3a5', backgroundColor:'rgba(34,211,165,.1)', fill:true, tension:.3 },
          { label:'Despesa', data:evoDespesa, borderColor:'#f43f5e', backgroundColor:'rgba(244,63,94,.1)', fill:true, tension:.3 }
        ]},
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ display:true, position:'top', labels:{ color:themeColor('text'), boxWidth:11, font:{size:11} } } },
        scales:{ y:{ beginAtZero:true, ticks:{ color:themeColor('text') }, grid:{color:themeColor('grid')} },
                 x:{ ticks:{ color:themeColor('text'), font:{size:10.5} }, grid:{display:false} } } }
    });
  }

  /* ═══ Despesas por categoria (mês selecionado) ═══ */
  const catColors = { 'Divulgação':'#6c63ff', 'Instagram':'#f43f5e', 'Campanhas':'#f97316', 'Impresso':'#22d3a5', 'Outros':'#888780' };
  const byCategory = Object.create(null);
  expensesInMonth.forEach(e=>{ const c=e.category||'Outros'; byCategory[c]=(byCategory[c]||0)+e.amount; });
  const catLabels = Object.keys(byCategory);
  const catValues = Object.values(byCategory);
  destroyChart('categorias');
  const ctxCat = document.getElementById('chart-categorias');
  const legendEl = document.getElementById('categorias-legend');
  if (ctxCat) {
    if (catLabels.length) {
      _charts.categorias = new Chart(ctxCat, {
        type:'doughnut',
        data:{ labels: catLabels, datasets:[{ data: catValues, backgroundColor: catLabels.map(c=>catColors[c]||'#888780') }] },
        options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } } }
      });
      if (legendEl) {
        const total = catValues.reduce((a,b)=>a+b,0);
        legendEl.innerHTML = catLabels.map((c,i)=>{
          const pct = total>0 ? Math.round(catValues[i]/total*100) : 0;
          return `<span style="display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--muted2)">
            <span style="width:9px;height:9px;border-radius:3px;background:${catColors[c]||'#888780'}"></span>
            ${escapeHTML(c)} <span style="color:var(--muted)">${pct}%</span>
          </span>`;
        }).join('');
      }
    } else if (legendEl) {
      legendEl.innerHTML = '';
    }
  }

  /* ═══ A Receber por prazo (tempo desde a venda) ═══ */
  const todayCF = new Date(); todayCF.setHours(0,0,0,0);
  const allPendingGlobal = policies.filter(p=>p.commissionStatus==='Pendente');
  const todayString=localDate(todayCF);
  const future=new Date(todayCF);future.setDate(future.getDate()+30);
  const next30=allPendingGlobal.filter(p=>expectedReceiptDate(p)>=todayString&&expectedReceiptDate(p)<=localDate(future));
  const overdue=allPendingGlobal.filter(p=>expectedReceiptDate(p)&&expectedReceiptDate(p)<todayString);
  const sumEarning=arr=>arr.reduce((a,c)=>a+remainingCommission(c),0);
  const receberPrazoEl = document.getElementById('receber-prazo');
  if (receberPrazoEl) {
    receberPrazoEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(249,115,22,.07);border:1px solid rgba(249,115,22,.15);border-radius:10px;padding:12px 14px">
        <div>
          <div style="font-size:12px;font-weight:600;color:var(--orange)">Previsto nos próximos 30 dias</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${next30.length} comiss${next30.length===1?'ão':'ões'}</div>
        </div>
        <div style="font-size:17px;font-weight:700;color:var(--orange)">${fmt(sumEarning(next30))}</div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(244,63,94,.07);border:1px solid rgba(244,63,94,.15);border-radius:10px;padding:12px 14px">
        <div>
          <div style="font-size:12px;font-weight:600;color:var(--red)">Previsão vencida</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${overdue.length} comiss${overdue.length===1?'ão':'ões'}</div>
        </div>
        <div style="font-size:17px;font-weight:700;color:var(--red)">${fmt(sumEarning(overdue))}</div>
      </div>
    `;
  }

  // Expenses (do mês selecionado)
  document.getElementById('expense-badge').textContent = expensesInMonth.length;
  document.getElementById('expense-list').innerHTML = expensesInMonth.length
    ? expensesInMonth.map(exp=>`
      <div class="pending-item">
        <div>
          <div style="font-size:13px;font-weight:600">${escapeHTML(exp.description)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:1px;display:flex;align-items:center;gap:6px">
            <span>${fmtDate(exp.date)}</span>
            ${exp.category ? `<span style="background:var(--surface2);padding:1px 7px;border-radius:99px;font-size:10px;font-weight:600;color:var(--muted2)">${escapeHTML(exp.category)}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:9px">
          <span style="font-size:13px;font-weight:700;color:var(--red)">-${fmt(exp.amount)}</span>
          <button onclick="deleteExpense(${jsArgument(exp.id)})"
            style="background:none;border:none;color:var(--muted);cursor:pointer;padding:4px;border-radius:6px;display:flex;transition:color .14s"
            onmouseenter="this.style.color='var(--red)'" onmouseleave="this.style.color='var(--muted)'" title="Excluir">
            <svg style="width:13px;height:13px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>`).join('')
    : `<div class="empty-state" style="padding:28px 0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>Nenhuma despesa registrada</span>
      </div>`;
}

