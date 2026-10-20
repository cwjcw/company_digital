import { beforeEach,describe,expect,it } from 'vitest';
import { ensureTableFieldVisibleOnce } from '../../shared/KdosDataTable';

beforeEach(()=>localStorage.clear());
describe('finance remark view upgrade',()=>{
 it('restores an omitted remark once, preserving all other saved columns and later user choices',()=>{
  localStorage.setItem('sessionUser',JSON.stringify({sub:'u',tenantId:'T'}));
  const key='kdos-form-view:T:u:finance-e10-lines';
  localStorage.setItem(key,JSON.stringify(['orderNo','orderDate']));
  ensureTableFieldVisibleOnce('finance-e10-lines','businessRemark','v1');
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(['orderNo','orderDate','businessRemark']);
  localStorage.setItem(key,JSON.stringify(['orderNo']));
  ensureTableFieldVisibleOnce('finance-e10-lines','businessRemark','v1');
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(['orderNo']);
 });
 it('appends the new monthly field to a legacy saved view and isolates tenant/user/resource',()=>{
  localStorage.setItem('sessionUser',JSON.stringify({sub:'u',tenantId:'T'}));
  localStorage.setItem('kdos-form-view:u:finance-e10-monthly',JSON.stringify(['yearMonth','orderTotal']));
  ensureTableFieldVisibleOnce('finance-e10-monthly','businessRemark','v1');
  expect(JSON.parse(localStorage.getItem('kdos-form-view:T:u:finance-e10-monthly')!)).toEqual(['yearMonth','orderTotal','businessRemark']);
  expect(localStorage.getItem('kdos-form-view:OTHER:u:finance-e10-monthly')).toBeNull();
  expect(localStorage.getItem('kdos-form-view:T:other:finance-e10-monthly')).toBeNull();
  expect(localStorage.getItem('kdos-form-view:T:u:finance-e10-lines')).toBeNull();
 });
});
