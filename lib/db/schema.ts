import { pgTable, text, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  roleTitle: text("role_title").notNull(),
  focusAreas: jsonb("focus_areas").$type<string[]>().notNull().default([]),
  activePersonas: jsonb("active_personas")
    .$type<string[]>()
    .notNull()
    .default(["technical", "product", "behavioral"]),
  channelName: text("channel_name").notNull(),
  recruiterEmail: text("recruiter_email"),
  candidateName: text("candidate_name"),
  personaDurations: jsonb("persona_durations").$type<Record<string, number>>().notNull().default({}),
  // Per-panelist focus areas, keyed by PersonaId — each persona is scoped strictly to
  // its own list (see buildPersonaSystemPrompt in lib/personas.ts). `focusAreas` above
  // is kept as the flat union of these, for consumers that don't need per-persona detail
  // (report focus-area coverage, candidateContext.role_profile).
  personaFocusAreas: jsonb("persona_focus_areas").$type<Record<string, string[]>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const candidateContext = pgTable("candidate_context", {
  sessionId: uuid("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  context: jsonb("context").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reports = pgTable("reports", {
  sessionId: uuid("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  report: jsonb("report").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
