import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,describe,it,expect,vi } from 'vitest';
import { reviewDueDateFields } from '@kdos/contracts';
import { RuleValue } from './advanced-filter';
afterEach(cleanup);
describe('Explicit exact-decimal filter metadata',()=>{
  const field=reviewDueDateFields.find(f=>f.key==='quantity')!;
  it('keeps a single high-precision operand as decimal text',()=>{const onChange=vi.fn();render(<RuleValue resource="mps-review-due-dates" field={field} operator="gt" rule={{field:'quantity',operator:'gt'}} onChange={onChange}/>);const input=screen.getByRole('spinbutton');fireEvent.change(input,{target:{value:'9007199254740993.1234567890123456789'}});fireEvent.blur(input);expect(onChange).toHaveBeenCalledWith({value:'9007199254740993.1234567890123456789'});});
  it('keeps both exact range operands without changing ordinary numeric field behavior',()=>{const onChange=vi.fn();render(<RuleValue resource="mps-review-due-dates" field={field} operator="between" rule={{field:'quantity',operator:'between'}} onChange={onChange}/>);const inputs=screen.getAllByRole('spinbutton');fireEvent.change(inputs[0]!,{target:{value:'0.0000000000000000001'}});fireEvent.change(inputs[1]!,{target:{value:'0.0000000000000000002'}});expect(onChange).toHaveBeenCalledWith({min:'0.0000000000000000001'});expect(onChange).toHaveBeenCalledWith({max:'0.0000000000000000002'});});
});
