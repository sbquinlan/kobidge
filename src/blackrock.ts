import fetch from 'node-fetch';
import { map } from './lib/iterator.js';
import { fluent } from './lib/fluent.js';

import {
  BlackrockListingTable,
  BlackrockFundRecord,
  BlackrockHoldingColumns,
  BlackrockHoldingRecord,
} from './blackrock_types.js';
import { HoldingRow, FundHoldingRow, Factory, FundRow } from './download.js';

const URI_BASE = 'https://www.blackrock.com';
const HOLDINGS_REGEX =
  /\/us\/individual\/products\/\d+\/[^/]+\/\d+.ajax\?tab=all&fileType=json/;
export class BlackrockFactory extends Factory {
  genFunds(): AsyncIterable<[FundRow, HoldingRow[], FundHoldingRow[]]> {
    return fluent(
      this.genTableRows(),
      map(
        async (p) => {
          console.log(p.fundShortName);
          const [holdings, joins] = await this.genHoldings(p);
          const fund: FundRow = {
            ticker: p.localExchangeTicker,
            name: p.fundShortName,
          };
          return [ fund, holdings, joins ];
        },
      ),
    );
  }

  private async *genTableRows() {
    const resp = await fetch(
      `${URI_BASE}/us/individual/product-screener/product-screener-v3.jsn?dcrPath=/templatedata/config/product-screener-v3/data/en/one/one-v4`
    );
    if (!resp.ok) {
      const msg = await resp.text();
      throw new Error(`${resp.status} ${resp.statusText}: ${msg}`);
    }
    const payload = await resp.json() as any;
    const table = payload.data.tableData as BlackrockListingTable;
    const column_to_index: [string, number][] = table.columns.map(
      (col, idx) => [col.name, idx]
    );
    yield *table.data.map(
      (row) =>
        Object.fromEntries(
          column_to_index.map(([name, idx]) => [name, row[idx]])
        ) as BlackrockFundRecord
      )
      // filter out non-etfs
      .filter(record => record.productView[1] === 'ishares')
      .filter(record => record.aladdinAssetClass === 'Equity');
  }

  private async genHoldingsURI(product_url: string) {
    const resp = await fetch(`${URI_BASE}${product_url}`);
    if (!resp.ok) {
      const msg = await resp.text();
      throw new Error(`${resp.status} ${resp.statusText}: ${msg}`);
    }
    const raw = await resp.text()!;
    // some funds don't have holdings like the gold trust etf
    return raw.match(HOLDINGS_REGEX)?.at(0);
  }

  async genHoldings(
    fund: BlackrockFundRecord
  ): Promise<[HoldingRow[], FundHoldingRow[]]> {
    const holdings_uri = await this.genHoldingsURI(fund.productPageUrl!);
    if (!holdings_uri) {
      return [[],[]];
    }
    const resp = await fetch(`${URI_BASE}${holdings_uri}`);
    if (!resp.ok) {
      const msg = await resp.text();
      throw new Error(`${resp.status} ${resp.statusText}: ${msg}`);
    }
    const payload = await resp.json() as any;
    const column_to_index: [string, number][] = BlackrockHoldingColumns.map(
      (name, idx) => [name, idx]
    );
    const records: BlackrockHoldingRecord[] = payload.aaData
      .map(
        (record: any[]) =>
          Object.fromEntries(
            column_to_index.map(([name, idx]) => [name, record[idx]])
          ) as BlackrockHoldingRecord
      );
    return [
      records.map((raw) => ({
        ticker: raw.ticker,
        name: raw.name,
        last: raw.last.raw,
      })),
      records.map((raw) => ({
        fund: fund.localExchangeTicker,
        holding: raw.ticker,
        weight: raw.weight.raw,
      })),
    ];
  }
}
