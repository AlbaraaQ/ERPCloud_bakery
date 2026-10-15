import { money } from '@erpcloud/shared';
export interface PriceBounds { resolvedPrice: string; minPrice?: string | null; maxPrice?: string | null; }
/** Pure pricing rules (AT-PRICE-001/002): resolved price is the master/customer price.
 *  A requested price outside [min,max] is an override and requires approval+reason. */
export function checkPrice(p: PriceBounds & { requestedPrice?: string }) {
  const resolved = money(p.resolvedPrice);
  const requested = p.requestedPrice !== undefined ? money(p.requestedPrice) : resolved;
  const belowMin = p.minPrice != null && requested.lt(money(p.minPrice));
  const aboveMax = p.maxPrice != null && requested.gt(money(p.maxPrice));
  return { resolved, requested, isOverride: !requested.equals(resolved), outOfBounds: belowMin || aboveMax, belowMin, aboveMax };
}
export function lineAmounts(qty: string, unitPrice: string, discount: string, taxRate: string) {
  const net = money(qty).times(money(unitPrice)).minus(money(discount));
  if (net.lt(0)) throw new Error('خصم السطر أكبر من قيمته');
  const tax = net.times(money(taxRate)).div(100);
  return { net, tax, total: net.plus(tax) };
}
