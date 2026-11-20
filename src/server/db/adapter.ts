/**
 * Data adapter: central PostgreSQL / Drizzle ORM boundary for server services and repositories.
 * Strictly connects to PostgreSQL — never falls back to in-memory or preview storage.
 */
import { is, Table, getTableColumns, getTableName, sql as drizzleSql } from "drizzle-orm";
import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../../../drizzle/schema";
import {
  getDrizzleDb,
  getPostgresSql,
  verifyDatabaseConnection,
  withDbTransaction,
  type DrizzleDb,
  type PostgresSql,
} from "./drizzle";
import { hashPassword } from "../auth/crypto";

const rlsDbStorage = new AsyncLocalStorage<DbClient>();

export type QueryError = {
  message: string;
  code?: string;
};

export type QueryResult<T = any> = {
  data: T;
  error: QueryError | null;
  count?: number | null;
};

type ColumnMeta = {
  sqlName: string;
  dataType: string;
  columnType: string;
  notNull: boolean;
  hasDefault: boolean;
};

type TableMeta = {
  tableName: string;
  table: any;
  columns: Map<string, ColumnMeta>;
};

const TABLE_REGISTRY = new Map<string, TableMeta>();

for (const val of Object.values(schema)) {
  if (is(val, Table)) {
    const tableName = getTableName(val);
    const cols = getTableColumns(val);
    const colMap = new Map<string, ColumnMeta>();
    for (const col of Object.values(cols) as any[]) {
      colMap.set(col.name, {
        sqlName: col.name,
        dataType: col.dataType,
        columnType: col.columnType,
        notNull: Boolean(col.notNull),
        hasDefault: Boolean(col.hasDefault),
      });
    }
    TABLE_REGISTRY.set(tableName, { tableName, table: val, columns: colMap });
  }
}

// Known FK relationships (childTable.fkCol -> parentTable.id)
const BELONGS_TO_FK: Record<string, string> = {
  institutions: "institution_id",
  contracts: "contract_id",
  classes: "class_id",
  subjects: "subject_id",
  rooms: "room_id",
  modules: "module_id",
  exams: "exam_id",
  academic_levels: "level_id",
  groups: "group_id",
  assessments: "assessment_id",
  programs: "program_id",
  specializations: "specialization_id",
  skills: "skill_id",
  questions: "question_id",
  attempts: "attempt_id",
  lessons: "lesson_id",
  payments: "payment_id",
  official_contracts: "contract_id",
};

const HAS_MANY_FK: Record<string, Record<string, string>> = {
  exams: { questions: "exam_id" },
  questions: { options: "question_id" },
  assessments: { results: "assessment_id", homework_submissions: "assessment_id" },
  institutions: { contracts: "institution_id", payments: "institution_id" },
};

type RelationSpec = {
  relationTable: string;
  alias: string;
  inner: boolean;
  fields: string[];
  nested: RelationSpec[];
};

type FilterCondition =
  | { type: "cmp"; targetTable?: string; col: string; op: "=" | "<>" | ">" | ">=" | "<" | "<=" | "LIKE" | "ILIKE"; val: any }
  | { type: "is"; targetTable?: string; col: string; val: null | boolean; negate?: boolean }
  | { type: "in"; targetTable?: string; col: string; vals: any[] }
  | { type: "or"; targetTable?: string; expr: string };

function quoteIdent(ident: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ident)) {
    throw new Error(`[Database] Invalid SQL identifier: ${ident}`);
  }
  return `"${ident}"`;
}

function getTableMeta(tableName: string): TableMeta {
  const meta = TABLE_REGISTRY.get(tableName);
  if (!meta) {
    throw new Error(`[Database] Unknown table "${tableName}" (not defined in drizzle/schema.ts).`);
  }
  return meta;
}

function validateColumn(meta: TableMeta, colName: string): ColumnMeta {
  const col = meta.columns.get(colName);
  if (!col) {
    throw new Error(`[Database] Unknown column "${colName}" on table "${meta.tableName}".`);
  }
  return col;
}

function formatParamForColumn(val: any, colMeta?: ColumnMeta): any {
  if (val === undefined) return null;
  if (val === null) return null;
  if (colMeta && (colMeta.dataType === "json" || colMeta.columnType === "PgJsonb")) {
    return typeof val === "string" ? val : JSON.stringify(val);
  }
  return val;
}

function applyInsertDefaults(meta: TableMeta, rawRow: Record<string, any>): Record<string, any> {
  const row: Record<string, any> = { ...rawRow };
  const nowIso = new Date().toISOString();

  if (meta.columns.has("updated_at") && row.updated_at === undefined) {
    row.updated_at = nowIso;
  }
  if (meta.columns.has("archived") && row.archived === undefined) {
    row.archived = false;
  }
  if (meta.tableName === "profiles" && row.totp_enabled === undefined) {
    row.totp_enabled = false;
  }
  if (meta.tableName === "institutions" && row.is_trial === undefined) {
    row.is_trial = false;
  }
  if (meta.tableName === "audit_logs") {
    if (row.metadata === undefined) row.metadata = {};
    if (row.result === undefined) row.result = "success";
  }
  if (meta.tableName === "attempts" && row.started_at === undefined) {
    row.started_at = nowIso;
  }
  if (meta.tableName === "lesson_completions" && row.completed_at === undefined) {
    row.completed_at = nowIso;
  }
  if (meta.tableName === "payments" && row.paid_at === undefined) {
    row.paid_at = nowIso;
  }
  if (meta.tableName === "invoices" && row.issued_at === undefined) {
    row.issued_at = nowIso;
  }
  if (meta.tableName === "licenses" && row.issued_at === undefined) {
    row.issued_at = nowIso;
  }
  if (meta.tableName === "homework_submissions" && row.submitted_at === undefined) {
    row.submitted_at = nowIso;
  }
  if (meta.tableName === "trial_requests" && row.status === undefined) {
    row.status = "pending";
  }
  if (meta.tableName === "official_contracts" && row.state === undefined) {
    row.state = "draft";
  }
  if (meta.tableName === "contracts") {
    if (row.amount === undefined) row.amount = 9000;
    if (row.duration_months === undefined) row.duration_months = 12;
    if (row.snapshot === undefined) row.snapshot = {};
    if (row.status === undefined) row.status = "created";
  }

  return row;
}

/**
 * Splits a PostgREST select projection string at top-level commas (respecting parentheses).
 */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseSelectSpec(selectStr: string | null): {
  baseFields: string[];
  relations: RelationSpec[];
} {
  if (!selectStr || selectStr.trim() === "*") {
    return { baseFields: ["*"], relations: [] };
  }

  const baseFields: string[] = [];
  const relations: RelationSpec[] = [];

  for (const token of splitTopLevel(selectStr)) {
    const relMatch = token.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(!inner)?\(([\s\S]+)\)$/);
    if (relMatch) {
      const relationTable = relMatch[1];
      const inner = Boolean(relMatch[2]);
      const innerSpec = parseSelectSpec(relMatch[3]);
      relations.push({
        relationTable,
        alias: relationTable,
        inner,
        fields: innerSpec.baseFields,
        nested: innerSpec.relations,
      });
    } else {
      baseFields.push(token.trim());
    }
  }

  if (baseFields.length === 0 && relations.length === 0) {
    baseFields.push("*");
  }
  return { baseFields, relations };
}

function parseOrToken(token: string): { col: string; op: string; rawVal: string } | null {
  // Handle col.in.(a,b,c)
  const inMatch = token.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.in\.\(([\s\S]*)\)$/);
  if (inMatch) {
    return { col: inMatch[1], op: "in", rawVal: inMatch[2] };
  }
  const match = token.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.(eq|neq|gt|gte|lt|lte|like|ilike|is)\.([\s\S]*)$/);
  if (!match) return null;
  return { col: match[1], op: match[2], rawVal: match[3] };
}

function toDbError(err: any): QueryError {
  const message = err?.message ? String(err.message) : String(err);
  const code = err?.code ? String(err.code) : undefined;
  return { message, code };
}

class PostgresQueryBuilder {
  private meta: TableMeta;
  private sql: PostgresSql;
  private inTransaction: boolean;
  private operation: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private selectedFields: string | null = null;
  private selectOpts: { count?: "exact" | "planned" | "estimated"; head?: boolean } = {};
  private payload: any = null;
  private upsertConflict: string | null = null;
  private returningSelect: string | null = null;
  private filters: FilterCondition[] = [];
  private orders: Array<{ col: string; ascending: boolean }> = [];
  private limitCount: number | null = null;
  private offsetCount: number | null = null;
  private mode: "many" | "single" | "maybeSingle" = "many";

  constructor(tableName: string, sql: PostgresSql, inTransaction = false) {
    this.meta = getTableMeta(tableName);
    this.sql = sql;
    this.inTransaction = inTransaction;
  }

  select(fields?: string, opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) {
    if (this.operation === "select") {
      this.selectedFields = fields ?? "*";
      this.selectOpts = opts ?? {};
    } else {
      this.returningSelect = fields ?? "*";
    }
    return this;
  }

  insert(data: Record<string, any> | Record<string, any>[]) {
    this.operation = "insert";
    this.payload = data;
    return this;
  }

  update(data: Record<string, any>) {
    this.operation = "update";
    this.payload = data;
    return this;
  }

  upsert(data: Record<string, any> | Record<string, any>[], opts?: { onConflict?: string }) {
    this.operation = "upsert";
    this.payload = data;
    this.upsertConflict = opts?.onConflict ?? null;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  private splitCol(col: string): { targetTable?: string; colName: string } {
    const dotIdx = col.indexOf(".");
    if (dotIdx > 0) {
      return {
        targetTable: col.slice(0, dotIdx),
        colName: col.slice(dotIdx + 1),
      };
    }
    return { colName: col };
  }

  eq(col: string, val: any) {
    const { targetTable, colName } = this.splitCol(col);
    this.filters.push({ type: "cmp", targetTable, col: colName, op: "=", val });
    return this;
  }

  neq(col: string, val: any) {
    const { targetTable, colName } = this.splitCol(col);
    this.filters.push({ type: "cmp", targetTable, col: colName, op: "<>", val });
    return this;
  }

  gt(col: string, val: any) {
    const { targetTable, colName } = this.splitCol(col);
    this.filters.push({ type: "cmp", targetTable, col: colName, op: ">", val });
    return this;
  }

  gte(col: string, val: any) {
    const { targetTable, colName } = this.splitCol(col);
    this.filters.push({ type: "cmp", targetTable, col: colName, op: ">=", val });
    return this;
  }

  lt(col: string, val: any) {
    const { targetTable, colName } = this.splitCol(col);
    this.filters.push({ type: "cmp", targetTable, col: colName, op: "<", val });
    return this;
  }

  lte(col: string, val: any) {
    const { targetTable, colName } = this.splitCol(col);
    this.filters.push({ type: "cmp", targetTable, col: colName, op: "<=", val });
    return this;
  }

  like(col: string, val: string) {
    const { targetTable, colName } = this.splitCol(col);
    this.filters.push({ type: "cmp", targetTable, col: colName, op: "LIKE", val });
    return this;
  }

  ilike(col: string, val: string) {
    const { targetTable, colName } = this.splitCol(col);
    this.filters.push({ type: "cmp", targetTable, col: colName, op: "ILIKE", val });
    return this;
  }

  is(col: string, val: null | boolean) {
    const { targetTable, colName } = this.splitCol(col);
    this.filters.push({ type: "is", targetTable, col: colName, val });
    return this;
  }

  in(col: string, vals: any[]) {
    const { targetTable, colName } = this.splitCol(col);
    this.filters.push({ type: "in", targetTable, col: colName, vals });
    return this;
  }

  not(col: string, op: string, val: any) {
    const { targetTable, colName } = this.splitCol(col);
    if (op === "is") {
      this.filters.push({ type: "is", targetTable, col: colName, val, negate: true });
    } else if (op === "eq") {
      this.filters.push({ type: "cmp", targetTable, col: colName, op: "<>", val });
    } else {
      throw new Error(`[Database] Unsupported .not() operator: ${op}`);
    }
    return this;
  }

  or(expr: string, opts?: { referencedTable?: string }) {
    this.filters.push({ type: "or", targetTable: opts?.referencedTable, expr });
    return this;
  }

  match(query: Record<string, any>) {
    for (const [k, v] of Object.entries(query)) {
      this.eq(k, v);
    }
    return this;
  }

  filter(col: string, op: string, val: any) {
    switch (op) {
      case "eq": return this.eq(col, val);
      case "neq": return this.neq(col, val);
      case "gt": return this.gt(col, val);
      case "gte": return this.gte(col, val);
      case "lt": return this.lt(col, val);
      case "lte": return this.lte(col, val);
      case "like": return this.like(col, val);
      case "ilike": return this.ilike(col, val);
      case "is": return this.is(col, val);
      case "in": return this.in(col, val);
      default:
        throw new Error(`[Database] Unsupported .filter() operator: ${op}`);
    }
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, ascending: opts?.ascending ?? true });
    return this;
  }

  limit(n: number) {
    this.limitCount = n;
    return this;
  }

  range(from: number, to: number) {
    this.offsetCount = Math.max(0, from);
    this.limitCount = Math.max(0, to - from + 1);
    return this;
  }

  single(): Promise<QueryResult<any>> {
    this.mode = "single";
    return this.execute();
  }

  maybeSingle(): Promise<QueryResult<any>> {
    this.mode = "maybeSingle";
    return this.execute();
  }

  then<TResult1 = QueryResult<any>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<any>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private buildWhereClause(
    aliasMap: Map<string, { alias: string; meta: TableMeta }>,
    params: any[],
  ): string {
    if (this.filters.length === 0) return "";
    const parts: string[] = [];

    const resolveColSql = (targetTable: string | undefined, col: string) => {
      const tableKey = targetTable ?? this.meta.tableName;
      const entry = aliasMap.get(tableKey);
      if (!entry) {
        throw new Error(`[Database] Table "${tableKey}" is not joined in this query for filter "${col}".`);
      }
      validateColumn(entry.meta, col);
      return {
        sqlExpr: `${entry.alias}.${quoteIdent(col)}`,
        colMeta: entry.meta.columns.get(col)!,
      };
    };

    const addParam = (val: any, colMeta?: ColumnMeta) => {
      params.push(formatParamForColumn(val, colMeta));
      return `$${params.length}`;
    };

    for (const f of this.filters) {
      if (f.type === "cmp") {
        const { sqlExpr, colMeta } = resolveColSql(f.targetTable, f.col);
        if (f.val === null && (f.op === "=" || f.op === "<>")) {
          parts.push(`${sqlExpr} ${f.op === "=" ? "IS NULL" : "IS NOT NULL"}`);
        } else {
          const p = addParam(f.val, colMeta);
          if (f.op === "ILIKE" || f.op === "LIKE") {
            parts.push(`CAST(${sqlExpr} AS text) ${f.op} ${p}`);
          } else {
            parts.push(`${sqlExpr} ${f.op} ${p}`);
          }
        }
      } else if (f.type === "is") {
        const { sqlExpr } = resolveColSql(f.targetTable, f.col);
        if (f.val === null) {
          parts.push(`${sqlExpr} ${f.negate ? "IS NOT NULL" : "IS NULL"}`);
        } else if (typeof f.val === "boolean") {
          parts.push(`${sqlExpr} ${f.negate ? "IS NOT" : "IS"} ${f.val ? "TRUE" : "FALSE"}`);
        }
      } else if (f.type === "in") {
        const { sqlExpr, colMeta } = resolveColSql(f.targetTable, f.col);
        if (!f.vals || f.vals.length === 0) {
          parts.push("FALSE");
        } else {
          const placeholders = f.vals.map((v) => addParam(v, colMeta));
          parts.push(`${sqlExpr} IN (${placeholders.join(", ")})`);
        }
      } else if (f.type === "or") {
        const tokens = splitTopLevel(f.expr);
        const orClauses: string[] = [];
        for (const tok of tokens) {
          const parsed = parseOrToken(tok);
          if (!parsed) {
            throw new Error(`[Database] Unsupported .or() expression token: ${tok}`);
          }
          const { sqlExpr, colMeta } = resolveColSql(f.targetTable, parsed.col);
          if (parsed.op === "in") {
            const items = parsed.rawVal
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            if (items.length === 0) {
              orClauses.push("FALSE");
            } else {
              const placeholders = items.map((v) => addParam(v, colMeta));
              orClauses.push(`${sqlExpr} IN (${placeholders.join(", ")})`);
            }
          } else if (parsed.op === "is") {
            if (parsed.rawVal === "null") orClauses.push(`${sqlExpr} IS NULL`);
            else if (parsed.rawVal === "true") orClauses.push(`${sqlExpr} IS TRUE`);
            else if (parsed.rawVal === "false") orClauses.push(`${sqlExpr} IS FALSE`);
          } else {
            const sqlOp =
              parsed.op === "eq" ? "=" :
              parsed.op === "neq" ? "<>" :
              parsed.op === "gt" ? ">" :
              parsed.op === "gte" ? ">=" :
              parsed.op === "lt" ? "<" :
              parsed.op === "lte" ? "<=" :
              parsed.op === "like" ? "LIKE" : "ILIKE";
            const p = addParam(parsed.rawVal, colMeta);
            if (sqlOp === "ILIKE" || sqlOp === "LIKE") {
              orClauses.push(`CAST(${sqlExpr} AS text) ${sqlOp} ${p}`);
            } else {
              orClauses.push(`${sqlExpr} ${sqlOp} ${p}`);
            }
          }
        }
        if (orClauses.length > 0) {
          parts.push(`(${orClauses.join(" OR ")})`);
        }
      }
    }

    return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
  }

  private finalizeSingleResult(rows: any[]): QueryResult<any> {
    if (this.mode === "single") {
      if (rows.length === 0) {
        return { data: null, error: { message: "No rows found", code: "PGRST116" } };
      }
      if (rows.length > 1) {
        return { data: null, error: { message: "Multiple rows returned for single()", code: "PGRST116" } };
      }
      return { data: rows[0], error: null };
    }
    if (this.mode === "maybeSingle") {
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }

  private async executeSelect(): Promise<QueryResult<any>> {
    const spec = parseSelectSpec(this.selectedFields);
    const baseAlias = `"_t0"`;
    const aliasMap = new Map<string, { alias: string; meta: TableMeta }>([
      [this.meta.tableName, { alias: baseAlias, meta: this.meta }],
    ]);

    const belongsToRelations: Array<{
      spec: RelationSpec;
      relMeta: TableMeta;
      alias: string;
      fkCol: string;
      nestedJoins: Array<{ spec: RelationSpec; relMeta: TableMeta; alias: string; parentAlias: string; fkCol: string }>;
    }> = [];
    const hasManyRelations: RelationSpec[] = [];

    let joinCounter = 1;
    for (const rel of spec.relations) {
      const fkCol = BELONGS_TO_FK[rel.relationTable];
      if (fkCol && this.meta.columns.has(fkCol)) {
        const relMeta = getTableMeta(rel.relationTable);
        const alias = `"_j${joinCounter++}"`;
        aliasMap.set(rel.relationTable, { alias, meta: relMeta });

        const nestedJoins: Array<{ spec: RelationSpec; relMeta: TableMeta; alias: string; parentAlias: string; fkCol: string }> = [];
        for (const sub of rel.nested) {
          const subFk = BELONGS_TO_FK[sub.relationTable];
          if (subFk && relMeta.columns.has(subFk)) {
            const subMeta = getTableMeta(sub.relationTable);
            const subAlias = `"_j${joinCounter++}"`;
            aliasMap.set(sub.relationTable, { alias: subAlias, meta: subMeta });
            nestedJoins.push({ spec: sub, relMeta: subMeta, alias: subAlias, parentAlias: alias, fkCol: subFk });
          }
        }
        belongsToRelations.push({ spec: rel, relMeta, alias, fkCol, nestedJoins });
      } else if (HAS_MANY_FK[this.meta.tableName]?.[rel.relationTable]) {
        hasManyRelations.push(rel);
      } else {
        throw new Error(
          `[Database] Unsupported relation "${rel.relationTable}" from table "${this.meta.tableName}".`,
        );
      }
    }

    const joinsSql = belongsToRelations
      .map((j) => {
        const joinType = j.spec.inner ? "INNER JOIN" : "LEFT JOIN";
        let sqlPart = `${joinType} "public".${quoteIdent(j.relMeta.tableName)} ${j.alias} ON ${j.alias}."id" = ${baseAlias}.${quoteIdent(j.fkCol)}`;
        for (const nj of j.nestedJoins) {
          const nType = nj.spec.inner ? "INNER JOIN" : "LEFT JOIN";
          sqlPart += ` ${nType} "public".${quoteIdent(nj.relMeta.tableName)} ${nj.alias} ON ${nj.alias}."id" = ${nj.parentAlias}.${quoteIdent(nj.fkCol)}`;
        }
        return sqlPart;
      })
      .join(" ");

    const params: any[] = [];
    const whereSql = this.buildWhereClause(aliasMap, params);

    // Count-only head query
    if (this.selectOpts.head) {
      const countSql = `SELECT COUNT(*)::int AS cnt FROM "public".${quoteIdent(this.meta.tableName)} ${baseAlias}${joinsSql ? ` ${joinsSql}` : ""}${whereSql}`;
      const rows = await this.sql.unsafe(countSql, params);
      const count = rows[0]?.cnt ?? 0;
      return { data: null, error: null, count };
    }

    // Projection columns
    const selectCols: string[] = [];
    if (spec.baseFields.includes("*")) {
      for (const colName of this.meta.columns.keys()) {
        selectCols.push(`${baseAlias}.${quoteIdent(colName)} AS ${quoteIdent(`_b__${colName}`)}`);
      }
    } else {
      for (const colName of spec.baseFields) {
        validateColumn(this.meta, colName);
        selectCols.push(`${baseAlias}.${quoteIdent(colName)} AS ${quoteIdent(`_b__${colName}`)}`);
      }
    }

    for (const j of belongsToRelations) {
      const relFields = j.spec.fields.includes("*") ? [...j.relMeta.columns.keys()] : j.spec.fields;
      for (const f of relFields) {
        validateColumn(j.relMeta, f);
        selectCols.push(`${j.alias}.${quoteIdent(f)} AS ${quoteIdent(`_r_${j.spec.alias}__${f}`)}`);
      }
      selectCols.push(`${j.alias}."id" IS NOT NULL AS ${quoteIdent(`_r_${j.spec.alias}__exists`)}`);
      for (const nj of j.nestedJoins) {
        const subFields = nj.spec.fields.includes("*") ? [...nj.relMeta.columns.keys()] : nj.spec.fields;
        for (const sf of subFields) {
          validateColumn(nj.relMeta, sf);
          selectCols.push(`${nj.alias}.${quoteIdent(sf)} AS ${quoteIdent(`_r_${j.spec.alias}__n_${nj.spec.alias}__${sf}`)}`);
        }
        selectCols.push(`${nj.alias}."id" IS NOT NULL AS ${quoteIdent(`_r_${j.spec.alias}__n_${nj.spec.alias}__exists`)}`);
      }
    }

    if (this.selectOpts.count === "exact") {
      selectCols.push(`COUNT(*) OVER()::int AS "_total_count"`);
    }

    let orderSql = "";
    if (this.orders.length > 0) {
      const orderTerms = this.orders.map((o) => {
        validateColumn(this.meta, o.col);
        return `${baseAlias}.${quoteIdent(o.col)} ${o.ascending ? "ASC" : "DESC"}`;
      });
      orderSql = ` ORDER BY ${orderTerms.join(", ")}`;
    }

    let limitSql = "";
    const effectiveLimit = this.mode === "single" || this.mode === "maybeSingle" ? (this.limitCount ?? 2) : this.limitCount;
    if (effectiveLimit !== null) {
      params.push(effectiveLimit);
      limitSql += ` LIMIT $${params.length}`;
    }
    if (this.offsetCount !== null) {
      params.push(this.offsetCount);
      limitSql += ` OFFSET $${params.length}`;
    }

    const fullSql = `SELECT ${selectCols.join(", ")} FROM "public".${quoteIdent(this.meta.tableName)} ${baseAlias}${joinsSql ? ` ${joinsSql}` : ""}${whereSql}${orderSql}${limitSql}`;
    const rawRows = await this.sql.unsafe(fullSql, params);

    let totalCount: number | null = this.selectOpts.count === "exact" ? 0 : null;
    const mappedRows = rawRows.map((raw: any) => {
      if (this.selectOpts.count === "exact" && raw._total_count !== undefined) {
        totalCount = Number(raw._total_count);
      }
      const obj: Record<string, any> = {};
      for (const [key, val] of Object.entries(raw)) {
        if (key.startsWith("_b__")) {
          obj[key.slice(4)] = val;
        }
      }
      for (const j of belongsToRelations) {
        const exists = Boolean(raw[`_r_${j.spec.alias}__exists`]);
        if (!exists) {
          obj[j.spec.alias] = null;
        } else {
          const relObj: Record<string, any> = {};
          const relFields = j.spec.fields.includes("*") ? [...j.relMeta.columns.keys()] : j.spec.fields;
          for (const f of relFields) {
            relObj[f] = raw[`_r_${j.spec.alias}__${f}`];
          }
          for (const nj of j.nestedJoins) {
            const subExists = Boolean(raw[`_r_${j.spec.alias}__n_${nj.spec.alias}__exists`]);
            if (!subExists) {
              relObj[nj.spec.alias] = null;
            } else {
              const subObj: Record<string, any> = {};
              const subFields = nj.spec.fields.includes("*") ? [...nj.relMeta.columns.keys()] : nj.spec.fields;
              for (const sf of subFields) {
                subObj[sf] = raw[`_r_${j.spec.alias}__n_${nj.spec.alias}__${sf}`];
              }
              relObj[nj.spec.alias] = subObj;
            }
          }
          obj[j.spec.alias] = relObj;
        }
      }
      return obj;
    });

    // Hydrate one-to-many child relations if requested (e.g. exams -> questions -> options)
    if (hasManyRelations.length > 0 && mappedRows.length > 0) {
      await this.hydrateHasMany(this.meta.tableName, mappedRows, hasManyRelations);
    }

    if (this.selectOpts.count === "exact" && totalCount === 0 && rawRows.length === 0 && this.offsetCount) {
      const countSql = `SELECT COUNT(*)::int AS cnt FROM "public".${quoteIdent(this.meta.tableName)} ${baseAlias}${joinsSql ? ` ${joinsSql}` : ""}${whereSql}`;
      const countParams = params.slice(0, params.length - (effectiveLimit !== null ? 1 : 0) - (this.offsetCount !== null ? 1 : 0));
      const cRows = await this.sql.unsafe(countSql, countParams);
      totalCount = cRows[0]?.cnt ?? 0;
    }

    if (this.mode !== "many") {
      return this.finalizeSingleResult(mappedRows);
    }

    return {
      data: mappedRows,
      error: null,
      ...(totalCount !== null ? { count: totalCount } : {}),
    };
  }

  private async hydrateHasMany(parentTable: string, parentRows: any[], specs: RelationSpec[]) {
    const parentIds = parentRows.map((r) => r.id).filter(Boolean);
    if (parentIds.length === 0) return;

    for (const rel of specs) {
      const fkCol = HAS_MANY_FK[parentTable]?.[rel.relationTable];
      if (!fkCol) continue;
      const childMeta = getTableMeta(rel.relationTable);
      const childFields = rel.fields.includes("*") ? [...childMeta.columns.keys()] : [...new Set([...rel.fields, fkCol])];
      for (const f of childFields) validateColumn(childMeta, f);

      const colsSql = childFields.map((c) => quoteIdent(c)).join(", ");
      const childQuery = `SELECT ${colsSql} FROM "public".${quoteIdent(childMeta.tableName)} WHERE ${quoteIdent(fkCol)} IN (${parentIds.map((_, i) => `$${i + 1}`).join(", ")})`;
      const childRows = await this.sql.unsafe(childQuery, parentIds);

      if (rel.nested.length > 0 && childRows.length > 0) {
        await this.hydrateHasMany(rel.relationTable, childRows, rel.nested);
      }

      const byParent = new Map<string, any[]>();
      for (const cr of childRows) {
        const pid = cr[fkCol];
        const list = byParent.get(pid) ?? [];
        const cleanRow: Record<string, any> = {};
        for (const f of rel.fields.includes("*") ? [...childMeta.columns.keys()] : rel.fields) {
          cleanRow[f] = cr[f];
        }
        for (const nestedSpec of rel.nested) {
          cleanRow[nestedSpec.alias] = cr[nestedSpec.alias] ?? [];
        }
        list.push(cleanRow);
        byParent.set(pid, list);
      }

      for (const pr of parentRows) {
        pr[rel.alias] = byParent.get(pr.id) ?? [];
      }
    }
  }

  private buildReturningSql(): string {
    if (!this.returningSelect || this.returningSelect.trim() === "*") {
      return " RETURNING *";
    }
    const spec = parseSelectSpec(this.returningSelect);
    const cols = spec.baseFields.map((f) => {
      if (f === "*") return "*";
      validateColumn(this.meta, f);
      return quoteIdent(f);
    });
    return ` RETURNING ${cols.join(", ")}`;
  }

  private async executeInsert(): Promise<QueryResult<any>> {
    const isArray = Array.isArray(this.payload);
    const rawItems: Record<string, any>[] = isArray ? this.payload : [this.payload];
    if (rawItems.length === 0) {
      return { data: [], error: null };
    }

    const items = rawItems.map((item) => applyInsertDefaults(this.meta, item));
    const cols = [...new Set(items.flatMap((it) => Object.keys(it)))];
    for (const col of cols) validateColumn(this.meta, col);

    const params: any[] = [];
    const valueTuples: string[] = [];
    for (const item of items) {
      const tuple: string[] = [];
      for (const col of cols) {
        const colMeta = this.meta.columns.get(col)!;
        if (item[col] === undefined) {
          tuple.push("DEFAULT");
        } else {
          params.push(formatParamForColumn(item[col], colMeta));
          tuple.push(`$${params.length}`);
        }
      }
      valueTuples.push(`(${tuple.join(", ")})`);
    }

    const returningSql = this.returningSelect ? this.buildReturningSql() : " RETURNING *";
    const sqlText = `INSERT INTO "public".${quoteIdent(this.meta.tableName)} (${cols.map(quoteIdent).join(", ")}) VALUES ${valueTuples.join(", ")}${returningSql}`;
    const rows = await this.sql.unsafe(sqlText, params);

    if (this.mode !== "many") {
      return this.finalizeSingleResult(rows);
    }
    return { data: isArray ? rows : rows[0] ?? null, error: null };
  }

  private async executeUpsert(): Promise<QueryResult<any>> {
    const isArray = Array.isArray(this.payload);
    const rawItems: Record<string, any>[] = isArray ? this.payload : [this.payload];
    if (rawItems.length === 0) {
      return { data: [], error: null };
    }

    const items = rawItems.map((item) => applyInsertDefaults(this.meta, item));
    const cols = [...new Set(items.flatMap((it) => Object.keys(it)))];
    for (const col of cols) validateColumn(this.meta, col);

    const conflictCols = (this.upsertConflict ?? "id")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    for (const c of conflictCols) validateColumn(this.meta, c);

    const params: any[] = [];
    const valueTuples: string[] = [];
    for (const item of items) {
      const tuple: string[] = [];
      for (const col of cols) {
        const colMeta = this.meta.columns.get(col)!;
        if (item[col] === undefined) {
          tuple.push("DEFAULT");
        } else {
          params.push(formatParamForColumn(item[col], colMeta));
          tuple.push(`$${params.length}`);
        }
      }
      valueTuples.push(`(${tuple.join(", ")})`);
    }

    const conflictSet = new Set(conflictCols);
    const updateCols = cols.filter((c) => !conflictSet.has(c));
    const conflictAction =
      updateCols.length > 0
        ? `DO UPDATE SET ${updateCols.map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`).join(", ")}`
        : "DO NOTHING";

    const returningSql = this.returningSelect ? this.buildReturningSql() : " RETURNING *";
    const sqlText = `INSERT INTO "public".${quoteIdent(this.meta.tableName)} (${cols.map(quoteIdent).join(", ")}) VALUES ${valueTuples.join(", ")} ON CONFLICT (${conflictCols.map(quoteIdent).join(", ")}) ${conflictAction}${returningSql}`;
    const rows = await this.sql.unsafe(sqlText, params);

    if (this.mode !== "many") {
      return this.finalizeSingleResult(rows);
    }
    return { data: isArray ? rows : rows[0] ?? null, error: null };
  }

  private async executeUpdate(): Promise<QueryResult<any>> {
    const patch = { ...(this.payload ?? {}) };
    if (this.meta.columns.has("updated_at") && patch.updated_at === undefined) {
      patch.updated_at = new Date().toISOString();
    }

    const keys = Object.keys(patch);
    if (keys.length === 0) {
      return { data: this.mode === "many" ? [] : null, error: null };
    }

    const params: any[] = [];
    const setClauses = keys.map((k) => {
      const colMeta = validateColumn(this.meta, k);
      params.push(formatParamForColumn(patch[k], colMeta));
      return `${quoteIdent(k)} = $${params.length}`;
    });

    const baseAlias = `"_t0"`;
    const aliasMap = new Map<string, { alias: string; meta: TableMeta }>([
      [this.meta.tableName, { alias: baseAlias, meta: this.meta }],
    ]);
    const whereSql = this.buildWhereClause(aliasMap, params);
    const returningSql = this.returningSelect ? this.buildReturningSql() : " RETURNING *";

    const sqlText = `UPDATE "public".${quoteIdent(this.meta.tableName)} ${baseAlias} SET ${setClauses.join(", ")}${whereSql}${returningSql}`;
    const rows = await this.sql.unsafe(sqlText, params);

    if (this.mode !== "many") {
      return this.finalizeSingleResult(rows);
    }
    return { data: rows, error: null };
  }

  private async executeDelete(): Promise<QueryResult<any>> {
    const baseAlias = `"_t0"`;
    const aliasMap = new Map<string, { alias: string; meta: TableMeta }>([
      [this.meta.tableName, { alias: baseAlias, meta: this.meta }],
    ]);
    const params: any[] = [];
    const whereSql = this.buildWhereClause(aliasMap, params);
    const returningSql = this.returningSelect ? this.buildReturningSql() : " RETURNING *";

    const sqlText = `DELETE FROM "public".${quoteIdent(this.meta.tableName)} ${baseAlias}${whereSql}${returningSql}`;
    const rows = await this.sql.unsafe(sqlText, params);

    if (this.mode !== "many") {
      return this.finalizeSingleResult(rows);
    }
    return { data: rows, error: null };
  }

  private async executeWithSql(execSql: PostgresSql): Promise<QueryResult<any>> {
    const prevSql = this.sql;
    this.sql = execSql;
    try {
      switch (this.operation) {
        case "select":
          return await this.executeSelect();
        case "insert":
          return await this.executeInsert();
        case "upsert":
          return await this.executeUpsert();
        case "update":
          return await this.executeUpdate();
        case "delete":
          return await this.executeDelete();
      }
    } finally {
      this.sql = prevSql;
    }
  }

  private async execute(): Promise<QueryResult<any>> {
    try {
      if (this.inTransaction && typeof (this.sql as any).savepoint === "function") {
        return await (this.sql as any).savepoint((spSql: PostgresSql) => this.executeWithSql(spSql));
      }
      return await this.executeWithSql(this.sql);
    } catch (err: any) {
      return { data: null, error: toDbError(err) };
    }
  }
}

export interface DbClient {
  drizzle: DrizzleDb;
  sql: PostgresSql;
  from: (table: string) => PostgresQueryBuilder;
  rpc: (fn: string, args?: Record<string, any>) => Promise<QueryResult<any>>;
  transaction: <T>(fn: (tx: Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0]) => Promise<T>) => Promise<T>;
  execute: (query: any, params?: any[]) => Promise<any>;
  auth: {
    admin: {
      createUser: (params: {
        email: string;
        password?: string;
        email_confirm?: boolean;
        user_metadata?: Record<string, any>;
      }) => Promise<QueryResult<{ user: { id: string; email: string } | null }>>;
      deleteUser: (userId: string) => Promise<QueryResult<{ user: null }>>;
      getUserById: (id: string) => Promise<QueryResult<{ user: any }>>;
      listUsers: (opts?: { page?: number; perPage?: number }) => Promise<QueryResult<{ users: any[] }>>;
      updateUserById: (id: string, attrs: { password?: string; email_confirm?: boolean; user_metadata?: Record<string, any> }) => Promise<QueryResult<{ user: any }>>;
    };
  };
}

function createPostgresDbClient(drizzleDb: DrizzleDb, sql: PostgresSql, isTransaction = false): DbClient {
  return {
    drizzle: drizzleDb,
    sql,
    from: (table: string) => new PostgresQueryBuilder(table, sql, isTransaction),
    rpc: async (fn: string, args: Record<string, any> = {}): Promise<QueryResult<any>> => {
      try {
        switch (fn) {
          case "set_config": {
            const rows = await sql`SELECT set_config(${String(args.setting)}, ${String(args.value)}, ${Boolean(args.is_local ?? true)}) AS value`;
            return { data: rows[0]?.value ?? null, error: null };
          }
          case "has_role": {
            const rows = await sql`SELECT public.has_role(${args._user_id}::uuid, ${args._role}::public.app_role) AS result`;
            return { data: Boolean(rows[0]?.result), error: null };
          }
          case "expire_subscriptions": {
            const rows = await sql`SELECT * FROM public.expire_subscriptions()`;
            return { data: rows, error: null };
          }
          case "generate_installation_id": {
            const rows = await sql`SELECT public.generate_installation_id() AS result`;
            return { data: rows[0]?.result ?? null, error: null };
          }
          case "verify_license": {
            const rows = await sql`SELECT public.verify_license(${args._institution_id}::uuid, ${args._license_key}::text, ${args._installation_id ?? null}::text) AS result`;
            return { data: rows[0]?.result ?? null, error: null };
          }
          case "transition_official_contract": {
            const runTransition = async (tx: any) => {
              await tx`SELECT set_config('app.current_user_id', ${String(args._actor)}, true)`;
              await tx`
                SELECT public.transition_official_contract(
                  ${args._id}::uuid,
                  ${args._actor}::uuid,
                  ${args._action}::text,
                  ${args._hash}::text,
                  ${args._evidence !== undefined && args._evidence !== null ? JSON.stringify(args._evidence) : null}::jsonb,
                  ${args._pdf ?? null}::text,
                  ${args._pdf_hash ?? null}::text,
                  ${args._note ?? null}::text
                )
              `;
            };

            if (isTransaction && typeof (sql as any).savepoint === "function") {
              await (sql as any).savepoint(runTransition);
            } else if (typeof (sql as any).begin === "function") {
              await (sql as any).begin(runTransition);
            } else {
              await runTransition(sql);
            }
            return { data: null, error: null };
          }
          case "count_recent_trial_requests": {
            const rows = await sql`SELECT public.count_recent_trial_requests(${String(args._email)}::text, ${String(args._since)}::timestamptz) AS count`;
            return { data: Number(rows[0]?.count ?? 0), error: null };
          }
          case "count_recent_support_messages": {
            const rows = await sql`SELECT public.count_recent_support_messages(${String(args._email)}::text, ${String(args._since)}::timestamptz) AS count`;
            return { data: Number(rows[0]?.count ?? 0), error: null };
          }
          case "count_recent_failed_logins": {
            const rows = await sql`SELECT public.count_recent_failed_logins(${String(args._identifier)}::text, ${String(args._since)}::timestamptz) AS count`;
            return { data: Number(rows[0]?.count ?? 0), error: null };
          }
          case "auth_lookup_by_email": {
            const rows = await sql`SELECT * FROM public.auth_lookup_by_email(${String(args._email)}::text)`;
            return { data: rows[0] ?? null, error: null };
          }
          case "auth_lookup_by_id": {
            const rows = await sql`SELECT * FROM public.auth_lookup_by_id(${args._user_id}::uuid)`;
            return { data: rows[0] ?? null, error: null };
          }
          case "auth_update_password_hash": {
            const rows = await sql`SELECT public.auth_update_password_hash(${args._user_id}::uuid, ${String(args._password_hash)}::text) AS id`;
            return { data: rows[0]?.id ?? null, error: null };
          }
          case "auth_get_totp_record": {
            const rows = await sql`SELECT * FROM public.auth_get_totp_record(${args._user_id}::uuid)`;
            return { data: rows[0] ?? null, error: null };
          }
          case "auth_set_totp_secret": {
            await sql`SELECT public.auth_set_totp_secret(${args._user_id}::uuid, ${String(args._totp_secret)}::text)`;
            return { data: null, error: null };
          }
          case "auth_enable_totp": {
            await sql`SELECT public.auth_enable_totp(${args._user_id}::uuid, ${args._backup_codes}::text[])`;
            return { data: null, error: null };
          }
          case "auth_update_totp_backup_codes": {
            await sql`SELECT public.auth_update_totp_backup_codes(${args._user_id}::uuid, ${args._backup_codes}::text[])`;
            return { data: null, error: null };
          }
          case "auth_disable_totp": {
            await sql`SELECT public.auth_disable_totp(${args._user_id}::uuid)`;
            return { data: null, error: null };
          }
          default:
            return { data: null, error: { message: `[Database] Unknown RPC function: ${fn}` } };
        }
      } catch (err: any) {
        return { data: null, error: toDbError(err) };
      }
    },
    transaction: async <T>(fn: (tx: Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0]) => Promise<T>) => {
      return drizzleDb.transaction(fn);
    },
    execute: async (query: any, params: any[] = []) => {
      if (typeof query === "string") {
        return sql.unsafe(query, params);
      }
      return drizzleDb.execute(query);
    },
    auth: {
      admin: {
        async createUser(params) {
          try {
            const id = crypto.randomUUID();
            const email = params.email.toLowerCase().trim();
            const firstName = String(params.user_metadata?.first_name ?? "مستخدم");
            const lastName = String(params.user_metadata?.last_name ?? "");
            const phone = params.user_metadata?.phone ? String(params.user_metadata.phone) : null;
            const passwordHash = params.password ? hashPassword(params.password) : null;

            const rows = await sql`
              INSERT INTO public.profiles (id, email, first_name, last_name, phone, totp_enabled)
              VALUES (${id}::uuid, ${email}, ${firstName}, ${lastName}, ${phone}, false)
              RETURNING id, email
            `;
            if (passwordHash && rows[0]?.id) {
              await sql`SELECT public.auth_update_password_hash(${rows[0].id}::uuid, ${passwordHash}::text)`;
            }
            return { data: { user: rows[0] ? { id: rows[0].id, email: rows[0].email } : null }, error: null };
          } catch (err: any) {
            return { data: { user: null }, error: toDbError(err) };
          }
        },
        async deleteUser(userId: string) {
          try {
            await sql`DELETE FROM public.profiles WHERE id = ${userId}::uuid`;
            return { data: { user: null }, error: null };
          } catch (err: any) {
            return { data: { user: null }, error: toDbError(err) };
          }
        },
        async getUserById(id: string) {
          try {
            const rows = await sql`SELECT id, email, first_name, last_name, institution_id FROM public.profiles WHERE id = ${id}::uuid LIMIT 1`;
            return { data: { user: rows[0] ?? null }, error: null };
          } catch (err: any) {
            return { data: { user: null }, error: toDbError(err) };
          }
        },
        async listUsers(opts = {}) {
          try {
            const page = Math.max(1, opts.page ?? 1);
            const perPage = Math.max(1, Math.min(500, opts.perPage ?? 200));
            const offset = (page - 1) * perPage;
            const rows = await sql`
              SELECT id, email, first_name, last_name, institution_id, created_at
              FROM public.profiles
              ORDER BY created_at DESC
              LIMIT ${perPage} OFFSET ${offset}
            `;
            return { data: { users: rows }, error: null };
          } catch (err: any) {
            return { data: { users: [] }, error: toDbError(err) };
          }
        },
        async updateUserById(id: string, attrs) {
          try {
            const meta = attrs.user_metadata;
            const passwordHash = attrs.password ? hashPassword(attrs.password) : null;
            if (passwordHash) {
              await sql`SELECT public.auth_update_password_hash(${id}::uuid, ${passwordHash}::text)`;
            }
            if (meta) {
              const rows = await sql`
                UPDATE public.profiles
                SET
                  first_name = COALESCE(${meta?.first_name ?? null}, first_name),
                  last_name = COALESCE(${meta?.last_name ?? null}, last_name),
                  phone = COALESCE(${meta?.phone ?? null}, phone)
                WHERE id = ${id}::uuid
                RETURNING id, email, first_name, last_name
              `;
              return { data: { user: rows[0] ?? null }, error: null };
            }
            const rows = await sql`SELECT id, email FROM public.profiles WHERE id = ${id}::uuid LIMIT 1`;
            return { data: { user: rows[0] ?? null }, error: null };
          } catch (err: any) {
            return { data: { user: null }, error: toDbError(err) };
          }
        },
      },
    },
  };
}

/**
 * Returns the primary PostgreSQL-backed database client for server services & repositories.
 * When executing inside an active `withRlsDbClient` scope (and no explicit connectionString override
 * is passed), returns the transaction-pinned RLS client automatically.
 */
export async function getServiceDb(connectionString?: string): Promise<DbClient> {
  if (!connectionString) {
    const scopedClient = rlsDbStorage.getStore();
    if (scopedClient) {
      return scopedClient;
    }
  }
  const drizzleDb = getDrizzleDb(connectionString);
  const sql = getPostgresSql(connectionString);
  return createPostgresDbClient(drizzleDb, sql);
}

/**
 * Runs a Drizzle ORM transaction and returns its result.
 */
export { verifyDatabaseConnection, withDbTransaction };

/**
 * Sets transaction-local user context for PostgreSQL RLS and auth.uid():
 * SELECT set_config('app.current_user_id', '<user_uuid>', true)
 */
export async function setSessionUserContext(client: any, userId: string): Promise<void> {
  if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return;
  }
  if (client?.sql) {
    await client.sql`SELECT set_config('app.current_user_id', ${userId}, true)`;
  } else if (client?.rpc) {
    const res = await client.rpc("set_config", { setting: "app.current_user_id", value: userId, is_local: true });
    if (res?.error) throw new Error(res.error.message);
  }
}

/**
 * Executes a Drizzle ORM callback inside a single pinned transaction with RLS identity context
 * (`SET LOCAL app.current_user_id`) automatically discarded on commit or rollback (Neon Pooler safe).
 */
export async function withRlsUserContext<T>(
  userId: string,
  fn: (tx: Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0]) => Promise<T>,
  connectionString?: string,
): Promise<T> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error("[RLS] Invalid authenticated user UUID.");
  }
  const drizzleDb = getDrizzleDb(connectionString);
  return drizzleDb.transaction(async (tx) => {
    await tx.execute(drizzleSql`SELECT set_config('app.current_user_id', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * Executes a DbClient callback inside a single pinned PostgreSQL transaction with
 * `SET LOCAL app.current_user_id` bound directly to the transaction connection and propagated
 * via AsyncLocalStorage so downstream `getServiceDb()` / `supabaseAdmin` calls share the same pinned tx.
 */
export async function withRlsDbClient<T>(
  userId: string,
  fn: (client: DbClient) => Promise<T>,
  connectionString?: string,
): Promise<T> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error("[RLS] Invalid authenticated user UUID.");
  }
  const sqlClient = getPostgresSql(connectionString);
  return sqlClient.begin(async (txSql: any) => {
    await txSql`SELECT set_config('app.current_user_id', ${userId}, true)`;
    const txDrizzle = drizzle(txSql, { schema }) as unknown as DrizzleDb;
    const txClient = createPostgresDbClient(txDrizzle, txSql, true);
    return rlsDbStorage.run(txClient, () => fn(txClient));
  }) as Promise<T>;
}
