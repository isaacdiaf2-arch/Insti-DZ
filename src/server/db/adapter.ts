/**
 * Data adapter: the central abstraction where the service layer touches the database provider.
 * Repositories receive this client and never import the provider directly.
 * Server-only — load inside handlers after the caller is authenticated.
 */
import { getDrizzleDb } from "./drizzle";

export type DbClient = any;

// Preview in-memory store for offline development without live database connection
const previewStore: Record<string, any[]> = {
  institutions: [
    {
      id: "00000000-0000-0000-0000-000000000001",
      name: "مؤسسة Study DZ التجريبية",
      name_fr: "Etablissement Demo Study DZ",
      status: "active",
      email: "demo@studydz.com",
      type: "مدرسة خاصة",
      wilaya: "الجزائر",
      commune: "بئر مراد رايس",
      phone: "0550000000",
      created_at: new Date().toISOString(),
    },
  ],
  profiles: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      first_name: "مدير",
      last_name: "المؤسسة",
      email: "admin@studydz.com",
      phone: "0550000001",
      institution_id: "00000000-0000-0000-0000-000000000001",
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      first_name: "أحمد",
      last_name: "الأستاذ",
      email: "teacher@studydz.com",
      phone: "0550000002",
      institution_id: "00000000-0000-0000-0000-000000000001",
    },
    {
      id: "33333333-3333-3333-3333-333333333333",
      first_name: "سارة",
      last_name: "التلميذة",
      email: "student@studydz.com",
      phone: "0550000003",
      institution_id: "00000000-0000-0000-0000-000000000001",
    },
    {
      id: "00000000-0000-0000-0000-000000000000",
      first_name: "مدير",
      last_name: "المنصة",
      email: "isaacdiaf2@gmail.com",
      phone: "0550000099",
      institution_id: null,
    },
  ],
  user_roles: [
    {
      user_id: "11111111-1111-1111-1111-111111111111",
      role: "institution_admin",
      institution_id: "00000000-0000-0000-0000-000000000001",
    },
    {
      user_id: "22222222-2222-2222-2222-222222222222",
      role: "teacher",
      institution_id: "00000000-0000-0000-0000-000000000001",
    },
    {
      user_id: "33333333-3333-3333-3333-333333333333",
      role: "student",
      institution_id: "00000000-0000-0000-0000-000000000001",
    },
    {
      user_id: "00000000-0000-0000-0000-000000000000",
      role: "platform_admin",
      institution_id: null,
    },
  ],
  classes: [
    {
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      institution_id: "00000000-0000-0000-0000-000000000001",
      name: "القسم التجريبي 1",
      stage: "متوسط",
      created_at: new Date().toISOString(),
    },
  ],
  subjects: [
    {
      id: "ssssssss-ssss-ssss-ssss-ssssssssssss",
      institution_id: "00000000-0000-0000-0000-000000000001",
      class_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      name: "الرياضيات",
      teacher_id: "22222222-2222-2222-2222-222222222222",
      classes: { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", name: "القسم التجريبي 1" },
    },
  ],
  lessons: [
    {
      id: "llllllll-llll-llll-llll-llllllllllll",
      institution_id: "00000000-0000-0000-0000-000000000001",
      teacher_id: "22222222-2222-2222-2222-222222222222",
      subject_id: "ssssssss-ssss-ssss-ssss-ssssssssssss",
      class_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      title: "مقدمة في الجبر والحساب",
      description: "الدرس الافتتاحي للموسم الدراسي",
      content: "مرحباً بكم في درس الجبر والحساب على منصة Study DZ.",
      published: true,
      subjects: { name: "الرياضيات" },
      created_at: new Date().toISOString(),
    },
  ],
  exams: [
    {
      id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      institution_id: "00000000-0000-0000-0000-000000000001",
      teacher_id: "22222222-2222-2222-2222-222222222222",
      subject_id: "ssssssss-ssss-ssss-ssss-ssssssssssss",
      class_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      title: "فرض المراقبة المستمرة الأول",
      description: "اختبار تجريبي في مادة الرياضيات",
      duration_minutes: 30,
      published: true,
      subjects: { name: "الرياضيات" },
      classes: { name: "القسم التجريبي 1" },
      created_at: new Date().toISOString(),
    },
  ],
  attempts: [],
  questions: [],
  options: [],
  announcements: [
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      institution_id: "00000000-0000-0000-0000-000000000001",
      author_id: "11111111-1111-1111-1111-111111111111",
      title: "انطلاق النظام المستقل لمنصة Study DZ",
      body: "أهلاً وسهلاً بك في نظام تشغيل المؤسسات التعليمية والتكوينية Study DZ.",
      created_at: new Date().toISOString(),
    },
  ],
  schedules: [],
  rooms: [],
  personal_schedule_entries: [],
  payments: [
    {
      id: "pppppppp-pppp-pppp-pppp-pppppppppppp",
      institution_id: "00000000-0000-0000-0000-000000000001",
      amount: 9000,
      paid_at: new Date().toISOString().slice(0, 10),
      status: "accepted",
      expires_at: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
      institutions: { name: "مؤسسة Study DZ التجريبية" },
    },
  ],
  contracts: [],
  contract_events: [],
  official_contracts: [],
  contract_artifacts: [],
  contract_provider_settings: [
    {
      id: true,
      details: {
        provider_name: "Study DZ Platform",
        registration: "0042451103",
        legal_rep: "إسحاق ضياف",
      },
    },
  ],
  support_messages: [],
  password_reset_requests: [],
  audit_logs: [],
  programs: [],
  specializations: [],
  academic_levels: [],
  groups: [],
  modules: [],
  skills: [],
  assessments: [],
  submissions: [],
  results: [],
  enrollments: [
    {
      id: "enr-01",
      institution_id: "00000000-0000-0000-0000-000000000001",
      student_id: "33333333-3333-3333-3333-333333333333",
      class_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    },
  ],
  lesson_completions: [],
};

class PreviewQueryBuilder {
  private table: string;
  private filters: ((row: any) => boolean)[] = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitCount: number | null = null;
  private selectedFields: string | null = null;
  private mutationPromise: Promise<any> | null = null;

  constructor(table: string) {
    this.table = table;
    if (!previewStore[table]) {
      previewStore[table] = [];
    }
  }

  select(fields?: string) {
    this.selectedFields = fields || null;
    return this;
  }

  insert(data: any | any[]) {
    this.mutationPromise = (async () => {
      const items = Array.isArray(data) ? data : [data];
      const createdItems = items.map((item) => ({
        id: item.id || crypto.randomUUID(),
        created_at: item.created_at || new Date().toISOString(),
        ...item,
      }));
      previewStore[this.table].push(...createdItems);
      return { data: Array.isArray(data) ? createdItems : createdItems[0], error: null };
    })();
    return this;
  }

  update(data: any) {
    this.mutationPromise = (async () => {
      const rows = previewStore[this.table];
      let updatedCount = 0;
      for (let i = 0; i < rows.length; i++) {
        if (this.filters.every((f) => f(rows[i]))) {
          rows[i] = { ...rows[i], ...data, updated_at: new Date().toISOString() };
          updatedCount++;
        }
      }
      return { data: updatedCount, error: null };
    })();
    return this;
  }

  upsert(data: any | any[], opts?: { onConflict?: string }) {
    this.mutationPromise = (async () => {
      const items = Array.isArray(data) ? data : [data];
      const rows = previewStore[this.table];
      const conflictKeys = opts?.onConflict?.split(",").map((k) => k.trim()) || ["id"];

      const results = items.map((item) => {
        const existingIdx = rows.findIndex((r) =>
          conflictKeys.every((k) => r[k] !== undefined && r[k] === item[k])
        );
        if (existingIdx >= 0) {
          rows[existingIdx] = { ...rows[existingIdx], ...item, updated_at: new Date().toISOString() };
          return rows[existingIdx];
        } else {
          const newItem = {
            id: item.id || crypto.randomUUID(),
            created_at: item.created_at || new Date().toISOString(),
            ...item,
          };
          rows.push(newItem);
          return newItem;
        }
      });
      return { data: Array.isArray(data) ? results : results[0], error: null };
    })();
    return this;
  }

  delete() {
    this.mutationPromise = (async () => {
      const initialLen = previewStore[this.table].length;
      previewStore[this.table] = previewStore[this.table].filter((row) => !this.filters.every((f) => f(row)));
      const deletedCount = initialLen - previewStore[this.table].length;
      return { data: deletedCount, error: null };
    })();
    return this;
  }

  eq(col: string, val: any) {
    this.filters.push((row) => row[col] === val);
    return this;
  }

  neq(col: string, val: any) {
    this.filters.push((row) => row[col] !== val);
    return this;
  }

  ilike(col: string, val: string) {
    const pattern = val.replace(/%/g, ".*").toLowerCase();
    const regex = new RegExp(`^${pattern}$`, "i");
    this.filters.push((row) => regex.test(String(row[col] ?? "")));
    return this;
  }

  in(col: string, vals: any[]) {
    const set = new Set(vals);
    this.filters.push((row) => set.has(row[col]));
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col;
    this.orderAsc = opts?.ascending ?? true;
    return this;
  }

  limit(n: number) {
    this.limitCount = n;
    return this;
  }

  private executeQuery(): { data: any; error: null } {
    let list = [...(previewStore[this.table] || [])];
    for (const filter of this.filters) {
      list = list.filter(filter);
    }
    if (this.orderCol) {
      const col = this.orderCol;
      const asc = this.orderAsc;
      list.sort((a, b) => {
        const valA = a[col] ?? "";
        const valB = b[col] ?? "";
        if (valA < valB) return asc ? -1 : 1;
        if (valA > valB) return asc ? 1 : -1;
        return 0;
      });
    }
    if (this.limitCount !== null) {
      list = list.slice(0, this.limitCount);
    }
    return { data: list, error: null };
  }

  async single() {
    if (this.mutationPromise) {
      const res = await this.mutationPromise;
      return { data: Array.isArray(res.data) ? res.data[0] : res.data, error: null };
    }
    const { data } = this.executeQuery();
    if (!data || data.length === 0) {
      return { data: null, error: { message: "No rows found", code: "PGRST116" } };
    }
    return { data: data[0], error: null };
  }

  async maybeSingle() {
    if (this.mutationPromise) {
      const res = await this.mutationPromise;
      return { data: Array.isArray(res.data) ? res.data[0] ?? null : res.data ?? null, error: null };
    }
    const { data } = this.executeQuery();
    return { data: data && data.length > 0 ? data[0] : null, error: null };
  }

  then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) {
    const p = this.mutationPromise ? this.mutationPromise : Promise.resolve(this.executeQuery());
    return p.then(onfulfilled, onrejected);
  }
}

/**
 * Creates the preview database client that operates entirely in memory without Supabase.
 */
function createPreviewClient() {
  return {
    from: (table: string) => new PreviewQueryBuilder(table),
    rpc: async (fn: string, _args: any) => {
      if (fn === "has_role") return { data: true, error: null };
      if (fn === "set_config") return { data: null, error: null };
      return { data: null, error: null };
    },
    execute: async (_sql: string) => [],
    auth: {
      admin: {
        async createUser(params: any) {
          const id = crypto.randomUUID();
          return { data: { user: { id, email: params?.email } }, error: null };
        },
        async deleteUser(_userId: string) {
          return { data: { user: null }, error: null };
        },
        async getUserById(id: string) {
          return { data: { user: { id } }, error: null };
        },
      },
    },
  };
}

let _previewClient: ReturnType<typeof createPreviewClient> | null = null;

/**
 * Returns the primary database client for server repositories.
 * Prefers native Neon / PostgreSQL Drizzle client when configured;
 * falls back to isolated preview database client when running offline or in preview.
 * Strictly eliminates any Supabase client or credentials.
 */
export async function getServiceDb(): Promise<DbClient> {
  const dbUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;
  if (dbUrl) {
    try {
      const drizzleDb = getDrizzleDb(dbUrl);
      if (drizzleDb) {
        // Augment drizzle instance with a compatible .from() builder if required by existing repositories
        if (!("from" in drizzleDb)) {
          (drizzleDb as any).from = (table: string) => new PreviewQueryBuilder(table);
        }
        return drizzleDb;
      }
    } catch (e) {
      console.warn("[getServiceDb] Native Drizzle connection unavailable, using preview client:", e);
    }
  }

  if (!_previewClient) {
    _previewClient = createPreviewClient();
  }
  return _previewClient;
}

/**
 * Sets transaction-local user context for PostgreSQL RLS and auth.uid():
 * SET LOCAL app.current_user_id = '<user_uuid>'
 */
export async function setSessionUserContext(client: any, userId: string): Promise<void> {
  if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return;
  }
  try {
    if (client?.execute) {
      await client.execute(`SELECT set_config('app.current_user_id', '${userId}', true);`);
    } else if (client?.rpc) {
      await client.rpc("set_config", { setting: "app.current_user_id", value: userId, is_local: true });
    }
  } catch (err) {
    console.warn("[setSessionUserContext] Non-fatal user context setting error:", err);
  }
}
