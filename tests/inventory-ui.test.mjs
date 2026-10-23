import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseQuantity,normalizeInventory,unitLabel} from '../lib/inventory.ts';
test('quantidades explícitas aceitam frações e vírgula, preservando desconhecido e zero',()=>{assert.equal(parseQuantity(''),null);assert.equal(parseQuantity('0'),0);assert.equal(parseQuantity('0,5',true),.5);assert.equal(parseQuantity('2.125',true),2.125);for(const x of ['-1','0','1.0001','1e3','NaN']) assert.throws(()=>parseQuantity(x,true));});
test('normalização mantém null e converte números decimais da API',()=>{const row=normalizeInventory({quantity:'10.5',daily_quantity:'2.5',quantity_per_package:null,estimated_days:'4.2',full_days_covered:'4'});assert.equal(row.quantity,10.5);assert.equal(row.quantity_per_package,null);assert.equal(row.full_days_covered,4);assert.equal(unitLabel('ml'),'ml');});
