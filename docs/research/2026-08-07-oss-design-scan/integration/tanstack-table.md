# TanStack Table integration

- **Install:** `npm install @tanstack/react-table@9.0.1`
- **Surface:** transaction register; retain semantic table markup and `.table` styling.
- **Escape hatch:** columns and rows stay plain data; restore the existing table renderer.
- **Removal cost:** medium, one to two days.

```tsx
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type { Transaction } from '@/features/transactions/transaction.types';
import { MoneyCell } from '@/components/MoneyCell';

const c = createColumnHelper<Transaction>();
const columns = [
  c.accessor('date', { header: 'Date' }),
  c.accessor('payee', { header: 'Payee' }),
  c.accessor('amount', { header: 'Amount', cell: ({ getValue }) => <MoneyCell amount={getValue()} /> }),
];
export function TransactionTable({ rows }: { rows: Transaction[] }) {
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });
  return <table className="table"><caption className="sr-only">Transactions</caption><thead>{table.getHeaderGroups().map(g => <tr key={g.id}>{g.headers.map(h => <th scope="col" key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</th>)}</tr>)}</thead><tbody>{table.getRowModel().rows.map(r => <tr key={r.id}>{r.getVisibleCells().map(cell => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table>;
}
```

**Test:** headers have accessible names, sorting is stable, and every amount remains integer milliunits.
