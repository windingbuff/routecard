export const field = (path, label, type = 'text', options = {}) => ({ path, label, type, ...options });
export const table = (path, label, columns, options = {}) => field(path, label, 'table', { columns, ...options });
export const column = (key, label, type = 'text', options = {}) => ({ key, label, type, ...options });
export const view = (title, columns, rows) => ({ title, columns, rows });
export const metric = (label, value) => ({ label, value });
export const item = (key, label, detail = '', blocking = false) => ({ key: String(key), label: String(label), detail: String(detail), blocking });
export function csv(columns, rows) {
  const cell = value => {
    let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    // CSV downloaded for spreadsheets must not execute a cell as a formula.
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return '\uFEFF' + [columns.map(c => cell(c.label)), ...rows.map(r => columns.map(c => cell(r[c.key])))].map(row => row.join(',')).join('\r\n') + '\r\n';
}
export function csvArtifact(id, name, columns, rows) { return { id, name, extension: 'csv', mime: 'text/csv', content: csv(columns, rows) }; }
export function jsonArtifact(id, name, value) { return { id, name, extension: 'json', mime: 'application/json', content: JSON.stringify(value, null, 2) + '\n' }; }
export function textArtifact(id, name, extension, mime, content) { return { id, name, extension, mime, content }; }
export const pairFields = (path, label) => table(path, label, [column('0', 'First ID'), column('1', 'Second ID')], { tuples: true });
export const summary = (metrics, tables, review = [], graphic = null) => ({ metrics, tables, review, graphic });
export const flattenPhotos = result => result.groups.flatMap(g => g.images.map(image => ({ ...image, group: g.id })));
