import { z } from "zod";

export const provenanceSchema = z.object({
  sourceUrl: z.string().url().optional(),
  sourceName: z.string().min(1),
  lastVerifiedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  confidence: z.number().min(0).max(1),
  status: z.enum(["VERIFIED", "REPORTED", "ESTIMATED", "UNKNOWN", "SIMULATION_ONLY"]),
});

export const importRecordSchema = z.object({
  entityType: z.string().min(1),
  externalId: z.string().optional(),
  payload: z.record(z.unknown()),
  provenance: provenanceSchema,
});

export type ImportRecordInput = z.infer<typeof importRecordSchema>;

export const validateImportRecord = (input: unknown): ImportRecordInput =>
  importRecordSchema.parse(input);
