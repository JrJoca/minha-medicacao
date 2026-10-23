import assert from "node:assert/strict";
import {test} from "node:test";
import {forecastStock} from "../lib/stock-forecast.ts";
import {parsePurchase} from "../lib/inventory.ts";
const today=new Date(2026,9,22,7);
const r=(overrides={})=>({id:"r1",medicineIds:["m1"],doses:{m1:{quantity:"2",unit:"tablet"}},time:"08:00",paused:false,archivedAt:null,stockTracking:true,frequencyKind:"daily",noEndDate:true,currentDay:1,totalDays:null,taken:false,takenAt:null,...overrides});
const f=(quantity=10,routines=[r()],unit="tablet")=>forecastStock("m1",quantity,unit,routines,today);
const date=(day,hour)=>new Date(2026,9,day,hour).getTime();
test("10 comprimidos com dose 2 cobrem cinco tomadas; informa a primeira falta",()=>{
 const result=f();assert.equal(result.dailyQuantity,2);assert.equal(result.lastCovered.getTime(),date(26,8));assert.equal(result.firstUncovered.getTime(),date(27,8));
});
test("quantidades das duas rotinas ativas são somadas; pausadas e arquivadas não contam",()=>{
 const result=f(10,[r({doses:{m1:{quantity:"1",unit:"tablet"}}}),r({id:"r2",time:"20:00",doses:{m1:{quantity:"1",unit:"tablet"}}}),r({paused:true}),r({archivedAt:"2026-10-01"})]);
 assert.equal(result.dailyQuantity,2);assert.equal(result.lastCovered.getTime(),date(26,20));assert.equal(result.firstUncovered.getTime(),date(27,8));
});
test("dose confirmada hoje não é descontada duas vezes na projeção",()=>{
 const result=f(8,[r({taken:true,takenAt:new Date(2026,9,22,8).toISOString()})]);
 assert.equal(result.lastCovered.getTime(),date(26,8));assert.equal(result.firstUncovered.getTime(),date(27,8));
});
test("confirmação de ontem não elimina a dose pendente de hoje",()=>{
 assert.equal(f(0,[r({taken:true,takenAt:new Date(2026,9,21,8).toISOString()})]).firstUncovered.getTime(),date(22,8));
});
test("ml e frações usam precisão decimal sem conversão de unidade",()=>{
 const result=f(5,[r({doses:{m1:{quantity:"1,001",unit:"ml"}}})],"ml");
 assert.equal(result.lastCovered.getTime(),date(25,8));assert.equal(result.firstUncovered.getTime(),date(26,8));
});
test("tratamento limitado não prevê falta depois do término configurado",()=>{
 const result=f(10,[r({noEndDate:false,currentDay:1,totalDays:3})]);assert.equal(result.state,"covered");assert.equal(result.lastCovered.getTime(),date(24,8));assert.equal(result.firstUncovered,null);
});
test("projeção reduz consumo quando uma das rotinas chega ao fim",()=>{
 const result=f(10,[r({id:"finite",noEndDate:false,totalDays:2}),r({id:"continuous",time:"20:00"})]);
 assert.equal(result.lastCovered.getTime(),date(24,20));assert.equal(result.firstUncovered.getTime(),date(25,20));
});
test("configurações incompletas e frequência não diária não produzem datas inventadas",()=>{
 for(const routines of [[r({stockTracking:false})],[r({frequencyKind:"other"})],[r({doses:{m1:{quantity:"",unit:"tablet"}}})],[r({doses:{m1:{quantity:"2",unit:"ml"}}})]])assert.equal(f(10,routines).state,"missing_doses");
 assert.equal(f(null).state,"missing_balance");assert.equal(f(10,[]).state,"no_routines");
});
test("saldo negativo indica falta na próxima tomada sem gerar data inválida",()=>{
 assert.equal(f(-1).firstUncovered.getTime(),date(22,8));
});
test("estoque enorme termina em resposta limitada, sem iterar trilhões de dias",()=>{
 assert.equal(f(999999999,[r({doses:{m1:{quantity:"0.001",unit:"tablet"}}})]).state,"out_of_range");
});
const draft={quantity:"30",purchased_on:"2026-10-22",pharmacy:" Farmácia teste ",reference_url:""};
test("compra valida vírgula, data local, farmácia e link opcional",()=>{
 assert.deepEqual(parsePurchase({...draft,quantity:"2,5"},"2026-10-22"),{quantity:2.5,purchased_on:"2026-10-22",pharmacy:"Farmácia teste",reference_url:null});
 assert.equal(parsePurchase({...draft,reference_url:"https://example.invalid"},"2026-10-22").reference_url,"https://example.invalid/");
});
test("compra não aceita data inexistente/futura, vazio, link executável ou credenciais",()=>{
 for(const change of [{quantity:""},{quantity:"0"},{purchased_on:"2026-02-30"},{purchased_on:"2026-10-23"},{pharmacy:" "},{reference_url:"javascript:alert(1)"},{reference_url:"https://user:secret@example.invalid/"}])assert.throws(()=>parsePurchase({...draft,...change},"2026-10-22"));
});
