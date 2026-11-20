import {
  pgTable,
  text,
  uuid,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  date,
  smallint,
  pgEnum,
  index,
  uniqueIndex,
  AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Enums
export const appRoleEnum = pgEnum("app_role", [
  "platform_admin",
  "institution_admin",
  "teacher",
  "student",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "verified",
  "rejected",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "pending",
  "issued",
  "paid",
  "void",
]);

export const questionTypeEnum = pgEnum("question_type", [
  "single_choice",
  "multiple_choice",
  "open_text",
]);

export const contractStatusEnum = pgEnum("contract_status", [
  "created",
  "institution_signed",
  "approved",
  "active",
  "rejected",
  "expired",
]);

export const officialContractActionEnum = pgEnum("official_contract_action", [
  "institution_sign",
  "platform_sign",
  "return",
]);

// academic_levels
export const academicLevels = pgTable("academic_levels", {
  archived: boolean("archived").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  durationMonths: integer("duration_months"),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  orderIndex: integer("order_index").notNull(),
  programId: uuid("program_id").references(() => programs.id, { onDelete: "cascade" }),
  specializationId: uuid("specialization_id").references(() => specializations.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// announcements
export const announcements = pgTable("announcements", {
  authorId: uuid("author_id").notNull(),
  body: text("body").notNull(),
  classId: uuid("class_id").references(() => classes.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
});

// assessments
export const assessments = pgTable("assessments", {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  description: text("description"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  examId: uuid("exam_id"),
  groupId: uuid("group_id").references(() => groups.id, { onDelete: "set null" }),
  heldOn: date("held_on"),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  kind: text("kind").notNull(),
  levelId: uuid("level_id"),
  maxScore: numeric("max_score").notNull(),
  moduleId: uuid("module_id").references(() => modules.id, { onDelete: "cascade" }),
  programId: uuid("program_id"),
  published: boolean("published").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  resultsPublished: boolean("results_published").notNull(),
  skillId: uuid("skill_id").references(() => skills.id, { onDelete: "set null" }),
  specializationId: uuid("specialization_id"),
  teacherId: uuid("teacher_id"),
  title: text("title").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  weight: numeric("weight").notNull(),
});

// attempt_answers
export const attemptAnswers = pgTable("attempt_answers", {
  attemptId: uuid("attempt_id").references(() => attempts.id, { onDelete: "cascade" }).notNull(),
  awarded: numeric("awarded").notNull(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  isCorrect: boolean("is_correct"),
  optionId: uuid("option_id").references(() => options.id, { onDelete: "set null" }),
  questionId: uuid("question_id").references(() => questions.id, { onDelete: "cascade" }).notNull(),
  textAnswer: text("text_answer"),
});

// attempts
export const attempts = pgTable("attempts", {
  examId: uuid("exam_id").references(() => exams.id, { onDelete: "cascade" }).notNull(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  maxScore: numeric("max_score"),
  score: numeric("score"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  studentId: uuid("student_id").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
});

// attendance_records
export const attendanceRecords = pgTable("attendance_records", {
  classId: uuid("class_id").references(() => classes.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  groupId: uuid("group_id").references(() => groups.id, { onDelete: "set null" }),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  minutesLate: numeric("minutes_late").notNull(),
  moduleId: uuid("module_id").references(() => modules.id, { onDelete: "set null" }),
  periodIndex: integer("period_index").notNull(),
  reason: text("reason"),
  recordedBy: text("recorded_by"),
  sessionDate: date("session_date").notNull(),
  status: text("status").notNull(),
  studentId: uuid("student_id").notNull(),
  subjectId: uuid("subject_id").references(() => subjects.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// audit_logs
export const auditLogs = pgTable("audit_logs", {
  action: text("action").notNull(),
  actorId: uuid("actor_id"),
  actorRole: text("actor_role"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id"),
  ip: text("ip"),
  metadata: jsonb("metadata").notNull(),
  resource: text("resource"),
  resourceId: uuid("resource_id"),
  result: text("result").notNull(),
});

// change_requests
export const changeRequests = pgTable("change_requests", {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decisionNote: text("decision_note"),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }),
  newValues: jsonb("new_values").notNull(),
  oldValues: jsonb("old_values").notNull(),
  requesterId: uuid("requester_id").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewerId: uuid("reviewer_id"),
  status: text("status").notNull(),
  target: text("target").notNull(),
});

// classes
export const classes = pgTable("classes", {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  specialty: text("specialty"),
  stage: text("stage"),
  stream: text("stream"),
});

// contract_artifacts
export const contractArtifacts = pgTable("contract_artifacts", {
  contractId: uuid("contract_id").primaryKey().references(() => officialContracts.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  pdfBase64: text("pdf_base64").notNull(),
  sha256: text("sha256").notNull(),
});

// contract_events
export const contractEvents = pgTable("contract_events", {
  actorId: uuid("actor_id"),
  contractId: uuid("contract_id").references(() => contracts.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").notNull(),
  note: text("note"),
  status: text("status").notNull(),
});

// contract_provider_settings
export const contractProviderSettings = pgTable("contract_provider_settings", {
  details: jsonb("details").notNull(),
  id: boolean("id").primaryKey().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  updatedBy: text("updated_by").notNull(),
});

// contracts
export const contracts = pgTable("contracts", {
  amount: numeric("amount").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  body: text("body").notNull(),
  contractNumber: text("contract_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  durationMonths: integer("duration_months").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  institutionSignature: text("institution_signature"),
  institutionSignedAt: timestamp("institution_signed_at", { withTimezone: true }),
  platformSignature: text("platform_signature"),
  platformSignedAt: timestamp("platform_signed_at", { withTimezone: true }),
  qrPayload: text("qr_payload"),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  snapshot: jsonb("snapshot").notNull(),
  status: contractStatusEnum("status").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// enrollments
export const enrollments = pgTable("enrollments", {
  classId: uuid("class_id").references(() => classes.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  studentId: uuid("student_id").notNull(),
});

// exams
export const exams = pgTable("exams", {
  classId: uuid("class_id").references(() => classes.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  description: text("description"),
  durationMinutes: integer("duration_minutes").notNull(),
  groupId: uuid("group_id"),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  moduleId: uuid("module_id"),
  published: boolean("published").notNull(),
  subjectId: uuid("subject_id").references(() => subjects.id, { onDelete: "set null" }),
  teacherId: uuid("teacher_id").notNull(),
  title: text("title").notNull(),
});

// files
export const files = pgTable("files", {
  classId: uuid("class_id").references(() => classes.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  groupId: uuid("group_id"),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  mimeType: text("mime_type"),
  moduleId: uuid("module_id"),
  name: text("name").notNull(),
  ownerId: uuid("owner_id").notNull(),
  subjectId: uuid("subject_id").references(() => subjects.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
});

// group_memberships
export const groupMemberships = pgTable("group_memberships", {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  groupId: uuid("group_id").references(() => groups.id, { onDelete: "cascade" }).notNull(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  studentId: uuid("student_id").notNull(),
});

// groups
export const groups = pgTable("groups", {
  archived: boolean("archived").notNull(),
  capacity: integer("capacity"),
  classId: uuid("class_id").references(() => classes.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  levelId: uuid("level_id").references(() => academicLevels.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// homework_submissions
export const homeworkSubmissions = pgTable("homework_submissions", {
  assessmentId: uuid("assessment_id").references(() => assessments.id, { onDelete: "cascade" }).notNull(),
  content: text("content"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  feedback: text("feedback"),
  fileUrl: text("file_url"),
  gradedAt: timestamp("graded_at", { withTimezone: true }),
  gradedBy: text("graded_by"),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  studentId: uuid("student_id").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// institutions
export const institutions = pgTable("institutions", {
  accreditationAuthority: text("accreditation_authority"),
  accreditationNumber: text("accreditation_number"),
  address: text("address"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  commercialRegister: text("commercial_register"),
  commune: text("commune").notNull(),
  coverUrl: text("cover_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  daira: text("daira"),
  email: text("email").notNull(),
  facebookUrl: text("facebook_url"),
  foundedOn: date("founded_on"),
  id: uuid("id").primaryKey().defaultRandom(),
  instagramUrl: text("instagram_url"),
  isTrial: boolean("is_trial").notNull(),
  legalRepresentative: text("legal_representative"),
  logoUrl: text("logo_url"),
  mapsUrl: text("maps_url"),
  name: text("name").notNull(),
  nameFr: text("name_fr"),
  ownerId: uuid("owner_id"),
  phone: text("phone").notNull(),
  primaryColor: text("primary_color"),
  rejectionReason: text("rejection_reason"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: uuid("reviewed_by"),
  status: text("status").notNull(),
  subscriptionEnd: date("subscription_end"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  type: text("type").notNull(),
  website: text("website"),
  wilaya: text("wilaya").notNull(),
});

// invoices
export const invoices = pgTable("invoices", {
  amount: numeric("amount").notNull(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  method: text("method").notNull(),
  number: text("number").notNull(),
  paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "set null" }),
  periodEnd: text("period_end"),
  periodStart: text("period_start"),
  status: invoiceStatusEnum("status").notNull(),
});

// lesson_completions
export const lessonCompletions = pgTable("lesson_completions", {
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  lessonId: uuid("lesson_id").references(() => lessons.id, { onDelete: "cascade" }).notNull(),
  studentId: uuid("student_id").notNull(),
});

// lessons
export const lessons = pgTable("lessons", {
  classId: uuid("class_id").references(() => classes.id, { onDelete: "cascade" }),
  content: text("content"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  description: text("description"),
  groupId: uuid("group_id"),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  moduleId: uuid("module_id"),
  pdfUrl: text("pdf_url"),
  published: boolean("published").notNull(),
  subjectId: uuid("subject_id").references(() => subjects.id, { onDelete: "cascade" }),
  teacherId: uuid("teacher_id").notNull(),
  title: text("title").notNull(),
  videoUrl: text("video_url"),
});

// licenses
export const licenses = pgTable("licenses", {
  amount: numeric("amount").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deployment: text("deployment").notNull(),
  expiresOn: date("expires_on"),
  id: uuid("id").primaryKey().defaultRandom(),
  installationId: text("installation_id"),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  licenseKey: text("license_key").notNull(),
  note: text("note"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  startsOn: date("starts_on"),
  status: text("status").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// login_attempts
export const loginAttempts = pgTable("login_attempts", {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  ip: text("ip"),
  success: boolean("success").notNull(),
});

// modules
export const modules = pgTable("modules", {
  archived: boolean("archived").notNull(),
  code: text("code"),
  coefficient: numeric("coefficient").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  hours: numeric("hours"),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  levelId: uuid("level_id").references(() => academicLevels.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  specializationId: uuid("specialization_id").references(() => specializations.id, { onDelete: "cascade" }),
  teacherId: uuid("teacher_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// notifications
export const notifications = pgTable("notifications", {
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }),
  link: text("link"),
  readAt: timestamp("read_at", { withTimezone: true }),
  recipientId: uuid("recipient_id").notNull(),
  senderId: uuid("sender_id"),
  title: text("title").notNull(),
  type: text("type").notNull(),
});

// official_contracts
export const officialContracts = pgTable("official_contracts", {
  contentHash: text("content_hash").notNull(),
  correctionNote: text("correction_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by").notNull(),
  fields: jsonb("fields").notNull(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionEvidence: jsonb("institution_evidence"),
  institutionId: uuid("institution_id").references(() => institutions.id).notNull(),
  legalText: text("legal_text").notNull(),
  number: text("number").notNull(),
  platformEvidence: jsonb("platform_evidence"),
  provider: jsonb("provider").notNull(),
  replacesId: uuid("replaces_id").references((): AnyPgColumn => officialContracts.id),
  state: text("state").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  version: text("version").notNull(),
});

// options
export const options = pgTable("options", {
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  isCorrect: boolean("is_correct").notNull(),
  orderIndex: integer("order_index").notNull(),
  questionId: uuid("question_id").references(() => questions.id, { onDelete: "cascade" }).notNull(),
  text: text("text").notNull(),
});

// password_reset_requests
export const passwordResetRequests = pgTable("password_reset_requests", {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  email: text("email").notNull(),
  fullName: text("full_name"),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id"),
  note: text("note"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  role: text("role"),
  status: text("status").notNull(),
  target: text("target").notNull(),
  tempCode: text("temp_code"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  userId: uuid("user_id"),
});

// payments
export const payments = pgTable("payments", {
  amount: numeric("amount").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  method: text("method").notNull(),
  note: text("note"),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
  proofUrl: text("proof_url"),
  reference: text("reference"),
  rejectionReason: text("rejection_reason"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  status: paymentStatusEnum("status").notNull(),
});

// personal_schedule_entries
export const personalScheduleEntries = pgTable("personal_schedule_entries", {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  dayOfWeek: numeric("day_of_week").notNull(),
  endTime: text("end_time"),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }),
  note: text("note"),
  ownerId: uuid("owner_id").notNull(),
  startTime: text("start_time").notNull(),
  title: text("title").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// profiles
export const profiles = pgTable("profiles", {
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  email: text("email").notNull(),
  firstName: text("first_name").notNull(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "set null" }),
  lastName: text("last_name").notNull(),
  passwordHash: text("password_hash"),
  phone: text("phone"),
  totpBackupCodes: text("totp_backup_codes").array(),
  totpEnabled: boolean("totp_enabled").notNull(),
  totpSecret: text("totp_secret"),
});

// programs
export const programs = pgTable("programs", {
  archived: boolean("archived").notNull(),
  code: text("code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  description: text("description"),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// questions
export const questions = pgTable("questions", {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  examId: uuid("exam_id").references(() => exams.id, { onDelete: "cascade" }).notNull(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  orderIndex: integer("order_index").notNull(),
  points: numeric("points").notNull(),
  text: text("text").notNull(),
  type: questionTypeEnum("type").notNull(),
});

// results
export const results = pgTable("results", {
  assessmentId: uuid("assessment_id").references(() => assessments.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  note: text("note"),
  recordedBy: text("recorded_by"),
  score: numeric("score").notNull(),
  studentId: uuid("student_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// rooms
export const rooms = pgTable("rooms", {
  capacity: integer("capacity"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// schedules
export const schedules = pgTable("schedules", {
  archived: boolean("archived").notNull(),
  classId: uuid("class_id").references(() => classes.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  dayOfWeek: numeric("day_of_week").notNull(),
  endTime: text("end_time"),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  label: text("label"),
  periodIndex: integer("period_index").notNull(),
  roomId: uuid("room_id"),
  startTime: text("start_time").notNull(),
  subjectId: uuid("subject_id").references(() => subjects.id, { onDelete: "set null" }),
  teacherId: uuid("teacher_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// skills
export const skills = pgTable("skills", {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  description: text("description"),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  moduleId: uuid("module_id").references(() => modules.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  weight: numeric("weight").notNull(),
});

// specializations
export const specializations = pgTable("specializations", {
  archived: boolean("archived").notNull(),
  code: text("code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  description: text("description"),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  programId: uuid("program_id").references(() => programs.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// subjects
export const subjects = pgTable("subjects", {
  classId: uuid("class_id").references(() => classes.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  teacherId: uuid("teacher_id"),
});

// support_messages
export const supportMessages = pgTable("support_messages", {
  address: text("address"),
  commune: text("commune"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  email: text("email").notNull(),
  firstName: text("first_name").notNull(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionName: text("institution_name"),
  lastName: text("last_name").notNull(),
  message: text("message"),
  phone: text("phone").notNull(),
  wilaya: text("wilaya"),
});

// trial_requests
export const trialRequests = pgTable("trial_requests", {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  email: text("email").notNull(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionName: text("institution_name").notNull(),
  motivation: text("motivation").notNull(),
  note: text("note"),
  phone: text("phone").notNull(),
  status: text("status").notNull(),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// user_roles
export const userRoles = pgTable("user_roles", {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }),
  role: appRoleEnum("role").notNull(),
  userId: uuid("user_id").notNull(),
});

// user_sessions (Independent Session Store)
export const userSessions = pgTable("user_sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }),
  roles: text("roles").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
});
