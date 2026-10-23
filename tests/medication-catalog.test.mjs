import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMedicationCatalog } from '../lib/medication-catalog.ts';
const row = id => ({id, name:`Medicamento sintético ${id}`, dosage:'Somente teste', reference_url:null});
const response = data => Promise.resolve({data,error:null});
const unused = () => {throw new Error('consulta desnecessária');};

test('cadastro carregado independe de falhas nas rotinas',async()=>{
 const rows=Array.from({length:7},(_,i)=>row(String(i)));
 assert.deepEqual(await readMedicationCatalog({all:()=>response(rows),links:unused,byIds:unused}),{rows,recoveredFromLinks:false});
});
test('cadastro vazio só é confirmado depois da consulta de vínculos vazia',async()=>{
 assert.deepEqual(await readMedicationCatalog({all:()=>response([]),links:()=>response([]),byIds:unused}),{rows:[],recoveredFromLinks:false});
});
test('vínculos existentes recuperam o cadastro por IDs sem duplicar medicamentos',async()=>{
 let received;
 const rows=[row('a'),row('b')];
 const result=await readMedicationCatalog({all:()=>response([]),links:()=>response(['a','b','a']),byIds:ids=>{received=ids;return response(rows);}});
 assert.deepEqual(received,['a','b']);assert.deepEqual(result,{rows,recoveredFromLinks:true});
});
test('vínculo sem medicamento legível produz erro em vez de falso cadastro vazio',async()=>{
 await assert.rejects(readMedicationCatalog({all:()=>response([]),links:()=>response(['a']),byIds:()=>response([])}),/catalog-incomplete/);
});
test('resultado parcial da recuperação não é tratado como cadastro completo',async()=>{
 await assert.rejects(readMedicationCatalog({all:()=>response([]),links:()=>response(['a','b']),byIds:()=>response([row('a')])}),/catalog-incomplete/);
});
test('falha da consulta não vira lista vazia nem tenta contornar permissões',async()=>{
 await assert.rejects(readMedicationCatalog({all:()=>Promise.resolve({data:null,error:{code:'42501'}}),links:unused,byIds:unused}),/catalog-read/);
});
test('resposta nula ou formato inválido não confirma ausência de dados',async()=>{
 for(const data of [null,{},[{}]]) await assert.rejects(readMedicationCatalog({all:()=>response(data),links:unused,byIds:unused}));
});
test('falha ao conferir vínculos impede uma conclusão falsa de cadastro vazio',async()=>{
 await assert.rejects(readMedicationCatalog({all:()=>response([]),links:()=>Promise.resolve({data:null,error:{code:'503'}}),byIds:unused}),/catalog-links/);
});
