import assert from 'node:assert/strict';
import {test} from 'node:test';
import {dashboardClock} from '../lib/dashboard-clock.ts';
import {readRoutineCatalog} from '../lib/routine-catalog.ts';
const tz='America/Sao_Paulo';
const routine=id=>({id,name:`Rotina ${id}`,period_description:'Todos os dias',scheduled_time:'08:00',deadline_time:'09:00',has_no_end_date:true,duration_value:null,duration_unit:null,total_days:null,current_day:1,status:'active'});
const response=data=>Promise.resolve({data,error:null});
const unused=()=>{throw new Error('consulta desnecessária');};

test('cabeçalho usa o dia de São Paulo quando UTC já está no dia seguinte',()=>{
 const clock=dashboardClock(new Date('2026-10-23T01:30:00Z'),tz);
 assert.equal(clock.dayKey,'2026-10-22');assert.match(clock.label,/quinta-feira/);assert.match(clock.label,/22 de outubro de 2026/);assert.equal(clock.greeting,'Boa noite');assert.equal(clock.minutes,22*60+30);
});
test('data atualiza corretamente na virada do dia, mês e ano',()=>{
 assert.equal(dashboardClock(new Date('2027-01-01T02:59:59Z'),tz).dayKey,'2026-12-31');
 assert.equal(dashboardClock(new Date('2027-01-01T03:00:00Z'),tz).dayKey,'2027-01-01');
 assert.match(dashboardClock(new Date('2027-01-01T03:00:00Z'),tz).label,/1 de janeiro de 2027/);
});
test('saudação acompanha manhã, tarde e noite no mesmo fuso da data',()=>{
 for(const [at,greeting] of [['2026-10-22T14:59:00Z','Bom dia'],['2026-10-22T15:00:00Z','Boa tarde'],['2026-10-22T21:00:00Z','Boa noite']]) assert.equal(dashboardClock(new Date(at),tz).greeting,greeting);
});
test('fuso do dispositivo pode ter dia diferente sem alterar o instante',()=>{
 const date=new Date('2026-10-23T01:00:00Z');assert.equal(dashboardClock(date,'UTC').dayKey,'2026-10-23');assert.equal(dashboardClock(date,tz).dayKey,'2026-10-22');
});
test('duas rotinas carregam sem depender da consulta de vínculos ou tomadas',async()=>{
 const rows=[routine('a'),routine('b')];assert.deepEqual(await readRoutineCatalog({all:()=>response(rows),links:unused,byIds:unused}),{rows,recoveredFromLinks:false});
});
test('rotinas vazias com vínculos conhecidos são recuperadas pelos IDs',async()=>{
 const rows=[routine('a'),routine('b')];let received;
 const result=await readRoutineCatalog({all:()=>response([]),links:()=>response(['a','b','a']),byIds:ids=>{received=ids;return response(rows);}});
 assert.deepEqual(received,['a','b']);assert.deepEqual(result,{rows,recoveredFromLinks:true});
});
test('ausência de rotinas só é confirmada quando também não há vínculos',async()=>{
 assert.deepEqual(await readRoutineCatalog({all:()=>response([]),links:()=>response([]),byIds:unused}),{rows:[],recoveredFromLinks:false});
});
test('rotina vinculada não legível gera erro e não contador zero',async()=>{
 await assert.rejects(readRoutineCatalog({all:()=>response([]),links:()=>response(['a']),byIds:()=>response([])}),/routine-incomplete/);
});
test('erro de permissão e resposta inválida não são cadastro vazio',async()=>{
 for(const result of [{data:null,error:{code:'42501'}},{data:null,error:null},{data:[{}],error:null}]) await assert.rejects(readRoutineCatalog({all:()=>Promise.resolve(result),links:unused,byIds:unused}));
});
test('falha de vínculos não confirma ausência de rotinas',async()=>{
 await assert.rejects(readRoutineCatalog({all:()=>response([]),links:()=>Promise.resolve({data:null,error:{code:'503'}}),byIds:unused}),/routine-links/);
});
