export const abnormalOrderSources=['e10-main','tplus-kainan','tplus-kejia'] as const;
export type AbnormalOrderSource=typeof abnormalOrderSources[number];
export type SourceOrderLine={source_line_id:string;order_no:string;item_code:string;item_name:string|null;required_quantity:string;order_date:string;customer_due_date:string|null;header_approved?:string;line_approved?:string;header_close?:string;specified_close?:number;voucher_state?:number;cancelled?:number|null;audited?:number;header_stopped?:number;line_stopped?:number;commercial_stopped?:boolean};
