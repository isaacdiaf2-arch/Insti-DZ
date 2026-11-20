import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { DbClient } from "@/server/db/adapter";
import {
  assessments,
  attemptAnswers,
  attempts,
  exams,
  groupMemberships,
  groups,
  modules,
  options,
  profiles,
  questions,
  results,
  userRoles,
} from "../../../drizzle/schema";

/** Raw data access for quiz assessments. No authorization decisions here. */
export function quizRepository(db: DbClient) {
  const drizzleDb = db?.drizzle;

  return {
    async studentScope(studentId: string) {
      if (drizzleDb) {
        const [[profile], roles, gm] = await Promise.all([
          drizzleDb
            .select({ institution_id: profiles.institutionId })
            .from(profiles)
            .where(eq(profiles.id, studentId))
            .limit(1),
          drizzleDb
            .select({ role: userRoles.role, institution_id: userRoles.institutionId })
            .from(userRoles)
            .where(eq(userRoles.userId, studentId)),
          drizzleDb
            .select({
              group_id: groupMemberships.groupId,
              level_id: groups.levelId,
              institution_id: groups.institutionId,
            })
            .from(groupMemberships)
            .innerJoin(groups, eq(groupMemberships.groupId, groups.id))
            .where(eq(groupMemberships.studentId, studentId)),
        ]);

        return {
          institutionId: (profile?.institution_id ?? null) as string | null,
          isStudent: roles.some((r: any) => r.role === "student" && r.institution_id === profile?.institution_id),
          memberships: gm.map((m: any) => ({
            group_id: m.group_id as string,
            groups: {
              level_id: (m.level_id ?? null) as string | null,
              institution_id: m.institution_id as string,
            },
          })),
        };
      }

      const { data: profile } = await db.from("profiles").select("institution_id").eq("id", studentId).maybeSingle();
      const { data: roles } = await db.from("user_roles").select("role, institution_id").eq("user_id", studentId);
      const { data: gm } = await db
        .from("group_memberships")
        .select("group_id, groups!inner(level_id, institution_id)")
        .eq("student_id", studentId);
      return {
        institutionId: (profile?.institution_id ?? null) as string | null,
        isStudent: (roles ?? []).some((r: any) => r.role === "student" && r.institution_id === profile?.institution_id),
        memberships: (gm ?? []) as { group_id: string; groups: { level_id: string | null; institution_id: string } }[],
      };
    },

    async moduleIdsForLevels(institutionId: string, levelIds: string[]) {
      if (!levelIds.length) return [] as string[];
      if (drizzleDb) {
        const rows = await drizzleDb
          .select({ id: modules.id })
          .from(modules)
          .where(and(eq(modules.institutionId, institutionId), inArray(modules.levelId, levelIds)));
        return rows.map((r: any) => r.id as string);
      }

      const { data } = await db.from("modules").select("id").eq("institution_id", institutionId).in("level_id", levelIds);
      return (data ?? []).map((r: any) => r.id as string);
    },

    async listPublishedQuizzes(institutionId: string, groupIds: string[]) {
      if (!groupIds.length) return [];
      if (drizzleDb) {
        const rows = await drizzleDb
          .select({
            id: assessments.id,
            title: assessments.title,
            max_score: assessments.maxScore,
            group_id: assessments.groupId,
            module_id: assessments.moduleId,
            exam_id: assessments.examId,
            due_at: assessments.dueAt,
            module_name: modules.name,
            exam_duration_minutes: exams.durationMinutes,
          })
          .from(assessments)
          .leftJoin(modules, eq(assessments.moduleId, modules.id))
          .leftJoin(exams, eq(assessments.examId, exams.id))
          .where(
            and(
              eq(assessments.institutionId, institutionId),
              eq(assessments.kind, "quiz"),
              eq(assessments.published, true),
              isNotNull(assessments.examId),
              inArray(assessments.groupId, groupIds),
            ),
          )
          .orderBy(desc(assessments.createdAt))
          .limit(200);

        return rows.map((r: any) => ({
          id: r.id,
          title: r.title,
          max_score: r.max_score,
          group_id: r.group_id,
          module_id: r.module_id,
          exam_id: r.exam_id,
          due_at: r.due_at,
          modules: r.module_name ? { name: r.module_name } : null,
          exams: r.exam_duration_minutes !== null ? { duration_minutes: r.exam_duration_minutes } : null,
        }));
      }

      const { data, error } = await db
        .from("assessments")
        .select("id, title, max_score, group_id, module_id, exam_id, due_at, modules(name), exams(duration_minutes)")
        .eq("institution_id", institutionId)
        .eq("kind", "quiz")
        .eq("published", true)
        .not("exam_id", "is", null)
        .in("group_id", groupIds)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error("تعذر تحميل الاختبارات.");
      return data ?? [];
    },

    async getAssessment(id: string) {
      if (drizzleDb) {
        const [row] = await drizzleDb
          .select({
            id: assessments.id,
            title: assessments.title,
            kind: assessments.kind,
            published: assessments.published,
            institution_id: assessments.institutionId,
            group_id: assessments.groupId,
            module_id: assessments.moduleId,
            exam_id: assessments.examId,
            max_score: assessments.maxScore,
          })
          .from(assessments)
          .where(eq(assessments.id, id))
          .limit(1);
        return row ?? null;
      }

      const { data } = await db
        .from("assessments")
        .select("id, title, kind, published, institution_id, group_id, module_id, exam_id, max_score")
        .eq("id", id)
        .maybeSingle();
      return data;
    },

    async getExamWithQuestions(examId: string, withKey: boolean) {
      if (drizzleDb) {
        const [exam] = await drizzleDb
          .select({
            id: exams.id,
            title: exams.title,
            duration_minutes: exams.durationMinutes,
            institution_id: exams.institutionId,
          })
          .from(exams)
          .where(eq(exams.id, examId))
          .limit(1);
        if (!exam) return null;

        const qRows = await drizzleDb
          .select({
            id: questions.id,
            text: questions.text,
            points: questions.points,
            order_index: questions.orderIndex,
          })
          .from(questions)
          .where(eq(questions.examId, examId))
          .orderBy(asc(questions.orderIndex));

        const qIds = qRows.map((q: any) => q.id);
        const optRows = qIds.length
          ? await drizzleDb
              .select({
                id: options.id,
                question_id: options.questionId,
                text: options.text,
                order_index: options.orderIndex,
                ...(withKey ? { is_correct: options.isCorrect } : {}),
              })
              .from(options)
              .where(inArray(options.questionId, qIds))
              .orderBy(asc(options.orderIndex))
          : [];

        const optsByQ = new Map<string, any[]>();
        for (const o of optRows as any[]) {
          const list = optsByQ.get(o.question_id) ?? [];
          list.push(o);
          optsByQ.set(o.question_id, list);
        }

        return {
          ...exam,
          questions: qRows.map((q: any) => ({
            ...q,
            options: optsByQ.get(q.id) ?? [],
          })),
        };
      }

      const opt = withKey ? "id, text, order_index, is_correct" : "id, text, order_index";
      const { data } = await db
        .from("exams")
        .select(`id, title, duration_minutes, institution_id, questions(id, text, points, order_index, options(${opt}))`)
        .eq("id", examId)
        .maybeSingle();
      return data;
    },

    async attemptsFor(studentId: string, examIds: string[]) {
      if (!examIds.length) return [];
      if (drizzleDb) {
        return drizzleDb
          .select({
            exam_id: attempts.examId,
            score: attempts.score,
            max_score: attempts.maxScore,
            submitted_at: attempts.submittedAt,
          })
          .from(attempts)
          .where(and(eq(attempts.studentId, studentId), inArray(attempts.examId, examIds)));
      }

      const { data } = await db
        .from("attempts")
        .select("exam_id, score, max_score, submitted_at")
        .eq("student_id", studentId)
        .in("exam_id", examIds);
      return data ?? [];
    },

    async findAttempt(studentId: string, examId: string) {
      if (drizzleDb) {
        const [row] = await drizzleDb
          .select({ id: attempts.id })
          .from(attempts)
          .where(and(eq(attempts.examId, examId), eq(attempts.studentId, studentId)))
          .limit(1);
        return row ?? null;
      }

      const { data } = await db
        .from("attempts")
        .select("id")
        .eq("exam_id", examId)
        .eq("student_id", studentId)
        .maybeSingle();
      return data;
    },

    async createAttempt(row: { institution_id: string; exam_id: string; student_id: string }) {
      if (drizzleDb) {
        const [created] = await drizzleDb
          .insert(attempts)
          .values({
            institutionId: row.institution_id,
            examId: row.exam_id,
            studentId: row.student_id,
            startedAt: new Date(),
          })
          .returning({ id: attempts.id });
        if (!created) throw new Error("تعذر إنشاء المحاولة.");
        return created.id as string;
      }

      const { data, error } = await db.from("attempts").insert(row).select("id").single();
      if (error || !data) throw new Error("تعذر إنشاء المحاولة.");
      return data.id as string;
    },

    async saveAnswers(rows: any[]) {
      if (!rows.length) return;
      if (drizzleDb) {
        await drizzleDb.insert(attemptAnswers).values(
          rows.map((r) => ({
            attemptId: r.attempt_id,
            institutionId: r.institution_id,
            questionId: r.question_id,
            optionId: r.option_id ?? null,
            isCorrect: r.is_correct ?? null,
            awarded: String(r.awarded ?? 0),
          })),
        );
        return;
      }

      const { error } = await db.from("attempt_answers").insert(rows);
      if (error) throw new Error(error.message);
    },

    async finishAttempt(id: string, score: number, maxScore: number) {
      if (drizzleDb) {
        await drizzleDb
          .update(attempts)
          .set({
            score: String(score),
            maxScore: String(maxScore),
            submittedAt: new Date(),
          })
          .where(eq(attempts.id, id));
        return;
      }

      const { error } = await db
        .from("attempts")
        .update({ score, max_score: maxScore, submitted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },

    async recordResult(row: { institution_id: string; assessment_id: string; student_id: string; score: number }) {
      if (drizzleDb) {
        const [existing] = await drizzleDb
          .select({ id: results.id })
          .from(results)
          .where(and(eq(results.assessmentId, row.assessment_id), eq(results.studentId, row.student_id)))
          .limit(1);
        if (existing) return;

        await drizzleDb.insert(results).values({
          institutionId: row.institution_id,
          assessmentId: row.assessment_id,
          studentId: row.student_id,
          score: String(row.score),
          note: "تصحيح آلي للاختبار الإلكتروني",
          updatedAt: new Date(),
        });
        return;
      }

      const { data: existing } = await db
        .from("results")
        .select("id")
        .eq("assessment_id", row.assessment_id)
        .eq("student_id", row.student_id)
        .maybeSingle();
      if (existing) return;
      const { error } = await db.from("results").insert({ ...row, note: "تصحيح آلي للاختبار الإلكتروني" });
      if (error) throw new Error(error.message);
    },
  };
}
