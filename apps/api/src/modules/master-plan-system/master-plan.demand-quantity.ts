import Decimal from 'decimal.js';
import type { MpsQuantitySnapshot } from '@kdos/contracts';
/** Cancelled quantities release only unexecuted demand; their verified fulfillment stays occupied. */
export function quantityBalance(required: string, batches: Array<{
    planned_quantity: string;
    lifecycle_status?: string;
    fulfilled: string;
}>, trusted: boolean) {
    let allocated = new Decimal(0), fulfilled = new Decimal(0), remaining = new Decimal(0), held = new Decimal(0), cancelled = new Decimal(0);
    for (const b of batches) {
        const p = new Decimal(b.planned_quantity), f = new Decimal(b.fulfilled), r = Decimal.max(p.sub(f), 0);
        allocated = allocated.add(p);
        fulfilled = fulfilled.add(f);
        if (b.lifecycle_status === 'CANCELLED')
            cancelled = cancelled.add(f);
        else {
            remaining = remaining.add(r);
            if (b.lifecycle_status === 'ON_HOLD')
                held = held.add(r);
        }
    }
    const delta = new Decimal(required).sub(fulfilled).sub(remaining), n = (d: Decimal) => d.toFixed(4);
    return { allocated: n(allocated), fulfilled: trusted ? n(fulfilled) : null, remainingReserved: trusted ? n(remaining) : null, heldReserved: trusted ? n(held) : null, cancelledFulfilled: trusted ? n(cancelled) : null, difference: trusted ? n(delta) : null, unallocated: trusted ? n(Decimal.max(delta, 0)) : null, overallocated: trusted ? n(Decimal.max(delta.neg(), 0)) : null } satisfies Partial<MpsQuantitySnapshot>;
}
