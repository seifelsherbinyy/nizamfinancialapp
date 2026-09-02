/**
 * NIZAM - Net worth: the five net-worth views + the assets/FX data-entry editor.
 * Owning contract: PFOS contract 01 (Constitution) section 6 - the net-worth views;
 *   contract 03 (Decision Engine) section 8 - currency-aware assets, real value, and
 *   section 8.3 - every FX rate carries a source + time (never a silent conversion).
 * Build phase: PFOS Stage 4, phase 4.4 - net-worth UI + asset/FX editor.
 * Depends on: netWorth engine, netWorth.types, state/store (mutate), state/actions (newId),
 *   lib/money (toDecimal), components.
 *
 * Pure client work on the Drive DB - no server. This is the primary path for the owner to
 * enter valued assets and currency rates; the net-worth engine then values them, and never
 * silently zeroes a foreign asset whose rate is missing (it is surfaced as "unrated").
 */
import { useState } from 'react';
import { useNizamStore } from '@/state/store';
import { newId } from '@/state/actions';
import { netWorth, type NetWorthBreakdown } from '@/features/netWorth/netWorth';
import {
  ASSET_KINDS,
  BASE_CURRENCY,
  type Asset,
  type AssetKind,
  type FxRate,
} from '@/features/netWorth/netWorth.types';
import { MoneyInput } from '@/components/MoneyInput';
import { MoneyCell } from '@/components/MoneyCell';
import { Modal } from '@/components/Modal';
import { toDecimal, type Money } from '@/lib/money/money';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const KIND_LABEL: Record<AssetKind, string> = {
  financial: 'Financial (cash-like)',
  real: 'Real (property, vehicle, ...)',
};

/** Value shown in the asset's OWN currency - currency-agnostic, never throws on a bad code. */
function ownCurrency(a: Asset): string {
  return `${toDecimal(a.value)} ${a.currency}`;
}

function AssetModal(props: { existing: Asset | null; onClose: () => void }) {
  const mutate = useNizamStore((s) => s.mutate);
  const a = props.existing;
  const [name, setName] = useState(a?.name ?? '');
  const [kind, setKind] = useState<AssetKind>(a?.kind ?? 'financial');
  const [currency, setCurrency] = useState(a?.currency ?? BASE_CURRENCY);
  const [value, setValue] = useState<Money>(a?.value ?? 0);
  const [liquid, setLiquid] = useState(a?.liquid ?? (a?.kind ?? 'financial') === 'financial');
  const [discountPct, setDiscountPct] = useState(
    a ? String(Math.round(a.liquidationDiscountBps / 100)) : '0',
  );
  const [source, setSource] = useState(a?.valuationSource ?? 'manual');
  const [asOf, setAsOf] = useState(a?.valuationAsOf ?? today());
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    if (!name.trim()) return setError('Name the asset.');
    if (!currency.trim()) return setError('Enter a currency code (e.g. EGP, USD).');
    if (value < 0) return setError('An asset value cannot be negative.');
    const discount = Math.round(Number(discountPct));
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      return setError('The liquidation haircut must be between 0 and 100 percent.');
    }
    if (!ISO_DATE.test(asOf)) return setError('Choose a valuation date.');

    const asset: Asset = {
      id: a?.id ?? newId('asset'),
      name: name.trim(),
      kind,
      currency: currency.trim().toUpperCase(),
      value,
      liquid: kind === 'real' ? false : liquid,
      liquidationDiscountBps: discount * 100,
      valuationSource: source.trim() || 'manual',
      valuationAsOf: asOf,
    };
    mutate((draft) => {
      const idx = draft.assets.findIndex((x) => x.id === asset.id);
      if (idx >= 0) draft.assets[idx] = asset;
      else draft.assets.push(asset);
    });
    props.onClose();
  }

  return (
    <Modal title={a ? `Edit ${a.name}` : 'Add asset'} onClose={props.onClose}>
      <label className="field">
        <span>Name</span>
        <input
          className="input"
          type="text"
          value={name}
          onChange={(ev) => setName(ev.target.value)}
          aria-label="Asset name"
          placeholder="e.g. Brokerage account, Apartment"
        />
      </label>
      <label className="field">
        <span>Kind</span>
        <select
          className="input"
          value={kind}
          onChange={(ev) => setKind(ev.target.value as AssetKind)}
          aria-label="Asset kind"
        >
          {ASSET_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Currency</span>
        <input
          className="input"
          type="text"
          value={currency}
          onChange={(ev) => setCurrency(ev.target.value)}
          aria-label="Asset currency"
          placeholder="EGP"
        />
      </label>
      <label className="field">
        <span>Value (in the currency above)</span>
        <MoneyInput value={value} onCommit={setValue} aria-label="Asset value" />
      </label>
      {kind === 'financial' ? (
        <label className="field field-inline">
          <input
            type="checkbox"
            checked={liquid}
            onChange={(ev) => setLiquid(ev.target.checked)}
            aria-label="Liquid"
          />
          <span>Liquid - spendable within days (counts toward liquid net worth)</span>
        </label>
      ) : null}
      <label className="field">
        <span>Liquidation haircut % (fire-sale / fees, for the conservative view)</span>
        <input
          className="input"
          type="number"
          min={0}
          max={100}
          value={discountPct}
          onChange={(ev) => setDiscountPct(ev.target.value)}
          aria-label="Liquidation haircut percent"
        />
      </label>
      <label className="field">
        <span>Valuation source</span>
        <input
          className="input"
          type="text"
          value={source}
          onChange={(ev) => setSource(ev.target.value)}
          aria-label="Valuation source"
          placeholder="e.g. broker statement, estimate"
        />
      </label>
      <label className="field">
        <span>Valued as of</span>
        <input
          className="input"
          type="date"
          value={asOf}
          onChange={(ev) => setAsOf(ev.target.value)}
          aria-label="Valuation date"
        />
      </label>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={props.onClose}>
          Cancel
        </button>
        <button className="btn" onClick={save}>
          Save asset
        </button>
      </div>
    </Modal>
  );
}

function FxModal(props: { existing: FxRate | null; onClose: () => void }) {
  const mutate = useNizamStore((s) => s.mutate);
  const r = props.existing;
  const [currency, setCurrency] = useState(r?.currency ?? '');
  const [num, setNum] = useState(r ? String(r.perUnitNum) : '');
  const [den, setDen] = useState(r ? String(r.perUnitDen) : '1');
  const [source, setSource] = useState(r?.source ?? 'manual');
  const [asOf, setAsOf] = useState(r?.observedAt.slice(0, 10) ?? today());
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    const code = currency.trim().toUpperCase();
    if (!code) return setError('Enter the currency code (e.g. USD).');
    if (code === BASE_CURRENCY) return setError(`${BASE_CURRENCY} is the base currency - no rate needed.`);
    const n = Math.round(Number(num));
    const d = Math.round(Number(den));
    if (!Number.isFinite(n) || n <= 0) return setError('Enter how many EGP one unit is worth (positive).');
    if (!Number.isFinite(d) || d <= 0) return setError('The denominator must be a positive whole number.');
    if (!ISO_DATE.test(asOf)) return setError('Choose the rate date.');

    const rate: FxRate = {
      currency: code,
      perUnitNum: n,
      perUnitDen: d,
      source: source.trim() || 'manual',
      // The date picker stays date-only (no time-of-day input); widen to a datetime the
      // same way the v7->v8 migration does, so a new rate's shape matches a migrated one.
      observedAt: `${asOf}T00:00:00Z`,
      conversionVersion: 0,
    };
    mutate((draft) => {
      const idx = draft.fxRates.findIndex((x) => x.currency === code);
      if (idx >= 0) draft.fxRates[idx] = rate;
      else draft.fxRates.push(rate);
    });
    props.onClose();
  }

  return (
    <Modal title={r ? `Edit ${r.currency} rate` : 'Add currency rate'} onClose={props.onClose}>
      <label className="field">
        <span>Currency code</span>
        <input
          className="input"
          type="text"
          value={currency}
          onChange={(ev) => setCurrency(ev.target.value)}
          aria-label="Rate currency"
          placeholder="USD"
          disabled={!!r}
        />
      </label>
      <label className="field">
        <span>One unit is worth (EGP)</span>
        <input
          className="input"
          type="number"
          min={1}
          value={num}
          onChange={(ev) => setNum(ev.target.value)}
          aria-label="EGP per unit numerator"
          placeholder="49"
        />
      </label>
      <label className="field">
        <span>Per this many units (denominator, usually 1)</span>
        <input
          className="input"
          type="number"
          min={1}
          value={den}
          onChange={(ev) => setDen(ev.target.value)}
          aria-label="Per units denominator"
        />
      </label>
      <label className="field">
        <span>Rate source</span>
        <input
          className="input"
          type="text"
          value={source}
          onChange={(ev) => setSource(ev.target.value)}
          aria-label="Rate source"
          placeholder="e.g. bank, xe.com"
        />
      </label>
      <label className="field">
        <span>Rate as of</span>
        <input
          className="input"
          type="date"
          value={asOf}
          onChange={(ev) => setAsOf(ev.target.value)}
          aria-label="Rate date"
        />
      </label>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={props.onClose}>
          Cancel
        </button>
        <button className="btn" onClick={save}>
          Save rate
        </button>
      </div>
    </Modal>
  );
}

export function NetWorthView() {
  const db = useNizamStore((s) => s.db);
  const mutate = useNizamStore((s) => s.mutate);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [addingAsset, setAddingAsset] = useState(false);
  const [editingFx, setEditingFx] = useState<FxRate | null>(null);
  const [addingFx, setAddingFx] = useState(false);

  if (!db) return <p className="muted">Loading...</p>;

  const nw: NetWorthBreakdown = netWorth(db);

  return (
    <section aria-label="Net worth">
      <div className="month-nav">
        <h2>Net worth</h2>
        <div className="spacer" />
        <span className="badge" role="status" aria-label="Reference currency">
          in {nw.referenceCurrency}
        </span>
      </div>

      <table className="table" aria-label="Net-worth summary">
        <tbody>
          <tr>
            <td>Nominal (assets - liabilities)</td>
            <td className="num" aria-label="Nominal net worth">
              <MoneyCell amount={nw.nominal} rag={nw.nominal < 0 ? 'negative' : undefined} />
            </td>
          </tr>
          <tr>
            <td>Liquid (spendable soon)</td>
            <td className="num" aria-label="Liquid net worth">
              <MoneyCell amount={nw.liquid} rag={nw.liquid < 0 ? 'negative' : undefined} />
            </td>
          </tr>
          <tr>
            <td>Liquidation (conservative, after haircuts)</td>
            <td className="num" aria-label="Liquidation net worth">
              <MoneyCell amount={nw.liquidation} rag={nw.liquidation < 0 ? 'negative' : undefined} />
            </td>
          </tr>
        </tbody>
      </table>

      <div className="card">
        <p className="muted">
          Cash <MoneyCell amount={nw.components.cash} /> - financial assets{' '}
          <MoneyCell amount={nw.components.financialAssets} /> - real assets{' '}
          <MoneyCell amount={nw.components.realAssets} /> - credit owed{' '}
          <MoneyCell amount={nw.components.creditLiabilities} /> - obligations owed{' '}
          <MoneyCell amount={nw.components.obligationLiabilities} />.
        </p>
      </div>

      {nw.unratedCurrencies.length > 0 ? (
        <div className="rta-banner rta-warning" role="alert" aria-label="Unrated currencies">
          <span>
            {nw.unratedCurrencies.join(', ')} {nw.unratedCurrencies.length === 1 ? 'has' : 'have'} no
            currency rate, so those assets are NOT counted above. Add a rate below to include them.
          </span>
        </div>
      ) : null}

      <div className="month-nav">
        <h3>Assets</h3>
        <div className="spacer" />
        <button className="btn" onClick={() => setAddingAsset(true)}>
          Add asset
        </button>
      </div>
      {db.assets.length === 0 ? (
        <div className="card">
          <p className="muted">
            No assets recorded. Add brokerage balances, foreign cash, property, or vehicles so
            net worth reflects everything you own - not just your bank accounts.
          </p>
        </div>
      ) : (
        <table className="table" aria-label="Assets list">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Kind</th>
              <th scope="col" className="num">
                Value
              </th>
              <th scope="col">Liquid</th>
              <th scope="col" className="num">
                Haircut
              </th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {db.assets.map((asset) => (
              <tr key={asset.id}>
                <td>{asset.name}</td>
                <td>{asset.kind}</td>
                <td className="num">{ownCurrency(asset)}</td>
                <td>{asset.liquid ? 'yes' : 'no'}</td>
                <td className="num">{Math.round(asset.liquidationDiscountBps / 100)}%</td>
                <td>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setEditingAsset(asset)}
                    aria-label={`Edit ${asset.name}`}
                  >
                    Edit
                  </button>{' '}
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() =>
                      mutate((draft) => {
                        draft.assets = draft.assets.filter((x) => x.id !== asset.id);
                      })
                    }
                    aria-label={`Delete ${asset.name}`}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="month-nav">
        <h3>Currency rates</h3>
        <div className="spacer" />
        <button className="btn" onClick={() => setAddingFx(true)}>
          Add rate
        </button>
      </div>
      {db.fxRates.length === 0 ? (
        <div className="card">
          <p className="muted">
            No currency rates. If you hold foreign-currency assets, add a rate (with its source and
            date) so they can be valued in {nw.referenceCurrency} - never guessed.
          </p>
        </div>
      ) : (
        <table className="table" aria-label="Currency rates list">
          <thead>
            <tr>
              <th scope="col">Currency</th>
              <th scope="col">1 unit = EGP</th>
              <th scope="col">Source</th>
              <th scope="col" className="num">
                As of
              </th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {db.fxRates.map((rate) => (
              <tr key={rate.currency}>
                <td>{rate.currency}</td>
                <td className="num">
                  {rate.perUnitDen === 1
                    ? String(rate.perUnitNum)
                    : `${rate.perUnitNum} / ${rate.perUnitDen}`}
                </td>
                <td>{rate.source}</td>
                <td className="num">{rate.observedAt.slice(0, 10)}</td>
                <td>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setEditingFx(rate)}
                    aria-label={`Edit ${rate.currency} rate`}
                  >
                    Edit
                  </button>{' '}
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() =>
                      mutate((draft) => {
                        draft.fxRates = draft.fxRates.filter((x) => x.currency !== rate.currency);
                      })
                    }
                    aria-label={`Delete ${rate.currency} rate`}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {addingAsset ? <AssetModal existing={null} onClose={() => setAddingAsset(false)} /> : null}
      {editingAsset ? (
        <AssetModal existing={editingAsset} onClose={() => setEditingAsset(null)} />
      ) : null}
      {addingFx ? <FxModal existing={null} onClose={() => setAddingFx(false)} /> : null}
      {editingFx ? <FxModal existing={editingFx} onClose={() => setEditingFx(null)} /> : null}
    </section>
  );
}
