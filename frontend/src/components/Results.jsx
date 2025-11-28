// Results.jsx
// Replaces your earlier Results component.
// Key improvements:
//  - Robustly extracts column names using several strategies (answer text, SQL, schema).
//  - Removes large tuple/list/table dump from the "Answer" text so Answer remains short.
//  - Renders the returned rows using the extracted column names (falls back safely).
//  - Adds scrolling for large outputs.
//
// If you want to revert, keep a copy of your previous Results.jsx and restore it.

import { useMemo } from "react";

export default function Results({ data }) {
  // Helper: Parse column names from a SQL SELECT statement.
  // Very simple parser that's good for common cases like:
  //   SELECT age AS Age, name AS "Full Name", t.col FROM table
  // It is not a full SQL parser (but that's fine for typical generated queries).
  const parseColumnsFromSQL = (sql) => {
    try {
      const m = sql.match(/select\s+([\s\S]*?)\s+from\b/i);
      if (!m) return [];

      let colsPart = m[1].trim();
      // Remove leading DISTINCT, TOP, etc (basic)
      colsPart = colsPart.replace(/^\s*distinct\s+/i, "");

      // split on commas (naive — ok for simple selects)
      const parts = colsPart.split(",").map((p) => p.trim()).filter(Boolean);

      const cleaned = parts.map((part) => {
        // Remove surrounding parentheses (simple)
        part = part.replace(/^\(+|\)+$/g, "").trim();

        // Case 1: ... AS alias
        let asMatch = part.match(/(.+?)\s+as\s+["'`\[]?([^\]\)"'` ]+)["'`\]]?$/i);
        if (asMatch) return asMatch[2];

        // Case 2: trailing alias without AS (e.g. "col alias")
        let tokens = part.split(/\s+/);
        if (tokens.length > 1) {
          const last = tokens[tokens.length - 1];
          // if last token looks like an alias (not a function), return it
          if (!/\(|\)/.test(last)) {
            return last.replace(/(^["'`\[]|["'`\]]$)/g, "");
          }
        }

        // Case 3: table.col -> take right side
        if (part.includes(".")) {
          return part.split(".").pop().replace(/(^["'`\[]|["'`\]]$)/g, "");
        }

        // Case 4: simple column name or expression: strip quotes
        return part.replace(/(^["'`\[]|["'`\]]$)/g, "");
      });

      // Final cleanup: remove empty and preserve order
      return cleaned.filter(Boolean);
    } catch (e) {
      return [];
    }
  };

  // Helper: parse column names from a CREATE TABLE schema text
  const parseColumnsFromSchema = (schemaText) => {
    try {
      const m = schemaText.match(/create\s+table[^\(]*\(([\s\S]*?)\)\s*/i);
      const body = m ? m[1] : schemaText;
      // split by commas on newlines but also handle trailing comments
      const lines = body
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      const cols = [];
      for (let ln of lines) {
        // stop at constraint lines
        if (/primary\s+key|foreign\s+key|unique|constraint/i.test(ln)) continue;
        // remove trailing comma
        ln = ln.replace(/,+\s*$/, "");
        // try to extract "Name" or Name or `Name`
        const quoted = ln.match(/^[`"\[]\s*([^`"\]]+)\s*[`"\]]/);
        if (quoted) {
          cols.push(quoted[1].trim());
          continue;
        }
        // otherwise take first token before space (the column name)
        const tok = ln.split(/\s+/)[0];
        if (tok && !tok.toLowerCase().includes("(")) {
          cols.push(tok.replace(/(^["'`\[]|["'`\]]$)/g, ""));
        }
      }
      return cols.filter(Boolean);
    } catch (e) {
      return [];
    }
  };

  // Primary memo: compute cleanAnswer (short text) and extractedColumns using multiple strategies
  const { cleanAnswer, extractedColumns } = useMemo(() => {
    if (!data) return { cleanAnswer: "", extractedColumns: [] };

    let answerText = (data.answer || "").trim();
    let extracted = [];

    // Strategy A: detect pipe-based ASCII table header like "age | sex | cp | ..." (original approach)
    // This handles the case where the model printed a Markdown/ASCII table in the answer.
    const pipeHeaderMatch = answerText.match(/^([^\r\n]*\|[^\r\n]*\|[^\r\n]*)/m);
    if (pipeHeaderMatch) {
      // Extract that header line and split on |
      extracted = pipeHeaderMatch[1]
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);

      // Remove the header and everything after it from the answerText (we want a short answer)
      const cutIndex = answerText.indexOf(pipeHeaderMatch[1]);
      if (cutIndex >= 0) {
        answerText = answerText.substring(0, cutIndex).trim();
      }
    }

    // Strategy B: remove Python-style tuple/list dump from the Answer text
    // Example: 'Here are 10 records ...: [(52,), (53,), (70,), ...]'
    // Remove trailing bracketed list if present.
    // This also removes cases where the LLM prints rows inline as tuples.
    if (!extracted.length) {
      // Remove trailing list-of-tuples pattern after a colon (naive but works for common outputs)
      answerText = answerText.replace(/\s*:\s*\[.*\]\s*$/s, "").trim();
      // Also remove trailing tuple-list without the colon (rare)
      answerText = answerText.replace(/\s*\[?\(\d+.*\)\]?\s*$/s, "").trim();
    }

    // Strategy C: If we didn't find columns above, parse SQL query (if provided in data.sql_queries)
    // This will handle: SELECT age AS Age FROM heart LIMIT 10 -> extracts ["Age"]
    if (!extracted.length && Array.isArray(data.sql_queries) && data.sql_queries.length > 0) {
      try {
        const firstSql = data.sql_queries[0]; // take first query
        const colsFromSql = parseColumnsFromSQL(firstSql || "");
        if (colsFromSql && colsFromSql.length > 0) {
          // If SELECT * then parseColumnsFromSQL will produce ["*"]; ignore that case
          const meaningful = colsFromSql.filter((c) => c !== "*" && c !== "");
          if (meaningful.length > 0) extracted = meaningful;
        }
      } catch (e) {
        // ignore and continue to other strategies
      }
    }

    // Strategy D: If still nothing and raw_agent_output contains schema (sql_db_schema), parse it
    if (!extracted.length && data.raw_agent_output?.intermediate_steps) {
      try {
        // intermediate_steps often is an array of [action, observation]
        for (const step of data.raw_agent_output.intermediate_steps) {
          // Each step may be [tool_info, output], where tool_info may be object/dict with tool name or string
          const toolInfo = step && step[0];
          const output = step && step[1];
          // Look for sql_db_schema tool or CREATE TABLE text
          const toolName =
            (toolInfo && (toolInfo.tool || toolInfo.name || toolInfo?.type)) ||
            (typeof toolInfo === "string" ? toolInfo : null);
          if (String(toolName).toLowerCase().includes("sql_db_schema") || (typeof output === "string" && /create\s+table/i.test(output))) {
            const cols = parseColumnsFromSchema(output || "");
            if (cols && cols.length > 0) {
              extracted = cols;
              break;
            }
          }
        }
      } catch (e) {
        // ignore
      }
    }

    // Strategy E: final fallback to keys from the first row (col_1, col_2 or actual names)
    if (!extracted.length && data.rows && data.rows.length > 0) {
      const firstRow = data.rows[0];
      if (firstRow && typeof firstRow === "object") {
        extracted = Object.keys(firstRow);
      }
    }

    // If extracted found, but it's like ['col_1','col_2'], and the SQL provided an alias,
    // prefer the SQL alias names. (We already tried SQL earlier, but re-check: sometimes SQL query is in raw_agent_output only)
    // (Already handled above.)

    // Finally, remove lengthy printed tables/html leftover from the answer.
    // Also strip trailing "Returned Rows:" printed inline by model
    answerText = answerText.replace(/\n+Returned Rows:.*$/s, "").trim();

    return { cleanAnswer: answerText, extractedColumns: extracted || [] };
  }, [data]);

  // Helper to get value for a specific header index:
  // - If the row object contains the header name as a key -> return row[header]
  // - else fallback to using the column index into Object.values(row)
  const getCellValue = (row, headerIndex, headerName) => {
    if (row == null) return "";

    // If row is a primitive (not object) - return it directly
    if (typeof row !== "object") return row;

    // Direct key match (when rows are already objects with actual names)
    if (headerName in row) {
      return row[headerName];
    }

    // Otherwise use position based mapping (col_1, col_2 etc)
    const keys = Object.keys(row);
    if (keys.length > headerIndex) {
      return row[keys[headerIndex]];
    }

    // Final fallback to values[headerIndex]
    const vals = Object.values(row);
    return vals[headerIndex] ?? "";
  };

  // What to display as headers
  const headers = (extractedColumns && extractedColumns.length > 0
    ? extractedColumns
    : (data && data.rows && data.rows.length > 0 ? Object.keys(data.rows[0]) : []));

  return (
    <div
      className="p-4 bg-white rounded-4 shadow border border-secondary mt-3"
      style={{ maxHeight: "80vh", overflowY: "auto" }}
    >
      <h2 className="fs-4 fw-bold mb-3 text-primary">Result</h2>

      {/* Answer: short, cleaned answer */}
      {cleanAnswer && (
        <div className="mb-4">
          <h6 className="fw-semibold text-secondary">Answer:</h6>
          <div
            className="border rounded bg-light p-2 text-dark"
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: "160px",
              overflowY: "auto",
            }}
          >
            {cleanAnswer}
          </div>
        </div>
      )}

      {/* Generated SQL */}
      {data?.sql_queries?.length > 0 && (
        <div className="mb-4">
          <h6 className="fw-semibold text-secondary">Generated SQL:</h6>
          <div
            className="border rounded bg-grey text-dark p-2 mb-2"
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: "200px",
              overflowY: "auto",
              fontFamily: "monospace",
              fontSize: "0.9rem",
            }}
          >
            {data.sql_queries.join("\n\n")}
          </div>
        </div>
      )}

      {/* Returned Rows: render table with extracted headers */}
      {data?.rows && data.rows.length > 0 && (
        <div className="mt-4">
          <h6 className="fw-semibold text-secondary mb-2">Returned Rows:</h6>

          <div
            className="table-responsive border rounded"
            style={{
              maxHeight: "420px",
              overflow: "auto",
              fontSize: "0.9rem",
            }}
          >
            <table className="table table-sm table-bordered table-hover align-middle mb-0">
              <thead className="table-light sticky-top">
                <tr>
                  {headers.map((col, i) => (
                    <th key={i} className="text-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={i}>
                    {headers.map((h, j) => (
                      <td key={j} className="text-truncate" style={{ maxWidth: "240px" }}>
                        {String(getCellValue(row, j, h))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
