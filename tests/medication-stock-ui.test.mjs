import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateStock, formatStockDuration, formatStockQuantity, normalizeStock, parseStockDraft, stockDraft } from '../lib/medication-stock.ts';

const draft = (total='',box='',daily='') => ({total_tablets:total,tablets_per_box:box,tablets_per_day:daily});

test('campos vazios permanecem desconhecidos e não viram zero',()=>{
  assert.deepEqual(parseStockDraft(draft()).values,{total_tablets:null,tablets_per_box:null,tablets_per_day:null});
  assert.equal(parseStockDraft(draft()).valid,true);
  assert.equal(estimateStock(parseStockDraft(draft()).values).estimated_days,null);
  assert.equal(formatStockDuration(null),'Sem previsão');
  assert.equal(formatStockQuantity(null),'Não informado');
});

test('10 comprimidos a 2 ao dia mostram 5 dias sem multiplicar pelo tamanho da caixa',()=>{
  const parsed=parseStockDraft(draft('10','30','2'));
  assert.equal(parsed.valid,true);
  assert.deepEqual(estimateStock(parsed.values),{estimated_days:5,full_days_covered:5});
  assert.equal(formatStockDuration(5),'5 dias');
});

test('saldo zerado é preservado ao abrir o formulário e produz zero dias',()=>{
  const values=parseStockDraft(draft('0','30','2')).values;
  assert.equal(stockDraft({...values,medication_id:'fixture',user_id:'fixture',estimated_days:0,full_days_covered:0}).total_tablets,'0');
  assert.equal(estimateStock(values).estimated_days,0);
  assert.equal(formatStockDuration(0),'0 dias');
});

test('previsão parcial usa formato brasileiro e distingue dias completos',()=>{
  const result=estimateStock(parseStockDraft(draft('10','','3')).values);
  assert.equal(result.full_days_covered,3);
  assert.equal(formatStockDuration(result.estimated_days),'Aprox. 3,33 dias');
  assert.equal(formatStockDuration(0.5),'Menos de 1 dia');
  assert.equal(formatStockDuration(1),'1 dia');
});

test('consumo ou saldo não informado não fabrica previsão',()=>{
  for(const form of [draft('10'),draft('','','2')]) assert.equal(estimateStock(parseStockDraft(form).values).estimated_days,null);
});

test('recusa negativos, frações, consumo zero, notação científica e valores acima do PostgreSQL integer',()=>{
  for(const value of ['-1','1.5','2,5','NaN','Infinity','1e2','2147483648','9007199254740993']) {
    assert.equal(parseStockDraft(draft(value)).valid,false,value);
  }
  assert.equal(parseStockDraft(draft('10','0','2')).valid,false);
  assert.equal(parseStockDraft(draft('10','30','0')).valid,false);
  assert.equal(parseStockDraft(draft('2147483647','','1')).valid,true);
});

test('limpar um campo salva NULL e valores preenchidos mantêm inteiros',()=>{
  const result=parseStockDraft(draft(' 10 ','',' 2 '));
  assert.equal(result.valid,true);
  assert.deepEqual(result.values,{total_tablets:10,tablets_per_box:null,tablets_per_day:2});
});

test('normaliza resultado numérico ou textual do Neon e recusa previsão inválida',()=>{
  const row={medication_id:'fixture',user_id:'fixture',total_tablets:10,tablets_per_box:30,tablets_per_day:2,estimated_days:'5.0000',full_days_covered:5};
  assert.equal(normalizeStock(row).estimated_days,5);
  assert.equal(normalizeStock({...row,estimated_days:null}).estimated_days,null);
  assert.throws(()=>normalizeStock({...row,estimated_days:'not-a-number'}));
});
