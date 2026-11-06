import { quantityBalance } from './master-plan.demand-quantity';
describe('exact verified demand reservation', () => {
    it('60+40, 120 delta20; cancelled fulfillment stays counted once', () => {
        expect(quantityBalance('120', [{ planned_quantity: '60', fulfilled: '0' }, { planned_quantity: '40', fulfilled: '0' }], true)).toMatchObject({ unallocated: '20.0000', allocated: '100.0000' });
        expect(quantityBalance('100', [{ planned_quantity: '60', fulfilled: '20', lifecycle_status: 'CANCELLED' }, { planned_quantity: '40', fulfilled: '0' }], true)).toMatchObject({ fulfilled: '20.0000', cancelledFulfilled: '20.0000', remainingReserved: '40.0000', unallocated: '40.0000' });
    });
    it('ON_HOLD keeps reservation; decimal exact no float rounding', () => {
        expect(quantityBalance('0.3', [{ planned_quantity: '0.1', fulfilled: '0', lifecycle_status: 'ON_HOLD' }, { planned_quantity: '0.2', fulfilled: '0' }], true)).toMatchObject({ unallocated: '0.0000', heldReserved: '0.1000' });
    });
    it('uncertain attribution cannot yield an actionable balance', () => { expect(quantityBalance('100', [], false)).toMatchObject({ difference: null, unallocated: null, fulfilled: null }); });
});
