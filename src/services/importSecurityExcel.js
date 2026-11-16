
import "dotenv/config";
import XlsxPopulate from "xlsx-populate";
import { retailPoolPromise, sql } from "../config/db.js";

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const EXCEL_PATH =
  process.env.SECURITY_PERMITS_EXCEL_PATH || "D:/مندوبين.xlsx";

const EXCEL_PASSWORD = undefined;
const PREFERRED_SHEET_NAME = "Chart1";
const REQUEST_TIMEOUT = 120000;
const LOG_EVERY = 100;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function cleanText(value) {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value.toISOString().slice(0, 10);
  }

  if (typeof value === "object") return null;

  const text = String(value).replace(/\u00a0/g, " ").trim();
  return text || null;
}

function normalizeArabicDigits(value) {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";

  return String(value)
    .replace(/[٠-٩]/g, (d) => arabicDigits.indexOf(d))
    .replace(/[۰-۹]/g, (d) => persianDigits.indexOf(d));
}

function expandScientificNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? value.toFixed(0) : String(value);
  }

  const text = String(value ?? "").trim();

  if (/^\d+(\.\d+)?e[+-]?\d+$/i.test(text)) {
    const number = Number(text);

    if (Number.isFinite(number)) {
      return number.toFixed(0);
    }
  }

  return text;
}

function normalizeNationalId(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const text = normalizeArabicDigits(expandScientificNumber(value))
    .replace(/\s/g, "")
    .trim();

  return /^\d{14}$/.test(text) ? text : null;
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(
      Date.UTC(1899, 11, 30) + value * 86400000
    );

    return Number.isNaN(date.getTime())
      ? null
      : date.toISOString().slice(0, 10);
  }

  const text = normalizeArabicDigits(String(value)).trim();

  if (!text) return null;

  // dd/mm/yyyy أو dd-mm-yyyy
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);

  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);

    const date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // yyyy-mm-dd
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);

    const date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
}

function toSqlDate(value) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function combineNotes(...values) {
  const cleaned = values.map(cleanText).filter(Boolean);
  return cleaned.length ? cleaned.join("\n\n") : null;
}

/* -------------------------------------------------------------------------- */
/* Excel mapping                                                              */
/* -------------------------------------------------------------------------- */

function mapExcelRow(row, excelRowNumber) {
  const rawNationalId =
    row[4] === null || row[4] === undefined
      ? null
      : expandScientificNumber(row[4]);

  return {
    sourceRecordNumber: cleanText(row[0]),
    name: cleanText(row[1]),
    birthDate: normalizeDate(row[2]),
    extraData: cleanText(row[3]),

    rawNationalId,
    nationalId: normalizeNationalId(rawNationalId),

    companyName: cleanText(row[5]),
    incidentDate: normalizeDate(row[6]),
    branch: cleanText(row[7]),

    stolenGoods: cleanText(row[8]),

    notes: combineNotes(
      row[9],
      row[3],
      row[0] ? `رقم السجل الأصلي: ${cleanText(row[0])}` : null
    ),

    excelRowNumber,
  };
}

/* -------------------------------------------------------------------------- */
/* One SQL operation per Excel row                                            */
/* -------------------------------------------------------------------------- */

async function importOneRecord(pool, record) {
  const request = pool.request();

  // رفع مهلة تنفيذ هذا الطلب
  request.timeout = REQUEST_TIMEOUT;

  request.input("name", sql.NVarChar(510), record.name);
  request.input(
    "nationalId",
    sql.NVarChar(100),
    record.nationalId
  );
  request.input(
    "rawNationalId",
    sql.NVarChar(100),
    record.rawNationalId
  );
  request.input(
    "birthDate",
    sql.Date,
    toSqlDate(record.birthDate)
  );
  request.input(
    "companyName",
    sql.NVarChar(510),
    record.companyName
  );
  request.input(
    "branch",
    sql.NVarChar(510),
    record.branch
  );
  request.input(
    "stolenGoods",
    sql.NVarChar(sql.MAX),
    record.stolenGoods
  );
  request.input(
    "incidentDate",
    sql.Date,
    toSqlDate(record.incidentDate)
  );
  request.input(
    "notes",
    sql.NVarChar(sql.MAX),
    record.notes
  );
  request.input(
    "fallbackName",
    sql.NVarChar(510),
    record.name || `بدون اسم - صف Excel ${record.excelRowNumber}`
  );

  const result = await request.query(`
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @personId INT;
    DECLARE @personCreated BIT = 0;
    DECLARE @incidentId INT;
    DECLARE @incidentInserted BIT = 0;

    BEGIN TRY
      BEGIN TRANSACTION;

      /* -------------------------------------------------------------- */
      /* Find existing person                                            */
      /* -------------------------------------------------------------- */

      IF @nationalId IS NOT NULL
      BEGIN
        SELECT TOP (1)
          @personId = id
        FROM dbo.security_persons
        WHERE national_id_number = @nationalId
        ORDER BY id;
      END
      ELSE
      BEGIN
        IF @name IS NOT NULL AND @birthDate IS NOT NULL
        BEGIN
          SELECT TOP (1)
            @personId = id
          FROM dbo.security_persons
          WHERE name = @name
            AND birth_date = @birthDate
          ORDER BY id;
        END
        ELSE IF @name IS NOT NULL
        BEGIN
          SELECT TOP (1)
            @personId = id
          FROM dbo.security_persons
          WHERE name = @name
          ORDER BY id;
        END
      END;

      /* -------------------------------------------------------------- */
      /* Insert person if not found                                      */
      /* -------------------------------------------------------------- */

      IF @personId IS NULL
      BEGIN
        INSERT INTO dbo.security_persons
        (
          name,
          national_id_number,
          birth_date,
          security_situation,
          company_display_name,
          job,
          notes,
          created_at,
          is_deleted
        )
        VALUES
        (
          @fallbackName,
          @rawNationalId,
          @birthDate,
          N'غير محدد',
          @companyName,
          N'مندوب',
          @notes,
          SYSDATETIME(),
          0
        );

        SET @personId = CONVERT(INT, SCOPE_IDENTITY());
        SET @personCreated = 1;
      END;

      /* -------------------------------------------------------------- */
      /* Check duplicate incident                                        */
      /* -------------------------------------------------------------- */

      SELECT TOP (1)
        @incidentId = id
      FROM dbo.security_incidents
      WHERE security_person_id = @personId
        AND (
          branch = @branch
          OR (branch IS NULL AND @branch IS NULL)
        )
        AND (
          stolen_goods = @stolenGoods
          OR (stolen_goods IS NULL AND @stolenGoods IS NULL)
        )
        AND (
          incident_date = @incidentDate
          OR (incident_date IS NULL AND @incidentDate IS NULL)
        )
        AND (
          notes = @notes
          OR (notes IS NULL AND @notes IS NULL)
        )
      ORDER BY id;

      /* -------------------------------------------------------------- */
      /* Insert incident if not found                                    */
      /* -------------------------------------------------------------- */

      IF @incidentId IS NULL
      BEGIN
        INSERT INTO dbo.security_incidents
        (
          security_person_id,
          branch,
          stolen_goods,
          stolen_goods_value,
          incident_date,
          notes
        )
        VALUES
        (
          @personId,
          @branch,
          @stolenGoods,
          NULL,
          @incidentDate,
          @notes
        );

        SET @incidentId = CONVERT(INT, SCOPE_IDENTITY());
        SET @incidentInserted = 1;
      END;

      COMMIT TRANSACTION;

      SELECT
        @personId AS personId,
        @personCreated AS personCreated,
        @incidentId AS incidentId,
        @incidentInserted AS incidentInserted;

    END TRY
    BEGIN CATCH

      IF XACT_STATE() <> 0
      BEGIN
        ROLLBACK TRANSACTION;
      END;

      THROW;

    END CATCH;
  `);

  if (!result.recordset?.length) {
    throw new Error("SQL لم يرجع نتيجة تسجيل الشخص والواقعة.");
  }

  const row = result.recordset[0];

  return {
    personId: row.personId,
    personCreated: Boolean(row.personCreated),
    incidentId: row.incidentId,
    incidentInserted: Boolean(row.incidentInserted),
  };
}

/* -------------------------------------------------------------------------- */
/* Main import                                                                */
/* -------------------------------------------------------------------------- */

async function importSecurityExcel() {
  console.log("======================================");
  console.log("SECURITY PERMITS / MANDOBIN IMPORT");
  console.log("======================================");

  console.log("Excel:", EXCEL_PATH);

  const workbook = await XlsxPopulate.fromFileAsync(EXCEL_PATH, {
    password: EXCEL_PASSWORD,
  });

  const sheets = workbook.sheets();

  if (!sheets.length) {
    throw new Error("ملف Excel لا يحتوي على أي شيت.");
  }

  const sheet =
    workbook.sheet(PREFERRED_SHEET_NAME) || sheets[0];

  console.log("Available sheets:", sheets.map((s) => s.name()));
  console.log("Selected sheet:", sheet.name());

  const usedRange = sheet.usedRange();

  if (!usedRange) {
    throw new Error("الشيت المختار فارغ.");
  }

  const values = usedRange.value();

  if (!Array.isArray(values) || values.length < 2) {
    throw new Error("الشيت لا يحتوي على بيانات كافية.");
  }

  const records = values
    .slice(1)
    .map((row, index) => ({
      row,
      excelRowNumber: index + 2,
    }))
    .filter(({ row }) =>
      Array.isArray(row) &&
      row.some((value) => cleanText(value) !== null)
    )
    .map(({ row, excelRowNumber }) =>
      mapExcelRow(row, excelRowNumber)
    );

  console.log("Total rows found:", records.length);
  console.log("--------------------------------------");

  const pool = await retailPoolPromise;

  let insertedPeople = 0;
  let existingPeople = 0;
  let insertedIncidents = 0;
  let skippedIncidents = 0;
  let failedRows = 0;

  const errors = [];

  for (let index = 0; index < records.length; index++) {
    const record = records[index];

    try {
      const result = await importOneRecord(pool, record);

      if (result.personCreated) {
        insertedPeople++;
      } else {
        existingPeople++;
      }

      if (result.incidentInserted) {
        insertedIncidents++;
      } else {
        skippedIncidents++;
      }

      const completed = index + 1;

      if (
        completed === 1 ||
        completed % LOG_EVERY === 0 ||
        completed === records.length
      ) {
        console.log(
          `Progress: ${completed}/${records.length} | ` +
          `Row: ${record.excelRowNumber} | ` +
          `Person: ${result.personCreated ? "CREATED" : "EXISTING"} | ` +
          `Incident: ${result.incidentInserted ? "INSERTED" : "EXISTING"}`
        );
      }
    } catch (error) {
      failedRows++;

      errors.push({
        row: record.excelRowNumber,
        name: record.name,
        nationalId: record.rawNationalId,
        error: error.message,
      });

      console.error(
        `ERROR in Excel row ${record.excelRowNumber}:`,
        error.message
      );

      // نكمل الصف التالي دون محاولة Rollback من JavaScript.
    }
  }

  console.log("\n======================================");
  console.log("IMPORT FINISHED");
  console.log("======================================");

  console.log("Total rows:", records.length);
  console.log("New persons:", insertedPeople);
  console.log("Existing persons:", existingPeople);
  console.log("New incidents:", insertedIncidents);
  console.log("Skipped duplicate incidents:", skippedIncidents);
  console.log("Failed rows:", failedRows);

  if (errors.length) {
    console.log("\nFailed rows details:");
    console.table(errors);
  }

  console.log("======================================");
}

/* -------------------------------------------------------------------------- */
/* Run                                                                        */
/* -------------------------------------------------------------------------- */

importSecurityExcel()
  .then(() => {
    console.log("Mandobeen Excel import finished.");
  })
  .catch((error) => {
    console.error("IMPORT FAILED:", error);
    process.exitCode = 1;
  });
