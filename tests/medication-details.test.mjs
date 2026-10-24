import assert from "node:assert/strict";
import {test} from "node:test";
import {parseMedicationDetails} from "../lib/medication-details.ts";
import {parsePurchaseCorrection,normalizePurchase} from "../lib/inventory.ts";

test("edição conserva dosagem textual e link, removendo apenas espaços externos",()=>{
 assert.deepEqual(parseMedicationDetails({name:" Medicamento ",dosage:" 600 mg • apresentação original ",link:" https://example.invalid/referencia?q=1 "}),
  {name:"Medicamento",dosage:"600 mg • apresentação original",reference_url:"https://example.invalid/referencia?q=1"});
});
test("nome e dosagem em branco são rejeitados antes de salvar",()=>{
 for(const draft of [{name:" ",dosage:"600 mg",link:""},{name:"Medicamento",dosage:" ",link:""}])assert.throws(()=>parseMedicationDetails(draft));
});
test("limite de nome acompanha caracteres Unicode do banco",()=>{
 const name="💊".repeat(120);assert.equal(parseMedicationDetails({name,dosage:"Texto",link:""}).name,name);
 assert.throws(()=>parseMedicationDetails({name:name+"x",dosage:"Texto",link:""}),/120/);
});
test("link opcional pode ser removido; http e https permanecem aceitos",()=>{
 for(const link of [""," ","http://example.invalid","https://example.invalid/teste#secao"]){
  assert.equal(parseMedicationDetails({name:"Medicamento",dosage:"Texto",link}).reference_url,link.trim()||null);
 }
});
test("links executáveis, credenciais e endereços inválidos não são gravados",()=>{
 for(const link of ["javascript:alert(1)","data:text/html,test","ftp://example.invalid","https://user:password@example.invalid/","endereço inválido"]){
  assert.throws(()=>parseMedicationDetails({name:"Medicamento",dosage:"Texto",link}));
 }
});
test("correção valida quantidade, campos de compra e motivo",()=>{
 const draft={quantity:"12,5",purchased_on:"2026-01-01",pharmacy:"Farmácia",reference_url:"",reason:" Quantidade corrigida "};
 assert.equal(parsePurchaseCorrection(draft,"2026-10-24").quantity,12.5);
 assert.equal(parsePurchaseCorrection(draft,"2026-10-24").reason,"Quantidade corrigida");
 for(const change of [{reason:" "},{reason:"a".repeat(501)},{quantity:"0"},{purchased_on:"2099-01-01"}])assert.throws(()=>parsePurchaseCorrection({...draft,...change},"2026-10-24"));
});
test("revisão da compra mantém precisão para controle de concorrência",()=>{
 assert.equal(normalizePurchase({quantity:"1.5",revision:"9007199254740993"}).revision,"9007199254740993");
 assert.equal(normalizePurchase({quantity:"1.5",revision:0}).revision,"0");
 assert.equal(normalizePurchase({quantity:"1.5"}).revision,undefined);
});
