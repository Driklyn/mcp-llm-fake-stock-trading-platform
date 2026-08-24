import React from "react";
import * as styles from "./table.css.ts";

export type TableProps = React.TableHTMLAttributes<HTMLTableElement> & {
  children?: React.ReactNode;
  className?: string;
};

export function Table({ children, className, ...props }: TableProps) {
  return (
    <table
      className={`${styles.table}${className ? " " + className : ""}`}
      {...props}
    >
      {children}
    </table>
  );
}

export type TableHeaderProps = React.HTMLAttributes<HTMLTableSectionElement> & {
  children?: React.ReactNode;
  className?: string;
};

export function TableHeader({
  children,
  className,
  ...props
}: TableHeaderProps) {
  return (
    <thead className={className} {...props}>
      {children}
    </thead>
  );
}

export type TableBodyProps = React.HTMLAttributes<HTMLTableSectionElement> & {
  children?: React.ReactNode;
  className?: string;
};

export function TableBody({ children, className, ...props }: TableBodyProps) {
  return (
    <tbody className={className} {...props}>
      {children}
    </tbody>
  );
}

export type TableRowProps = React.HTMLAttributes<HTMLTableRowElement> & {
  children?: React.ReactNode;
  className?: string;
};

export function TableRow({ children, className, ...props }: TableRowProps) {
  return (
    <tr
      className={`${styles.row}${className ? " " + className : ""}`}
      {...props}
    >
      {children}
    </tr>
  );
}

export type TableCellProps = React.TdHTMLAttributes<HTMLTableCellElement> & {
  children?: React.ReactNode;
  className?: string;
};

export function TableCell({ children, className, ...props }: TableCellProps) {
  return (
    <td
      className={`${styles.cell}${className ? " " + className : ""}`}
      {...props}
    >
      {children}
    </td>
  );
}

export type TableHeaderCellProps =
  React.ThHTMLAttributes<HTMLTableCellElement> & {
    children?: React.ReactNode;
    className?: string;
  };

export function TableHeaderCell({
  children,
  className,
  ...props
}: TableHeaderCellProps) {
  return (
    <th
      className={`${styles.headerCell}${className ? " " + className : ""}`}
      {...props}
    >
      {children}
    </th>
  );
}

export const TableEmpty = ({
  children,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={styles.emptyCell} {...props}>
    {children}
  </td>
);
