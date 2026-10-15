/* Persistência isolada por conta, com fila durável e operações idempotentes. */
let accountId = null;
let syncing = false;
let loading = false;
let refreshAgain = false;
let pendingOps = [];
let dataRevision = 0;
let localNotes = [];
let clientRegistry = [];
let preferences = { commissionRules: [], brokerName: 'Gutierre Seguros' };
const storageKey = key => 'cp_v3:' + accountId + ':' + key;
function readScoped(key, fallback) {
  if (!accountId) return fallback;
  try { const value = localStorage.getItem(storageKey(key)); return value === null ? fallback : JSON.parse(value); }
  catch { showNotif('Não foi possível ler o cache. Restaure um backup se necessário.', 'error'); return fallback; }
}
function writeScoped(key, value) {
  if (!accountId) throw new Error('Entre na sua conta antes de salvar.');
  localStorage.setItem(storageKey(key), JSON.stringify(value));
}
function syncStatus(message) {
  const el = document.getElementById('sync-status');
  if (el) el.textContent = message || (pendingOps.length ? pendingOps.length + ' alteração(ões) aguardando sincronização' : 'Dados sincronizados');
}
function hydrateAccount(id) {
  accountId = id; dataRevision++;
  clearCommissionSelection();
  policies = readScoped('policies', []);
  expenses = readScoped('expenses', []);
  localNotes = readScoped('notes', []);
  clientRegistry = readScoped('clients', []);
  pendingOps = readScoped('queue', []);
  pendingOps.forEach(op=>applyOperation(op,{policies,expenses,notes:localNotes}));
  preferences = readScoped('preferences', {commissionRules: [{insurer:'Ative Motos',amount:50},{insurer:'Ativo',amount:50},{insurer:'Suhai',amount:10},{insurer:'Tokio',amount:35},{insurer:'Allianz',amount:35},{insurer:'Porto',amount:35}], brokerName: 'Gutierre Seguros'});
  syncStatus();
}
function applyOperation(op, collections) {
  const key = {policies:'policies', expenses:'expenses', client_notes:'notes'}[op.table];
  const list = collections[key];
  const idx = list.findIndex(row => row.id === op.id);
  if (op.kind === 'delete') { if (idx >= 0) list.splice(idx, 1); }
  else if (idx >= 0) list[idx] = {...list[idx], ...op.record};
  else list.unshift(op.record);
}
async function commitOperation(table, kind, record) {
  if (!accountId) { showNotif('Entre na sua conta para salvar.', 'error'); return false; }
  const op = {opId:crypto.randomUUID(), table, kind, id:record.id, record, owner:accountId};
  try { writeScoped('queue', [...pendingOps, op]); }
  catch { showNotif('Armazenamento cheio ou indisponível. Nada foi salvo. Exporte um backup.', 'error'); return false; }
  pendingOps.push(op); dataRevision++;
  applyOperation(op, {policies, expenses, notes:localNotes});
  try { saveLS(LS_KEY_POLICIES, policies); saveLS(LS_KEY_EXPENSES, expenses); writeScoped('notes', localNotes); }
  catch { /* A fila durável preserva a operação para recuperação. */ }
  syncStatus(); render();
  showNotif('Salvo neste dispositivo; aguardando sincronização.');
  await syncQueue();
  return true;
}
function databaseRecord(op) {
  if (op.table === 'policies') return {...policyToDB(op.record), id:op.id, user_id:op.owner, created_at:op.record.createdAt};
  if (op.table === 'expenses') return {id:op.id, user_id:op.owner, description:op.record.description, category:op.record.category, amount:op.record.amount, date:op.record.date, created_at:op.record.createdAt};
  return {id:op.id, user_id:op.owner, client_name:op.record.client_name, client_id:op.record.client_id, note:op.record.note, created_at:op.record.created_at, updated_at:op.record.updated_at};
}
async function syncQueue() {
  if (syncing || !accountId || !window._sb || !window._sbUser || window._sbUser.id !== accountId || !navigator.onLine) { syncStatus(); return; }
  syncing = true;
  const owner = accountId;
  try {
    while (pendingOps.length && accountId === owner) {
      const op = pendingOps[0];
      const sb = window._sb.client;
      const query = op.kind === 'delete'
        ? sb.from(op.table).delete().eq('id', op.id).eq('user_id', owner)
        : sb.from(op.table).upsert(databaseRecord(op), {onConflict:'id'});
      const {error} = await query;
      if (accountId !== owner) return;
      if (error) throw error;
      const remaining = pendingOps.filter(item => item.opId !== op.opId);
      writeScoped('queue', remaining);
      pendingOps = remaining; dataRevision++;
    }
    syncStatus();
  } catch (error) { syncStatus('Alterações pendentes. Verifique a conexão e a configuração do banco.'); console.warn('Sincronização:', error.message); }
  finally { syncing = false; }
}
async function fetchAllRows(table, orderBy, ascending) {
  const owner = accountId;
  if (!owner) throw Error('Sessão indisponível');
  let all = [];
  for (let from = 0; ; from += 1000) {
    const {data,error} = await window._sb.client.from(table).select('*').eq('user_id',owner).order(orderBy,{ascending}).order('id',{ascending:true}).range(from,from+999);
    if (error) throw error;
    if (owner !== accountId) throw Error('Conta alterada');
    all.push(...(data || []));
    if (!data || data.length < 1000) return all;
  }
}
async function loadFromSupabase() {
  if (!accountId || !window._sbUser) return;
  if (loading) { refreshAgain = true; return; }
  loading = true; syncStatus('Consultando banco e sincronizando alterações…');
  const owner = accountId;
  try {
    await syncQueue();
    const revision = dataRevision;
    const [pols, exps, notes] = await Promise.all([fetchAllRows('policies','created_at',false),fetchAllRows('expenses','date',false),fetchAllRows('client_notes','created_at',false)]);
    if (owner !== accountId) return;
    if (revision !== dataRevision) {refreshAgain=true;return;}
    const collections = {policies:pols.map(policyFromDB),expenses:exps.map(expenseFromDB),notes:notes.map(n=>({...n,client_name:n.client_name||'',note:n.note||'',created_at:Number(n.created_at)||0,updated_at:Number(n.updated_at)||Number(n.created_at)||0}))};
    pendingOps.forEach(op => applyOperation(op,collections));
    writeScoped('policies',collections.policies); writeScoped('expenses',collections.expenses); writeScoped('notes',collections.notes);
    policies = collections.policies; expenses = collections.expenses; localNotes = collections.notes;
    syncStatus(); render(); subscribeRealtime();
  } catch (error) { if (owner === accountId) syncStatus('Cache preservado. Banco indisponível ou configuração pendente.'); console.warn(error.message); }
  finally { loading = false; if (refreshAgain) {refreshAgain=false; if (accountId) setTimeout(loadFromSupabase,500);} }
}
window.addEventListener('online', () => loadFromSupabase());
setInterval(() => { if (pendingOps.length) syncQueue(); },30000);

// Persiste o lote inteiro antes de aplicar qualquer recebimento na tela.
async function commitPolicyBatch(records) {
  if (!accountId || !records.length) return false;
  const ops=records.map(record=>({opId:crypto.randomUUID(),table:'policies',kind:'upsert',id:record.id,record,owner:accountId}));
  try { writeScoped('queue',[...pendingOps,...ops]); }
  catch { showNotif('Não foi possível salvar o lote. Nenhuma comissão foi alterada.','error'); return false; }
  pendingOps.push(...ops); dataRevision++;
  ops.forEach(op=>applyOperation(op,{policies,expenses,notes:localNotes}));
  try { saveLS(LS_KEY_POLICIES,policies); } catch { /* A fila já preserva todo o lote. */ }
  syncStatus(); render();
  await syncQueue();
  return true;
}
