import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CURRICULUM, findBranch } from "@/lib/curriculum.shared";

/**
 * استيراد بنك المواد الجزائري إلى مؤسسة.
 * يُنشئ برنامجًا (program) للطور، وتخصصًا (specialization) للشعبة،
 * ومستوى (academic_level)، ثم يُضيف كل المواد كوحدات (modules) مع معاملاتها.
 * كل ذلك مرتبط بمؤسسة المستخدم فقط (مع عزل RLS).
 */
export const importCurriculum = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        stageKey: z.string().min(1),
        branchKey: z.string().min(1),
        levelName: z.string().trim().min(1).max(120).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const stage = CURRICULUM.find((s) => s.key === data.stageKey);
    if (!stage) throw new Error("الطور المحدد غير موجود في بنك المواد.");
    const branch = findBranch(data.stageKey, data.branchKey);
    if (!branch) throw new Error("الشعبة المحددة غير موجودة في بنك المواد.");

    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();

    // 1. Verify caller is institution admin
    const { data: role } = await context.supabase
      .from("user_roles")
      .select("institution_id")
      .eq("user_id", context.userId)
      .eq("role", "institution_admin")
      .maybeSingle();
    if (!role?.institution_id) {
      throw new Error("غير مسموح: هذه العملية مخصصة لمدير المؤسسة.");
    }
    const institutionId = role.institution_id as string;

    // 2. Create or reuse program for this stage
    const { data: existingProgram } = await context.supabase
      .from("programs")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("name", stage.label)
      .maybeSingle();

    let programId: string;
    if (existingProgram) {
      programId = existingProgram.id;
    } else {
      const { data: newProgram, error: progErr } = await context.supabase
        .from("programs")
        .insert({
          institution_id: institutionId,
          name: stage.label,
          kind: "program",
        })
        .select("id")
        .single();
      if (progErr || !newProgram) throw new Error(progErr?.message ?? "تعذّر إنشاء البرنامج.");
      programId = newProgram.id;
    }

    // 3. Create or reuse specialization for this branch
    const { data: existingSpec } = await context.supabase
      .from("specializations")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("program_id", programId)
      .eq("name", branch.label)
      .maybeSingle();

    let specializationId: string;
    if (existingSpec) {
      specializationId = existingSpec.id;
    } else {
      const { data: newSpec, error: specErr } = await context.supabase
        .from("specializations")
        .insert({
          institution_id: institutionId,
          program_id: programId,
          name: branch.label,
          kind: "specialization",
        })
        .select("id")
        .single();
      if (specErr || !newSpec) throw new Error(specErr?.message ?? "تعذّر إنشاء التخصص.");
      specializationId = newSpec.id;
    }

    // 4. Create or reuse academic level
    const levelName = data.levelName?.trim() || stage.label;
    const { data: existingLevel } = await context.supabase
      .from("academic_levels")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("specialization_id", specializationId)
      .eq("name", levelName)
      .maybeSingle();

    let levelId: string;
    if (existingLevel) {
      levelId = existingLevel.id;
    } else {
      const { data: newLevel, error: levelErr } = await context.supabase
        .from("academic_levels")
        .insert({
          institution_id: institutionId,
          specialization_id: specializationId,
          program_id: programId,
          name: levelName,
          order_index: 1,
        })
        .select("id")
        .single();
      if (levelErr || !newLevel) throw new Error(levelErr?.message ?? "تعذّر إنشاء المستوى.");
      levelId = newLevel.id;
    }

    // 5. Insert modules (skip duplicates by name + level)
    const { data: existingModules } = await context.supabase
      .from("modules")
      .select("name")
      .eq("institution_id", institutionId)
      .eq("level_id", levelId);

    const existingNames = new Set((existingModules ?? []).map((m: { name: string }) => m.name));
    const toInsert = branch.subjects
      .filter((s) => !existingNames.has(s.name))
      .map((s) => ({
        institution_id: institutionId,
        level_id: levelId,
        specialization_id: specializationId,
        name: s.name,
        coefficient: s.coefficient,
        hours: s.hours ?? null,
      }));

    let inserted = 0;
    if (toInsert.length > 0) {
      const { data: created, error: modErr } = await context.supabase
        .from("modules")
        .insert(toInsert)
        .select("id");
      if (modErr) throw new Error(modErr.message);
      inserted = (created ?? []).length;
    }

    await db.from("audit_logs").insert({
      actor_id: context.userId,
      actor_role: "institution_admin",
      institution_id: institutionId,
      action: "curriculum.import",
      resource: "modules",
      result: "success",
      metadata: {
        stage: data.stageKey,
        branch: data.branchKey,
        inserted,
        skipped: branch.subjects.length - toInsert.length,
      } as never,
    });

    return {
      ok: true as const,
      programId,
      specializationId,
      levelId,
      inserted,
      skipped: branch.subjects.length - toInsert.length,
    };
  });

export const completeLesson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        lessonId: z.string().uuid(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();

    // Verify caller role and get institution
    const { data: role } = await context.supabase
      .from("user_roles")
      .select("institution_id")
      .eq("user_id", context.userId)
      .maybeSingle();

    const institutionId = role?.institution_id ?? context.claims.institution_id;
    if (!institutionId) {
      throw new Error("غير مصرح: حسابك غير مرتبط بأي مؤسسة.");
    }

    const { error } = await db.from("lesson_completions").upsert(
      {
        institution_id: institutionId,
        lesson_id: data.lessonId,
        student_id: context.userId,
      },
      { onConflict: "lesson_id,student_id" },
    );

    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const getInstitutionSchedules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ institutionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const [schedulesRes, roomsRes] = await Promise.all([
      db
        .from("schedules")
        .select("*, classes(name), subjects(name), rooms(name)")
        .eq("institution_id", data.institutionId)
        .order("day_of_week")
        .order("start_time"),
      db
        .from("rooms")
        .select("*")
        .eq("institution_id", data.institutionId)
        .order("name"),
    ]);
    return {
      schedules: schedulesRes.data ?? [],
      rooms: roomsRes.data ?? [],
    };
  });

export const saveInstitutionSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        institutionId: z.string().uuid(),
        classId: z.string().uuid(),
        subjectId: z.string().uuid().nullable().optional(),
        teacherId: z.string().uuid().nullable().optional(),
        roomId: z.string().uuid().nullable().optional(),
        dayOfWeek: z.number().int().min(0).max(6),
        periodIndex: z.number().int().min(1).max(12),
        startTime: z.string().min(1),
        endTime: z.string().nullable().optional(),
        archived: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const payload = {
      institution_id: data.institutionId,
      class_id: data.classId,
      subject_id: data.subjectId || null,
      teacher_id: data.teacherId || null,
      room_id: data.roomId || null,
      day_of_week: data.dayOfWeek,
      period_index: data.periodIndex,
      start_time: data.startTime,
      end_time: data.endTime || null,
      archived: data.archived ?? false,
    };
    if (data.id) {
      const { error } = await db.from("schedules").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db.from("schedules").insert(payload);
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  });

export const copyInstitutionSchedules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        institutionId: z.string().uuid(),
        items: z.array(
          z.object({
            classId: z.string().uuid(),
            subjectId: z.string().uuid().nullable().optional(),
            teacherId: z.string().uuid().nullable().optional(),
            roomId: z.string().uuid().nullable().optional(),
            dayOfWeek: z.number().int(),
            periodIndex: z.number().int(),
            startTime: z.string(),
            endTime: z.string().nullable().optional(),
          }),
        ),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const { error } = await db.from("schedules").insert(
      data.items.map((r) => ({
        institution_id: data.institutionId,
        class_id: r.classId,
        subject_id: r.subjectId ?? null,
        teacher_id: r.teacherId ?? null,
        room_id: r.roomId ?? null,
        day_of_week: r.dayOfWeek,
        period_index: r.periodIndex,
        start_time: r.startTime,
        end_time: r.endTime ?? null,
        archived: false,
      })),
    );
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const setScheduleArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), archived: z.boolean() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const { error } = await db.from("schedules").update({ archived: data.archived }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deleteScheduleRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const { error } = await db.from("schedules").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const saveInstitutionRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        institutionId: z.string().uuid(),
        name: z.string().trim().min(1).max(100),
        capacity: z.number().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const payload = {
      institution_id: data.institutionId,
      name: data.name,
      capacity: data.capacity ?? null,
    };
    if (data.id) {
      const { error } = await db.from("rooms").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db.from("rooms").insert(payload);
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  });

export const deleteInstitutionRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const { error } = await db.from("rooms").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const sendScheduleAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ institutionId: z.string().uuid(), message: z.string() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    await db.from("announcements").insert({
      institution_id: data.institutionId,
      author_id: context.userId,
      title: "📢 تعديل على الجدول الدراسي",
      body: data.message,
    });
    return { ok: true as const };
  });

export const createLesson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        subjectId: z.string().uuid().nullable().optional(),
        classId: z.string().uuid().nullable().optional(),
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().nullable().optional(),
        content: z.string().trim().nullable().optional(),
        videoUrl: z.string().trim().nullable().optional(),
        pdfUrl: z.string().trim().nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();

    const { data: role } = await context.supabase
      .from("user_roles")
      .select("institution_id, role")
      .eq("user_id", context.userId)
      .maybeSingle();

    const institutionId = role?.institution_id ?? context.claims.institution_id;
    if (!institutionId) {
      throw new Error("المستخدم غير مرتبط بأي مؤسسة.");
    }

    const { data: lesson, error } = await db
      .from("lessons")
      .insert({
        institution_id: institutionId,
        teacher_id: context.userId,
        subject_id: data.subjectId || null,
        class_id: data.classId || null,
        title: data.title,
        description: data.description || null,
        content: data.content || null,
        video_url: data.videoUrl || null,
        pdf_url: data.pdfUrl || null,
        published: true,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return { id: lesson.id as string };
  });

export const createTeacherExam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().nullable().optional(),
        durationMinutes: z.number().int().min(1).max(600).default(30),
        subjectId: z.string().uuid().nullable().optional(),
        classId: z.string().uuid().nullable().optional(),
        questions: z.array(
          z.object({
            text: z.string().trim().min(1),
            options: z.array(z.string().trim().min(1)),
            correct: z.number().int().min(0),
          }),
        ),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();

    const { data: role } = await context.supabase
      .from("user_roles")
      .select("institution_id, role")
      .eq("user_id", context.userId)
      .maybeSingle();

    const institutionId = role?.institution_id ?? context.claims.institution_id;
    if (!institutionId) {
      throw new Error("المستخدم غير مرتبط بأي مؤسسة.");
    }

    const { data: exam, error } = await db
      .from("exams")
      .insert({
        institution_id: institutionId,
        teacher_id: context.userId,
        subject_id: data.subjectId || null,
        class_id: data.classId || null,
        title: data.title,
        description: data.description || null,
        duration_minutes: data.durationMinutes,
        published: true,
      })
      .select("id")
      .single();

    if (error || !exam) {
      throw new Error(error?.message ?? "تعذر إنشاء الاختبار.");
    }

    for (let i = 0; i < data.questions.length; i++) {
      const q = data.questions[i];
      const { data: question, error: qErr } = await db
        .from("questions")
        .insert({
          institution_id: institutionId,
          exam_id: exam.id,
          text: q.text,
          type: "mcq",
          points: 1,
          order_index: i,
        })
        .select("id")
        .single();

      if (qErr || !question) continue;

      await db.from("options").insert(
        q.options.map((text, idx) => ({
          institution_id: institutionId,
          question_id: question.id,
          text,
          is_correct: idx === q.correct,
          order_index: idx,
        })),
      );
    }

    return { id: exam.id as string };
  });

export const getStudentDashboardData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const userId = context.userId;

    const { data: roleRow } = await db
      .from("user_roles")
      .select("institution_id")
      .eq("user_id", userId)
      .maybeSingle();

    const institutionId = roleRow?.institution_id ?? context.claims.institution_id;

    const [enrollmentsRes, subjectsRes, lessonsRes, announcementsRes] = await Promise.all([
      db.from("enrollments").select("class_id").eq("student_id", userId),
      db.from("subjects").select("*, classes(name)").eq("institution_id", institutionId),
      db.from("lessons").select("*, subjects(name)").eq("institution_id", institutionId).eq("published", true).order("created_at", { ascending: false }),
      db.from("announcements").select("*").eq("institution_id", institutionId).order("created_at", { ascending: false }),
    ]);

    return {
      enrollments: enrollmentsRes.data ?? [],
      subjects: subjectsRes.data ?? [],
      lessons: lessonsRes.data ?? [],
      announcements: announcementsRes.data ?? [],
    };
  });

export const getTeacherDashboardData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const userId = context.userId;

    const [subjectsRes, lessonsRes, examsRes, announcementsRes] = await Promise.all([
      db.from("subjects").select("*, classes(id, name)").eq("teacher_id", userId),
      db.from("lessons").select("*, subjects(name)").eq("teacher_id", userId).order("created_at", { ascending: false }),
      db.from("exams").select("*, subjects(name), classes(name)").eq("teacher_id", userId).order("created_at", { ascending: false }),
      db.from("announcements").select("*").eq("author_id", userId).order("created_at", { ascending: false }),
    ]);

    const exams = examsRes.data ?? [];
    const examIds = exams.map((e: any) => e.id);
    let attempts: any[] = [];
    if (examIds.length > 0) {
      const attemptsRes = await db.from("attempts").select("*, exams(title)").in("exam_id", examIds);
      attempts = attemptsRes.data ?? [];
    }

    return {
      subjects: subjectsRes.data ?? [],
      lessons: lessonsRes.data ?? [],
      exams,
      attempts,
      announcements: announcementsRes.data ?? [],
    };
  });

export const getScheduleRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        institutionId: z.string().uuid().optional(),
        teacherId: z.string().uuid().optional(),
        classIds: z.array(z.string().uuid()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();

    let q = db
      .from("schedules")
      .select("*, classes(name), subjects(name), rooms(name)")
      .eq("archived", false)
      .order("day_of_week")
      .order("start_time");

    if (data.institutionId) q = q.eq("institution_id", data.institutionId);
    if (data.teacherId) q = q.eq("teacher_id", data.teacherId);
    if (data.classIds && data.classIds.length > 0) q = q.in("class_id", data.classIds);

    const { data: rows } = await q;
    return rows ?? [];
  });

export const getPersonalSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const { data, error } = await db
      .from("personal_schedule_entries")
      .select("*")
      .eq("owner_id", context.userId)
      .order("day_of_week")
      .order("start_time");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const addPersonalScheduleEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        institutionId: z.string().uuid().nullable().optional(),
        dayOfWeek: z.number().int().min(0).max(6),
        startTime: z.string().min(1),
        endTime: z.string().nullable().optional(),
        title: z.string().min(1).max(200),
        note: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const { error } = await db.from("personal_schedule_entries").insert({
      owner_id: context.userId,
      institution_id: data.institutionId ?? null,
      day_of_week: data.dayOfWeek,
      start_time: data.startTime,
      end_time: data.endTime || null,
      title: data.title.trim(),
      note: data.note?.trim() || null,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deletePersonalScheduleEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const { error } = await db
      .from("personal_schedule_entries")
      .delete()
      .eq("id", data.id)
      .eq("owner_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });


