/**
 * table — generic div-based data table (no <table>/<th>/<td>): first row =
 * header, rest = data rows.
 * CSS: blocks/table/table.css
 */
export default function decorate(block) {
  block.setAttribute('role', 'table');
  [...block.children].forEach((row, i) => {
    row.setAttribute('role', 'row');
    [...row.children].forEach((cell) => {
      cell.setAttribute('role', i === 0 ? 'columnheader' : 'cell');
    });
  });
}
