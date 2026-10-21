import {describe,it,expect} from 'vitest';
import {readFinanceMonthlyPeriod as period} from './finance-monthly.period';
const read=(query:string)=>period(new URLSearchParams(query));
describe('occurrence month bookmarks',()=>{
 it('keeps the full period by default',()=>expect(read('')).toEqual({from:undefined,to:undefined}));
 it('maps previous dashboard dates to effective months across years',()=>expect(read('dateFrom=2025-12-20&dateTo=2026-02-01')).toEqual({from:'2025-12',to:'2026-02'}));
 it('intersects year and month drill context with explicit calendars',()=>{expect(read('year=2026&month=2')).toEqual({from:'2026-02',to:'2026-02'});expect(read('year=2026&monthFrom=2025-12&monthTo=2026-06')).toEqual({from:'2026-01',to:'2026-06'});});
 it('fails closed on malformed or contradictory calendars',()=>{for(const q of ['year=2024','year=2026&month=13','monthFrom=2026-02&monthTo=2026-01','dateFrom=2026-02-30','monthFrom=bad'])expect(read(q).error).toBeTruthy();});
});
