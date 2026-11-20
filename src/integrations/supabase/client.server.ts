/**
 * Server-side PostgreSQL admin client bridge (via Drizzle / postgres-js adapter).
 * Properly defers async `getServiceDb()` resolution across chained `.from(...)`,
 * `.rpc(...)`, `.transaction(...)`, and `.auth.admin.*` calls without silent fallbacks.
 */
import { getServiceDb, type QueryResult } from "@/server/db/adapter";

type ChainStep = { method: string; args: any[] };

class DeferredQueryBuilder {
  private table: string;
  private steps: ChainStep[] = [];

  constructor(table: string) {
    this.table = table;
  }

  private push(method: string, args: any[]) {
    this.steps.push({ method, args });
    return this;
  }

  select(...args: any[]) { return this.push("select", args); }
  insert(...args: any[]) { return this.push("insert", args); }
  update(...args: any[]) { return this.push("update", args); }
  upsert(...args: any[]) { return this.push("upsert", args); }
  delete(...args: any[]) { return this.push("delete", args); }
  eq(...args: any[]) { return this.push("eq", args); }
  neq(...args: any[]) { return this.push("neq", args); }
  gt(...args: any[]) { return this.push("gt", args); }
  gte(...args: any[]) { return this.push("gte", args); }
  lt(...args: any[]) { return this.push("lt", args); }
  lte(...args: any[]) { return this.push("lte", args); }
  like(...args: any[]) { return this.push("like", args); }
  ilike(...args: any[]) { return this.push("ilike", args); }
  is(...args: any[]) { return this.push("is", args); }
  in(...args: any[]) { return this.push("in", args); }
  not(...args: any[]) { return this.push("not", args); }
  or(...args: any[]) { return this.push("or", args); }
  match(...args: any[]) { return this.push("match", args); }
  filter(...args: any[]) { return this.push("filter", args); }
  order(...args: any[]) { return this.push("order", args); }
  limit(...args: any[]) { return this.push("limit", args); }
  range(...args: any[]) { return this.push("range", args); }

  private async buildRealBuilder() {
    const db = await getServiceDb();
    let builder: any = db.from(this.table);
    for (const step of this.steps) {
      builder = builder[step.method](...step.args);
    }
    return builder;
  }

  async single(): Promise<QueryResult<any>> {
    const builder = await this.buildRealBuilder();
    return builder.single();
  }

  async maybeSingle(): Promise<QueryResult<any>> {
    const builder = await this.buildRealBuilder();
    return builder.maybeSingle();
  }

  then<TResult1 = QueryResult<any>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<any>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.buildRealBuilder().then((b) => b.then(onfulfilled, onrejected), onrejected);
  }
}

export const supabaseAdmin: any = {
  from(table: string) {
    return new DeferredQueryBuilder(table);
  },
  async rpc(fn: string, args?: Record<string, any>) {
    const db = await getServiceDb();
    return db.rpc(fn, args);
  },
  async transaction<T>(fn: Parameters<Awaited<ReturnType<typeof getServiceDb>>["transaction"]>[0]): Promise<T> {
    const db = await getServiceDb();
    return db.transaction(fn) as Promise<T>;
  },
  async execute(query: any, params?: any[]) {
    const db = await getServiceDb();
    return db.execute(query, params);
  },
  auth: {
    admin: {
      async createUser(params: any) {
        const db = await getServiceDb();
        return db.auth.admin.createUser(params);
      },
      async deleteUser(userId: string) {
        const db = await getServiceDb();
        return db.auth.admin.deleteUser(userId);
      },
      async getUserById(id: string) {
        const db = await getServiceDb();
        return db.auth.admin.getUserById(id);
      },
      async listUsers(opts?: { page?: number; perPage?: number }) {
        const db = await getServiceDb();
        return db.auth.admin.listUsers(opts);
      },
      async updateUserById(id: string, attrs: any) {
        const db = await getServiceDb();
        return db.auth.admin.updateUserById(id, attrs);
      },
    },
  },
};
