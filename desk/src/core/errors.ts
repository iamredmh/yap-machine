export class DeskError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DeskError {
  constructor(what: string, id: string) {
    super(`${what} "${id}" not found`, 404, "not_found", { what, id });
  }
}

export class InvalidError extends DeskError {
  constructor(message: string, issues: unknown = []) {
    super(message, 400, "invalid", { issues });
  }
}

export class RevConflictError extends DeskError {
  constructor(file: string, expected: number, current: number) {
    super(`${file} changed (expected rev ${expected}, now ${current})`, 409, "rev_conflict", { file, expected, current });
  }
}

export class CorruptFileError extends DeskError {
  constructor(file: string, reason: string) {
    super(`${file} can't be read: ${reason}. It was not changed.`, 500, "corrupt_file", { file, reason });
  }
}

export class EmptyBatchError extends DeskError {
  constructor(project: string) {
    super(`Nothing waiting to send for ${project}: add a note, a message, a file or a change to the look first`, 409, "empty_batch", { project });
  }
}
