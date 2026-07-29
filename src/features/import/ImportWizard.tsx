/**
 * NIZAM · Import wizard — pick file (Drive Picker / local), preview dedup, commit
 * Implemented by: KIRO Contract 4 / Phase 4.7
 * Depends on: ledgerImport.ts (the pure engine), lib/drive/picker.ts
 *
 * The wizard NEVER parses on its own — it delegates to the pure importLedger /
 * parseLedgerCsv / dedupeRows engine (Contract 2 / Phase 2.5). The Drive Picker
 * grants access ONLY to the file the user selects (drive.file semantics).
 */
import { useState } from 'react';
import { useNizamStore } from '@/state/store';
import {
  parseLedgerCsv,
  dedupeRows,
  importLedger,
  type ImportStats,
} from '@/features/import/ledgerImport';
import { pickLedgerFile } from '@/lib/drive/picker';
import { createDriveClient } from '@/lib/drive/driveClient';

type Step = 'pick' | 'preview' | 'done';

export function ImportWizard() {
  const db = useNizamStore((s) => s.db);
  const mutate = useNizamStore((s) => s.mutate);
  const sessionStatus = useNizamStore((s) => s.sessionStatus);

  const [step, setStep] = useState<Step>('pick');
  const [fileName, setFileName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!db) return <p className="muted">Loading…</p>;

  function loadCsv(name: string, text: string) {
    setFileName(name);
    setCsvText(text);
    setError(null);
    setStep('preview');
  }

  async function pickFromDrive() {
    setError(null);
    try {
      const picked = await pickLedgerFile();
      if (!picked) return;
      const text = await createDriveClient().downloadText(picked.id);
      loadCsv(picked.name, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function onLocalFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadCsv(file.name, String(reader.result ?? ''));
    reader.onerror = () => setError('Could not read the selected file.');
    reader.readAsText(file);
  }

  // Preview numbers come from the SAME pure engine the commit uses.
  const parsed = step === 'preview' ? parseLedgerCsv(csvText) : null;
  const dedup = parsed && db ? dedupeRows(parsed.rows, db) : null;

  function commit() {
    setError(null);
    try {
      let outcome: ImportStats | null = null;
      mutate((draft) => {
        const result = importLedger(draft, csvText);
        outcome = result.stats;
        // importLedger is pure — copy its result into the draft.
        draft.accounts = result.db.accounts;
        draft.categoryGroups = result.db.categoryGroups;
        draft.categories = result.db.categories;
        draft.payees = result.db.payees;
        draft.transactions = result.db.transactions;
      });
      setStats(outcome);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section aria-label="Import">
      <h2>Import your master ledger</h2>

      {step === 'pick' ? (
        <div className="card">
          <p>
            Import the existing 25-column master ledger CSV. Via Google Drive the app is granted
            access to <strong>only the file you pick</strong>.
          </p>
          <div className="toolbar">
            <button
              className="btn"
              onClick={() => void pickFromDrive()}
              disabled={sessionStatus !== 'signedIn'}
              title={sessionStatus !== 'signedIn' ? 'Connect Google Drive first' : ''}
            >
              Pick from Google Drive
            </button>
            <span className="muted">or</span>
            <label className="btn btn-secondary" style={{ display: 'inline-block' }}>
              Choose a local CSV
              <input
                type="file"
                accept=".csv,text/csv"
                style={{ display: 'none' }}
                onChange={onLocalFile}
                aria-label="Choose a local CSV file"
              />
            </label>
          </div>
        </div>
      ) : null}

      {step === 'preview' && parsed && dedup ? (
        <div className="card">
          <h3>Preview — {fileName}</h3>
          <table className="table" aria-label="Import preview">
            <tbody>
              <tr>
                <td>Rows parsed</td>
                <td className="num">{parsed.rows.length}</td>
              </tr>
              <tr>
                <td>Will import (fresh)</td>
                <td className="num">{dedup.fresh.length}</td>
              </tr>
              <tr>
                <td>Exact duplicates (by duplicate_key)</td>
                <td className="num">{dedup.skippedExact.length}</td>
              </tr>
              <tr>
                <td>Fuzzy duplicates (account + amount ± 3 days + payee)</td>
                <td className="num">{dedup.skippedFuzzy.length}</td>
              </tr>
              <tr>
                <td>Flagged is_duplicate rows</td>
                <td className="num">{dedup.skippedFlagged.length}</td>
              </tr>
              <tr>
                <td>Row errors</td>
                <td className="num">{parsed.errors.length}</td>
              </tr>
            </tbody>
          </table>
          {parsed.errors.length > 0 ? (
            <details>
              <summary>Show row errors</summary>
              <ul>
                {parsed.errors.slice(0, 20).map((e) => (
                  <li key={e.rowNumber} className="error-text">
                    row {e.rowNumber}: {e.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={() => setStep('pick')}>
              Back
            </button>
            <button className="btn" onClick={commit} disabled={parsed.rows.length === 0}>
              Import {dedup.fresh.length} transaction{dedup.fresh.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      ) : null}

      {step === 'done' && stats ? (
        <div className="card" role="status">
          <h3>Import complete</h3>
          <p>
            Imported {stats.imported} · skipped {stats.skippedExact} exact, {stats.skippedFuzzy}{' '}
            fuzzy, {stats.skippedFlagged} flagged
            {stats.accountsCreated.length > 0
              ? ` · accounts created: ${stats.accountsCreated.join(', ')}`
              : ''}
          </p>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setStep('pick');
              setCsvText('');
              setStats(null);
            }}
          >
            Import another file
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
