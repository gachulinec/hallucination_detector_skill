/**
 * Table Parser — extracts claims from markdown and HTML tables.
 *
 * Parses tables in input text and optionally compares against
 * source document tables to detect fabricated/modified data.
 */

export interface TableCell {
  row: number;
  column: string;
  value: string;
  keyColumn: string; // value of the row's key (first) column
}

export interface ParsedTable {
  headers: string[];
  rows: Record<string, string>[]; // array of { header: value }
  startPos: number;
  endPos: number;
}

export interface TableClaim {
  text: string;
  type: "numeric" | "entity" | "faithfulness";
  originalRow: string;
  sourcePosition: { start: number; end: number };
}

/**
 * Parse markdown tables from text.
 * Matches: | Header1 | Header2 |\n|---|---|\n| val1 | val2 |
 */
export function parseMarkdownTables(text: string): ParsedTable[] {
  const tables: ParsedTable[] = [];
  // Match markdown table blocks
  const tableRegex = /(?:^|\n)((?:\|[^\n]+\|\s*\n)+)/gm;

  for (const match of text.matchAll(tableRegex)) {
    const block = match[1].trim();
    const startPos = match.index ?? 0;
    const endPos = startPos + match[0].length;
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);

    if (lines.length < 2) continue;

    // Parse header row
    const headers = lines[0]
      .split("|")
      .map((h) => h.trim())
      .filter(Boolean);

    if (headers.length === 0) continue;

    // Skip separator row (|---|---|)
    const dataStartIdx = lines[1].match(/^[\s|:-]+$/) ? 2 : 1;

    const rows: Record<string, string>[] = [];
    for (let i = dataStartIdx; i < lines.length; i++) {
      // Skip separator rows
      if (lines[i].match(/^[\s|:-]+$/)) continue;

      const cells = lines[i]
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);

      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length && j < cells.length; j++) {
        row[headers[j]] = cells[j];
      }
      if (Object.keys(row).length > 0) {
        rows.push(row);
      }
    }

    if (rows.length > 0) {
      tables.push({ headers, rows, startPos, endPos });
    }
  }

  return tables;
}

/**
 * Parse HTML tables from text.
 */
export function parseHtmlTables(text: string): ParsedTable[] {
  const tables: ParsedTable[] = [];
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;

  for (const match of text.matchAll(tableRegex)) {
    const tableHtml = match[1];
    const startPos = match.index ?? 0;
    const endPos = startPos + match[0].length;

    // Extract headers from <th>
    const headers: string[] = [];
    const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    for (const th of tableHtml.matchAll(thRegex)) {
      headers.push(th[1].replace(/<[^>]+>/g, "").trim());
    }

    // Extract rows from <tr>/<td>
    const rows: Record<string, string>[] = [];
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    for (const tr of tableHtml.matchAll(trRegex)) {
      const cells: string[] = [];
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      for (const td of tr[1].matchAll(tdRegex)) {
        cells.push(td[1].replace(/<[^>]+>/g, "").trim());
      }
      if (cells.length > 0 && headers.length > 0) {
        const row: Record<string, string> = {};
        for (let j = 0; j < headers.length && j < cells.length; j++) {
          row[headers[j]] = cells[j];
        }
        rows.push(row);
      }
    }

    if (headers.length > 0 && rows.length > 0) {
      tables.push({ headers, rows, startPos, endPos });
    }
  }

  return tables;
}

/**
 * Extract all tables from text (markdown + HTML).
 */
export function extractTables(text: string): ParsedTable[] {
  return [...parseMarkdownTables(text), ...parseHtmlTables(text)];
}

/**
 * Generate claims from table data by comparing input tables against source tables.
 * If no source document, generates claims for numeric/entity values in input tables.
 */
export function generateTableClaims(
  inputText: string,
  sourceDocument?: string
): TableClaim[] {
  const inputTables = extractTables(inputText);
  if (inputTables.length === 0) return [];

  const sourceTables = sourceDocument ? extractTables(sourceDocument) : [];
  const claims: TableClaim[] = [];

  for (const inputTable of inputTables) {
    const keyHeader = inputTable.headers[0]; // first column is key
    const valueHeaders = inputTable.headers.slice(1);

    // Try to find matching source table (by similar headers)
    const matchedSourceTable = sourceTables.find((st) =>
      st.headers.some((h) => inputTable.headers.includes(h))
    );

    // Build source lookup by key column
    const sourceRows = new Map<string, Record<string, string>>();
    if (matchedSourceTable) {
      for (const row of matchedSourceTable.rows) {
        const key = row[matchedSourceTable.headers[0]]?.toLowerCase();
        if (key) sourceRows.set(key, row);
      }
    }

    for (const inputRow of inputTable.rows) {
      const keyValue = inputRow[keyHeader] ?? "";
      const keyLower = keyValue.toLowerCase();
      const sourceRow = sourceRows.get(keyLower);
      const rowStr = Object.entries(inputRow)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");

      if (matchedSourceTable && !sourceRow) {
        // Row exists in input but not in source → fabricated row
        claims.push({
          text: `The table contains a "${keyValue}" row with data: ${rowStr}`,
          type: "entity",
          originalRow: rowStr,
          sourcePosition: { start: inputTable.startPos, end: inputTable.endPos },
        });
        continue;
      }

      // Compare individual cells
      for (const header of valueHeaders) {
        const inputValue = inputRow[header];
        if (!inputValue) continue;

        const isNumeric = /\d/.test(inputValue);
        const claimType = isNumeric ? "numeric" as const : "faithfulness" as const;

        if (sourceRow) {
          // Find matching header in source (case-insensitive)
          const sourceHeader = matchedSourceTable!.headers.find(
            (h) => h.toLowerCase() === header.toLowerCase()
          );
          const sourceValue = sourceHeader ? sourceRow[sourceHeader] : undefined;

          if (sourceValue && sourceValue.trim() !== inputValue.trim()) {
            // Value differs — generate claim for the input value
            claims.push({
              text: `${keyValue} has a ${header} of ${inputValue}`,
              type: claimType,
              originalRow: rowStr,
              sourcePosition: { start: inputTable.startPos, end: inputTable.endPos },
            });
          }
        } else {
          // No source table — generate claim for numeric values
          if (isNumeric) {
            claims.push({
              text: `${keyValue} has a ${header} of ${inputValue}`,
              type: claimType,
              originalRow: rowStr,
              sourcePosition: { start: inputTable.startPos, end: inputTable.endPos },
            });
          }
        }
      }
    }
  }

  return claims;
}
