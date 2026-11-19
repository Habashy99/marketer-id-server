
import XlsxPopulate from "xlsx-populate";
import { randomUUID } from "node:crypto";

import {
  retailPoolPromise,
  securityPoolPromise,
  sql,
} from "../config/db.js";

/* -------------------------------------------------------------------------- */
/* Temporary Excel Files                                                      */
/* -------------------------------------------------------------------------- */

const FILE_TTL = 30 * 60 * 1000;
const temporaryFiles = new Map();

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const NATIONAL_ID_HEADERS = [
  "رقم قومي",
  "الرقم القومي",
  "الرقم القومى",
  "رقم الهوية",
  "national_id_number",
  "national_id",
  "nationalid",
];

const NAME_HEADERS = [
  "الاسم",
  "اسم المتقدم",
  "اسم المتقدمين",
  "اسم الموظف",
  "اسم المندوب",
  "name",
  "full_name",
  "applicant_name",
];

const DECISION_HEADER = "قرار التعيين";
const REASON_HEADER = "سبب القرار";

/* -------------------------------------------------------------------------- */
/* General Helpers                                                            */
/* -------------------------------------------------------------------------- */

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_-]/g, "");
}

function normalizeSheetName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[أإآ]/g, "ا");
}

function normalizeNationalId(value, numberFormat = "") {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    value instanceof Date
  ) {
    return "";
  }

  let nationalId = String(value).trim();

  nationalId = nationalId.replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
    const persianDigits = "۰۱۲۳۴۵۶۷۸۹";

    const arabicIndex = arabicDigits.indexOf(digit);

    if (arabicIndex !== -1) {
      return String(arabicIndex);
    }

    const persianIndex = persianDigits.indexOf(digit);

    if (persianIndex !== -1) {
      return String(persianIndex);
    }

    return digit;
  });

  nationalId = nationalId.replace(/\s/g, "");

  if (
    /^\d+$/.test(nationalId) &&
    /^0{2,}/.test(String(numberFormat || "")) &&
    nationalId.length < 14
  ) {
    nationalId = nationalId.padStart(14, "0");
  }

  return nationalId;
}

function serializeCellValue(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (value === null || value === undefined) {
    return "";
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "object") {
    if (value.text !== undefined) {
      return String(value.text);
    }

    if (value.value !== undefined) {
      return serializeCellValue(value.value);
    }

    return "";
  }

  return "";
}

function isEmptyCell(value) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  );
}

function isEmptyRow(row) {
  return !row || row.every(isEmptyCell);
}

function cleanupExpiredFiles() {
  const now = Date.now();

  for (const [jobId, file] of temporaryFiles.entries()) {
    if (file.expiresAt <= now) {
      temporaryFiles.delete(jobId);
    }
  }
}

function findColumn(headerRow, acceptedHeaders) {
  const accepted = new Set(acceptedHeaders.map(normalizeHeader));

  return headerRow.findIndex((header) =>
    accepted.has(normalizeHeader(header)),
  );
}

function getColumnValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

/* -------------------------------------------------------------------------- */
/* Excel Sheet Selection                                                      */
/* -------------------------------------------------------------------------- */

function findRecruitmentSheet(workbook) {
  const sheets = workbook.sheets();

  console.log(
    "[Recruitment] Available sheets:",
    sheets.map((item) => item.name()),
  );

  const targetName = normalizeSheetName("بيانات التعيينات");

  const sheet = sheets.find(
    (item) => normalizeSheetName(item.name()) === targetName,
  );

  if (!sheet) {
    const availableNames = sheets.map((item) => item.name()).join(" | ");

    throw new Error(
      `لم يتم العثور على صفحة بيانات التعيينات. الصفحات الموجودة: ${availableNames}`,
    );
  }

  console.log("[Recruitment] Selected sheet:", sheet.name());

  return sheet;
}

/* -------------------------------------------------------------------------- */
/* Find Actual Last Applicant Row                                             */
/* -------------------------------------------------------------------------- */

function findActualLastRow(
  sheet,
  maximumRow,
  nationalIdColumnIndex,
  nameColumnIndex,
) {
  if (maximumRow < 2) {
    return 1;
  }

  const columnsToCheck = [
    nationalIdColumnIndex,
    nameColumnIndex,
  ].filter(
    (column, index, array) =>
      column >= 0 && array.indexOf(column) === index,
  );

  const columnValues = [];

  for (const columnIndex of columnsToCheck) {
    const values = sheet
      .range(2, columnIndex + 1, maximumRow, columnIndex + 1)
      .value();

    columnValues.push(values);
  }

  const totalRows = maximumRow - 1;

  for (let index = totalRows - 1; index >= 0; index--) {
    const hasData = columnValues.some((values) => {
      const cellValue = getColumnValue(values[index]);

      return !isEmptyCell(cellValue);
    });

    if (hasData) {
      return index + 2;
    }
  }

  return 1;
}

/* -------------------------------------------------------------------------- */
/* Security Lookup                                                            */
/* -------------------------------------------------------------------------- */

async function findSecurityNationalIds(nationalIds) {
  const foundIds = new Set();

  if (!nationalIds.length) {
    return foundIds;
  }

  const pool = await retailPoolPromise;

  const result = await pool.request().query(`
    SELECT national_id_number
    FROM dbo.security_persons
    WHERE national_id_number IS NOT NULL;
  `);

  for (const record of result.recordset) {
    const nationalId = normalizeNationalId(
      record.national_id_number,
    );

    if (/^\d{14}$/.test(nationalId)) {
      foundIds.add(nationalId);
    }
  }

  return foundIds;
}

/* -------------------------------------------------------------------------- */
/* Process Excel                                                              */
/* -------------------------------------------------------------------------- */

async function processRecuritmentWorkbook(fileBuffer) {
  const startTime = Date.now();

  const workbook = await XlsxPopulate.fromDataAsync(fileBuffer);

  const sheet = findRecruitmentSheet(workbook);

  const usedRange = sheet.usedRange();

  if (!usedRange) {
    throw new Error("صفحة بيانات التعيينات فارغة.");
  }

  const maximumRow = usedRange.endCell().rowNumber();

  let lastColumn = usedRange.endCell().columnNumber();

  if (maximumRow < 2) {
    throw new Error("الملف لا يحتوي على بيانات للمتقدمين.");
  }

  // قراءة العناوين
  const headerRow = sheet.range(1, 1, 1, lastColumn).value()[0] || [];

  const nationalIdColumnIndex = findColumn(
    headerRow,
    NATIONAL_ID_HEADERS,
  );

  if (nationalIdColumnIndex === -1) {
    throw new Error(
      "لم يتم العثور على عمود الرقم القومي. تأكد من عنوان العمود.",
    );
  }

  const nameColumnIndex = findColumn(headerRow, NAME_HEADERS);

  if (nameColumnIndex === -1) {
    throw new Error(
      "لم يتم العثور على عمود الاسم. تأكد من عنوان العمود.",
    );
  }

  // البحث عن أعمدة القرار وسبب القرار
  let decisionColumnIndex = findColumn(headerRow, [
    DECISION_HEADER,
  ]);

  let reasonColumnIndex = findColumn(headerRow, [
    REASON_HEADER,
  ]);

  // إضافة الأعمدة الناقصة فقط
  if (decisionColumnIndex === -1) {
    decisionColumnIndex = lastColumn;

    lastColumn++;

    sheet
      .cell(1, decisionColumnIndex + 1)
      .value(DECISION_HEADER);
  }

  if (reasonColumnIndex === -1) {
    reasonColumnIndex = lastColumn;

    lastColumn++;

    sheet
      .cell(1, reasonColumnIndex + 1)
      .value(REASON_HEADER);
  }

  console.log(
    "[Recruitment] Maximum formatted row:",
    maximumRow,
  );

  // تحديد آخر صف فعلي
  const lastRow = findActualLastRow(
    sheet,
    maximumRow,
    nationalIdColumnIndex,
    nameColumnIndex,
  );

  if (lastRow < 2) {
    throw new Error("لم يتم العثور على متقدمين في الملف.");
  }

  console.log(
    "[Recruitment] Actual last applicant row:",
    lastRow,
  );

  // قراءة البيانات
  const data = sheet.range(1, 1, lastRow, lastColumn).value();

  const applicantsToCheck = [];

  let skipped = 0;

  // تجهيز المتقدمين وتخطي الصفوف التي تم فحصها سابقًا
  for (let index = 1; index < data.length; index++) {
    const row = data[index] || [];

    const rowNumber = index + 1;

    if (isEmptyRow(row)) {
      continue;
    }

    const name = serializeCellValue(
      row[nameColumnIndex],
    );

    const rawNationalId = row[nationalIdColumnIndex];

    const numberFormat = sheet
      .cell(rowNumber, nationalIdColumnIndex + 1)
      .style("numberFormat");

    const nationalId = normalizeNationalId(
      rawNationalId,
      numberFormat,
    );

    const existingDecision = serializeCellValue(
      row[decisionColumnIndex],
    );

    const existingReason = serializeCellValue(
      row[reasonColumnIndex],
    );

    // إذا كان القرار والسبب موجودين لا نعيد الفحص
    if (
      !isEmptyCell(existingDecision) &&
      !isEmptyCell(existingReason)
    ) {
      skipped++;
      continue;
    }

    applicantsToCheck.push({
      rowNumber,
      name,
      nationalId,
    });
  }

  console.log("[Recruitment] Total rows:", data.length - 1);

  console.log("[Recruitment] Already checked:", skipped);

  console.log(
    "[Recruitment] New applicants:",
    applicantsToCheck.length,
  );

  // فحص الأرقام القومية للمتقدمين الجدد فقط
  const uniqueNationalIds = [
    ...new Set(
      applicantsToCheck
        .map((applicant) => applicant.nationalId)
        .filter((id) => /^\d{14}$/.test(id)),
    ),
  ];

  const securityIds = await findSecurityNationalIds(
    uniqueNationalIds,
  );

  const summary = {
    total: applicantsToCheck.length,
    accepted: 0,
    rejected: 0,
    invalid: 0,
    skipped,
  };

  const results = [];

  // معالجة الصفوف الجديدة فقط
  for (const applicant of applicantsToCheck) {
    let decision;
    let reason;

    if (!/^\d{14}$/.test(applicant.nationalId)) {
      decision = "رقم قومي غير صحيح";

      reason = "الرقم القومي يجب أن يتكون من 14 رقمًا.";

      summary.invalid++;
    } else if (securityIds.has(applicant.nationalId)) {
      decision = "مرفوض";

      reason = "الرقم القومي مسجل في ملفات إدارة الأمن.";

      summary.rejected++;
    } else {
      decision = "مقبول";

      reason = "الرقم القومي غير موجود في ملفات إدارة الأمن.";

      summary.accepted++;
    }

    // تحديث خلايا الصف الجديد فقط
    sheet
      .cell(applicant.rowNumber, decisionColumnIndex + 1)
      .value(decision);

    sheet
      .cell(applicant.rowNumber, reasonColumnIndex + 1)
      .value(reason);

    results.push({
      serialNumber: results.length + 1,
      rowNumber: applicant.rowNumber,
      name: applicant.name,
      nationalId: applicant.nationalId,
      decision,
      reason,
    });
  }

  // إخراج الملف بعد الاحتفاظ بالنتائج القديمة وإضافة الجديدة
  const outputBuffer = await workbook.outputAsync();

  const durationSeconds = (
    (Date.now() - startTime) /
    1000
  ).toFixed(2);

  console.log("[Recruitment] Completed:", {
    totalRows: data.length - 1,
    checkedNow: summary.total,
    skipped,
    accepted: summary.accepted,
    rejected: summary.rejected,
    invalid: summary.invalid,
    durationSeconds,
  });

  return {
    columns: [
      "م",
      "الاسم",
      "الرقم القومي",
      DECISION_HEADER,
      REASON_HEADER,
    ],
    results,
    summary,
    outputBuffer,
  };
}

/* -------------------------------------------------------------------------- */
/* Check Applicants - Upload Once                                             */
/* -------------------------------------------------------------------------- */

export async function checkRecuritment(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: "من فضلك اختر ملف Excel أولاً.",
      });
    }

    cleanupExpiredFiles();

    const result = await processRecuritmentWorkbook(
      req.file.buffer,
    );

    const jobId = randomUUID();

    temporaryFiles.set(jobId, {
      ownerId: String(req.user.id),
      buffer: result.outputBuffer,
      fileName: "recuritment-results.xlsx",
      expiresAt: Date.now() + FILE_TTL,
    });

    return res.status(200).json({
      message: "تم رفع وفحص الملف بنجاح.",
      jobId,
      expiresInMinutes: 30,
      columns: result.columns,
      summary: result.summary,
      results: result.results,
    });
  } catch (error) {
    console.error("Recuritment check error:", error);

    return res.status(500).json({
      message:
        error.message ||
        "حدث خطأ أثناء فحص ملف المتقدمين.",
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Download Previously Processed Excel                                       */
/* -------------------------------------------------------------------------- */

export async function downloadRecuritmentResults(req, res) {
  try {
    cleanupExpiredFiles();

    const { jobId } = req.params;

    const savedFile = temporaryFiles.get(jobId);

    if (!savedFile) {
      return res.status(404).json({
        message:
          "الملف غير موجود أو انتهت مدة الاحتفاظ به. ارفع الملف مرة أخرى.",
      });
    }

    if (savedFile.ownerId !== String(req.user.id)) {
      return res.status(403).json({
        message: "ليس لديك صلاحية تنزيل هذا الملف.",
      });
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${savedFile.fileName}"`,
    );

    return res.status(200).send(savedFile.buffer);
  } catch (error) {
    console.error("Recuritment download error:", error);

    return res.status(500).json({
      message: "حدث خطأ أثناء تنزيل ملف النتائج.",
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Recruitment Applicants - Helpers                                          */
/* -------------------------------------------------------------------------- */

function getEmployeeCode(req) {
  const code = Number(req.user?.code);

  if (!Number.isInteger(code) || code <= 0) {
    throw new Error(
      "تعذر تحديد كود الموظف المسجل دخوله.",
    );
  }

  return code;
}

/* -------------------------------------------------------------------------- */
/* Validate Applicant Data                                                    */
/* -------------------------------------------------------------------------- */

function validateApplicantData(body = {}) {
  const name = String(body.name ?? "").trim();

  const nationalId = normalizeNationalId(
    body.nationalId,
  ).trim();

  const mobile = normalizeNationalId(
    body.mobile,
  ).trim();

  const applicationDate = String(
    body.applicationDate ?? "",
  ).trim();

  const decision = String(
    body.decision ?? "",
  ).trim();

  const reason = String(
    body.reason ?? "",
  ).trim();

  if (!name || name.length > 200) {
    throw new Error(
      "اسم المتقدم مطلوب، وبحد أقصى 200 حرف.",
    );
  }

  if (!/^\d{14}$/.test(nationalId)) {
    throw new Error(
      "الرقم القومي يجب أن يتكون من 14 رقمًا.",
    );
  }

  if (!mobile || mobile.length > 20) {
    throw new Error(
      "رقم التليفون مطلوب وبحد أقصى 20 خانة.",
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(applicationDate)) {
    throw new Error("تاريخ التقديم غير صحيح.");
  }

  const [year, month, day] = applicationDate
    .split("-")
    .map(Number);

  const date = new Date(
    Date.UTC(year, month - 1, day),
  );

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("تاريخ التقديم غير صحيح.");
  }

  if (decision.length > 100) {
    throw new Error(
      "قرار التعيين يجب ألا يتجاوز 100 حرف.",
    );
  }

  if (reason.length > 1000) {
    throw new Error(
      "سبب القرار يجب ألا يتجاوز 1000 حرف.",
    );
  }

  return {
    name,
    nationalId,
    mobile,
    applicationDate,
    decision: decision || null,
    reason: reason || null,
  };
}

/* -------------------------------------------------------------------------- */
/* Check Applicant National ID                                                */
/* -------------------------------------------------------------------------- */

async function checkApplicantNationalId(
  pool,
  nationalId,
  excludeId = null,
) {
  // التأكد من عدم وجود الرقم القومي في جدول الأمن
  const securityIds = await findSecurityNationalIds([
    nationalId,
  ]);

  if (securityIds.has(nationalId)) {
    throw new Error(
      "هذا الرقم القومي موجود في جدول الأمن، لذلك لا يمكن إضافة المتقدم.",
    );
  }

  // منع تكرار الرقم القومي في المتقدمين غير المحذوفين
  const request = pool.request();

  request.input(
    "nationalId",
    sql.NVarChar(14),
    nationalId,
  );

  let duplicateQuery = `
    SELECT TOP 1 id
    FROM dbo.recruitment_applicants
    WHERE national_id = @nationalId
      AND is_deleted = 0
  `;

  if (excludeId !== null) {
    request.input("excludeId", sql.Int, excludeId);

    duplicateQuery += " AND id <> @excludeId";
  }

  const duplicate = await request.query(
    duplicateQuery,
  );

  if (duplicate.recordset.length > 0) {
    throw new Error(
      "هذا الرقم القومي مسجل بالفعل في المتقدمين.",
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Get Applicants - Pagination                                               */
/* -------------------------------------------------------------------------- */

export async function getRecruitmentApplicants(req, res) {
  try {
    const page = Math.max(
      1,
      parseInt(req.query.page, 10) || 1,
    );

    const limit = Math.min(
      50,
      Math.max(
        1,
        parseInt(req.query.limit, 10) || 50,
      ),
    );

    const offset = (page - 1) * limit;

    const pool = await securityPoolPromise;

    const countResult = await pool.request().query(`
      SELECT COUNT(*) AS total
      FROM dbo.recruitment_applicants
      WHERE is_deleted = 0;
    `);

    const total = countResult.recordset[0].total;

    const totalPages = Math.ceil(total / limit);

    const dataResult = await pool
      .request()
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit)
      .query(`
        SELECT
          id,
          name,
          national_id AS nationalId,
          mobile,
          application_date AS applicationDate,
          decision,
          reason,
          created_by AS createdBy,
          updated_by AS updatedBy,
          is_deleted AS isDeleted,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM dbo.recruitment_applicants
        WHERE is_deleted = 0
        ORDER BY created_at DESC, id DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY;
      `);

    return res.status(200).json({
      success: true,
      data: dataResult.recordset,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error(
      "Get recruitment applicants error:",
      error,
    );

    return res.status(500).json({
      message:
        error.message ||
        "حدث خطأ أثناء جلب المتقدمين.",
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Create Applicant                                                           */
/* -------------------------------------------------------------------------- */

export async function createRecruitmentApplicant(req, res) {
  try {
    const employeeCode = getEmployeeCode(req);

    const applicant = validateApplicantData(req.body);

    const pool = await securityPoolPromise;

    await checkApplicantNationalId(
      pool,
      applicant.nationalId,
    );

    const result = await pool
      .request()
      .input(
        "name",
        sql.NVarChar(200),
        applicant.name,
      )
      .input(
        "nationalId",
        sql.NVarChar(14),
        applicant.nationalId,
      )
      .input(
        "mobile",
        sql.NVarChar(20),
        applicant.mobile,
      )
      .input(
        "applicationDate",
        sql.Date,
        applicant.applicationDate,
      )
      .input(
        "decision",
        sql.NVarChar(100),
        applicant.decision,
      )
      .input(
        "reason",
        sql.NVarChar(1000),
        applicant.reason,
      )
      .input(
        "createdBy",
        sql.Int,
        employeeCode,
      )
      .query(`
        INSERT INTO dbo.recruitment_applicants
        (
          name,
          national_id,
          mobile,
          application_date,
          decision,
          reason,
          created_by
        )
        OUTPUT
          INSERTED.id,
          INSERTED.name,
          INSERTED.national_id AS nationalId,
          INSERTED.mobile,
          INSERTED.application_date AS applicationDate,
          INSERTED.decision,
          INSERTED.reason,
          INSERTED.created_by AS createdBy,
          INSERTED.created_at AS createdAt,
          INSERTED.is_deleted AS isDeleted
        VALUES
        (
          @name,
          @nationalId,
          @mobile,
          @applicationDate,
          @decision,
          @reason,
          @createdBy
        );
      `);

    return res.status(201).json({
      success: true,
      message: "تم إضافة المتقدم بنجاح.",
      data: result.recordset[0],
    });
  } catch (error) {
    console.error(
      "Create recruitment applicant error:",
      error,
    );

    return res.status(400).json({
      message:
        error.message ||
        "حدث خطأ أثناء إضافة المتقدم.",
    });
  }
}
/* -------------------------------------------------------------------------- */
/* Update Applicant                                                           */
/* -------------------------------------------------------------------------- */

export async function updateRecruitmentApplicant(req, res) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        message: "رقم المتقدم غير صحيح.",
      });
    }

    const employeeCode = getEmployeeCode(req);

    // التعديل مسموح للاسم ورقم الهاتف فقط
    const name = String(req.body.name ?? "").trim();
    const mobile = String(req.body.mobile ?? "").trim();

    if (!name || name.length > 200) {
      return res.status(400).json({
        message: "اسم المتقدم مطلوب، وبحد أقصى 200 حرف.",
      });
    }

    if (!mobile || mobile.length > 20) {
      return res.status(400).json({
        message: "رقم التليفون مطلوب وبحد أقصى 20 خانة.",
      });
    }

    const pool = await securityPoolPromise;

    // التأكد من وجود المتقدم وعدم حذفه
    const existing = await pool
      .request()
      .input("id", sql.Int, id)
      .query(`
        SELECT id
        FROM dbo.recruitment_applicants
        WHERE id = @id
          AND is_deleted = 0;
      `);

    if (existing.recordset.length === 0) {
      return res.status(404).json({
        message: "المتقدم غير موجود أو تم حذفه.",
      });
    }

    // تحديث الاسم ورقم الهاتف فقط
    // الرقم القومي وباقي البيانات لا يتم تغييرها
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("name", sql.NVarChar(200), name)
      .input("mobile", sql.NVarChar(20), mobile)
      .input("updatedBy", sql.Int, employeeCode)
      .query(`
        UPDATE dbo.recruitment_applicants
        SET
          name = @name,
          mobile = @mobile,
          updated_by = @updatedBy,
          updated_at = SYSDATETIME()
        OUTPUT
          INSERTED.id,
          INSERTED.name,
          INSERTED.national_id AS nationalId,
          INSERTED.mobile,
          INSERTED.application_date AS applicationDate,
          INSERTED.decision,
          INSERTED.reason,
          INSERTED.created_by AS createdBy,
          INSERTED.updated_by AS updatedBy,
          INSERTED.created_at AS createdAt,
          INSERTED.updated_at AS updatedAt,
          INSERTED.is_deleted AS isDeleted
        WHERE id = @id
          AND is_deleted = 0;
      `);

    return res.status(200).json({
      success: true,
      message: "تم تعديل الاسم ورقم التليفون بنجاح.",
      data: result.recordset[0],
    });
  } catch (error) {
    console.error(
      "Update recruitment applicant error:",
      error,
    );

    return res.status(400).json({
      message:
        error.message ||
        "حدث خطأ أثناء تعديل المتقدم.",
    });
  }
}


/* -------------------------------------------------------------------------- */
/* Soft Delete Applicant                                                      */
/* -------------------------------------------------------------------------- */

export async function deleteRecruitmentApplicant(req, res) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        message: "رقم المتقدم غير صحيح.",
      });
    }

    const employeeCode = getEmployeeCode(req);

    const pool = await securityPoolPromise;

    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input(
        "updatedBy",
        sql.Int,
        employeeCode,
      )
      .query(`
        UPDATE dbo.recruitment_applicants
        SET
          is_deleted = 1,
          updated_by = @updatedBy,
          updated_at = SYSDATETIME()
        WHERE id = @id
          AND is_deleted = 0;

        SELECT @@ROWCOUNT AS affectedRows;
      `);

    if (result.recordset[0].affectedRows === 0) {
      return res.status(404).json({
        message:
          "المتقدم غير موجود أو تم حذفه بالفعل.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "تم حذف المتقدم بنجاح.",
    });
  } catch (error) {
    console.error(
      "Delete recruitment applicant error:",
      error,
    );

    return res.status(500).json({
      message:
        error.message ||
        "حدث خطأ أثناء حذف المتقدم.",
    });
  }
}
