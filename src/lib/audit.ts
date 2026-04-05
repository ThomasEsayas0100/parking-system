import { prisma } from "./prisma";
import { AuditAction } from "@/generated/prisma/client";

type AuditParams = {
  action: AuditAction;
  sessionId?: string;
  driverId?: string;
  vehicleId?: string;
  spotId?: string;
  details?: string;
};

export async function log(params: AuditParams) {
  return prisma.auditLog.create({ data: params });
}
