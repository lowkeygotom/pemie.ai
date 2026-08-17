// Errores de la capa de servicios, mapeables a HTTP por la interfaz REST/MCP.
// Los servicios lanzan ServiceError con un code; los bordes lo traducen a
// texto vía renderServiceError. services/ nunca emite texto de usuario: la
// traducción vive en i18n/errors/{es,en}.ts.

import { type ErrorCode, type ErrorParams } from "./error-codes.js";
import { translate } from "../i18n/index.js";
import { es as errorsEs } from "../i18n/errors/es.js";
import { en as errorsEn } from "../i18n/errors/en.js";

const errorCatalogs = { es: errorsEs, en: errorsEn };

export class ServiceError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    public params?: ErrorParams
  ) {
    super(code);
    this.name = "ServiceError";
  }
}

export function renderServiceError(err: ServiceError, locale: string): string {
  return translate(errorCatalogs, locale, err.code, err.params);
}

export function badRequest(code: ErrorCode, params?: ErrorParams): ServiceError {
  return new ServiceError(400, code, params);
}

export function unauthorized(code: ErrorCode, params?: ErrorParams): ServiceError {
  return new ServiceError(401, code, params);
}

export function forbidden(code: ErrorCode, params?: ErrorParams): ServiceError {
  return new ServiceError(403, code, params);
}

export function notFound(code: ErrorCode, params?: ErrorParams): ServiceError {
  return new ServiceError(404, code, params);
}

export function conflict(code: ErrorCode, params?: ErrorParams): ServiceError {
  return new ServiceError(409, code, params);
}

export function serviceUnavailable(code: ErrorCode, params?: ErrorParams): ServiceError {
  return new ServiceError(503, code, params);
}
