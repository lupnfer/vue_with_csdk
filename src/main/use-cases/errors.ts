export type UseCaseErrorCategory = 'sdk' | 'db' | 'http' | 'orchestration'

export class UseCaseError extends Error {
  readonly category: UseCaseErrorCategory
  readonly cause?: unknown

  constructor(category: UseCaseErrorCategory, message: string, cause?: unknown) {
    super(message)
    this.name = 'UseCaseError'
    this.category = category
    this.cause = cause
  }
}

/** 把服务抛出的错误包成 UseCaseError，保留原错误为 cause。 */
export function wrapServiceError(e: unknown, category: UseCaseErrorCategory): UseCaseError {
  const message = e instanceof Error ? e.message : String(e)
  return new UseCaseError(category, `[${category}] ${message}`, e)
}

export interface SerializedUseCaseError {
  category: UseCaseErrorCategory
  message: string
}

export function serializeUseCaseError(err: UseCaseError): SerializedUseCaseError {
  return { category: err.category, message: err.message }
}

export function deserializeUseCaseError(data: SerializedUseCaseError): UseCaseError {
  return new UseCaseError(data.category, data.message)
}
