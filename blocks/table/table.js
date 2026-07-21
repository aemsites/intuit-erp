/**
 * table — generic div-based data table (no <table>/<th>/<td>). Used by
 * OF1-generated content (blocks/of1): first row = header, rest = data rows.
 * Full styling lives in blocks/of1/of1.css (.generated-section .table).
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
