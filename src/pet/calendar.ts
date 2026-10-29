export type DateParts = {
  year: number;
  month: number;
  day: number;
};

export const MIN_DATE_YEAR = 1900;
export const MAX_DATE_YEAR = 2100;

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0;
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function datePartsFromDate(date: Date): DateParts {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

export function formatDateParts(parts: DateParts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(
    2,
    "0",
  )}-${String(parts.day).padStart(2, "0")}`;
}

function checkedParts(
  year: number,
  month: number,
  day: number,
): DateParts | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (year < MIN_DATE_YEAR || year > MAX_DATE_YEAR) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function parseIsoDate(value: string | null | undefined): DateParts | null {
  if (value === null || value === undefined) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return checkedParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

function normalizeDateInput(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "")
    .replace(/[０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/[／]/g, "/")
    .replace(/[－—–]/g, "-")
    .replace(/[．。]/g, ".");
}

/**
 * 以 base 为当前显示日期解析输入。
 * 支持 2026-09-21 / 9-21 / 9月21日 / 9月 / 9日 / 9（裸数字=当月第几日）。
 */
export function parseVirtualDateInput(
  value: string,
  base: Date,
): DateParts | null {
  const text = normalizeDateInput(value);
  const baseParts = datePartsFromDate(base);
  let match: RegExpExecArray | null;

  match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (match) {
    return checkedParts(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    );
  }

  match = /^(\d{4})年(\d{1,2})月(\d{1,2})[日号]?$/.exec(text);
  if (match) {
    return checkedParts(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    );
  }

  match = /^(\d{4})年(\d{1,2})月$/.exec(text);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Math.min(baseParts.day, daysInMonth(year, month));
    return checkedParts(year, month, day);
  }

  match = /^(\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (match) {
    return checkedParts(
      baseParts.year,
      Number(match[1]),
      Number(match[2]),
    );
  }

  match = /^(\d{1,2})月(\d{1,2})[日号]?$/.exec(text);
  if (match) {
    return checkedParts(
      baseParts.year,
      Number(match[1]),
      Number(match[2]),
    );
  }

  match = /^(\d{1,2})月$/.exec(text);
  if (match) {
    const month = Number(match[1]);
    const day = Math.min(baseParts.day, daysInMonth(baseParts.year, month));
    return checkedParts(baseParts.year, month, day);
  }

  match = /^(\d{1,2})[日号]$/.exec(text);
  if (match) {
    return checkedParts(
      baseParts.year,
      baseParts.month,
      Number(match[1]),
    );
  }

  match = /^(\d{1,2})$/.exec(text);
  if (match) {
    return checkedParts(
      baseParts.year,
      baseParts.month,
      Number(match[1]),
    );
  }

  return null;
}

export function dateAtParts(parts: DateParts, minuteOfDay = 0): Date {
  const minute = Math.max(0, Math.min(1439, Math.round(minuteOfDay)));
  return new Date(
    parts.year,
    parts.month - 1,
    parts.day,
    Math.floor(minute / 60),
    minute % 60,
    0,
    0,
  );
}
