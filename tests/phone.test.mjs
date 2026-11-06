import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePhone} from '../lib/phone.js';
test('Thai mobile formats normalize to identical domestic digits',()=>{
 for(const value of ['0983539369','098-353-9369','098 353 9369','(098) 353.9369','+66 98 353 9369','66983539369','+66 (0)98-353-9369','0066 98 353 9369','66 098 353 9369','983539369','๐๙๘-๓๕๓-๙๓๖๙','＋６６ ９８３５３９３６９','098–353–9369'])assert.equal(normalizePhone(value),'0983539369',value);
});
test('Thai landlines and omitted zero',()=>{
 for(const value of ['02-123-4567','+66 2 123 4567','0066 (0)2 123 4567','21234567'])assert.equal(normalizePhone(value),'021234567');
});
test('explicit overseas phone retains country code',()=>{
 assert.equal(normalizePhone('+44 20 7946 0958'),'+442079460958');
 assert.equal(normalizePhone('001 (415) 555-2671'),'+14155552671');
});
test('reject malformed or ambiguous content without silently merging digits',()=>{
 for(const value of ['',null,123,'abc0983539369','+66','1234','++66983539369','0983539369 / 0812345678','0983539369 ต่อ 123','+0123456789','0983539369999',' '.repeat(101)+'0983539369'])assert.equal(normalizePhone(value),null,String(value));
});
test('normalization is idempotent',()=>{for(const value of ['0983539369','021234567','+14155552671'])assert.equal(normalizePhone(normalizePhone(value)),value)});
