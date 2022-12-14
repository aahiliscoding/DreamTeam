import * as t from "io-ts";
import * as Knex from "knex";
import { AllOrdersRow } from "../../types";
import { formatBigNumberAsFixed } from "../../utils/format-big-number-as-fixed";

export const AllOrdersParams = t.type({
  account: t.string,
});

export interface AllOrders {
  [orderId: string]: AllOrdersRow<string>;
}

export async function getAllOrders(db: Knex, dreamteam: {}, params: t.TypeOf<typeof AllOrdersParams>): Promise<AllOrders> {
  const query = db.select(["orderId", "marketId", "originalTokensEscrowed", "originalSharesEscrowed", "tokensEscrowed", "sharesEscrowed"]).from("orders").where("orderCreator", params.account).where("orderState", "OPEN");
  const allOrders: Array<AllOrdersRow<BigNumber>> = await query;
  return allOrders.reduce((acc: AllOrders, cur: AllOrdersRow<BigNumber>) => {
    acc[cur.orderId] = formatBigNumberAsFixed<AllOrdersRow<BigNumber>, AllOrdersRow<string>>({
      orderId: cur.orderId,
      originalTokensEscrowed: cur.originalTokensEscrowed,
      originalSharesEscrowed: cur.originalSharesEscrowed,
      tokensEscrowed: cur.tokensEscrowed,
      sharesEscrowed: cur.sharesEscrowed,
      marketId: cur.marketId,
    });
    return acc;
  }, {});
}
