import { sql, retailPoolPromise } from "../config/db.js";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const VALID_STATUSES = ["سليم", "تحت المراجعة", "مرفوض", "غير محدد", "بلوك"];

const VALID_JOBS = ["عميل", "مندوب", "مندوبة", "منسق", "منسقة"];

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function clean(value) {
  if (value === undefined || value === null) return null;

  const result = String(value).trim();
  return result || null;
}

function normalizeArabic(value) {
  return String(value ?? "")
    .replace(/[\s\u0640]+/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .trim();
}

function validNationalId(value) {
  return /^\d{14}$/.test(clean(value) || "");
}

function parseDate(value) {
  const dateValue = clean(value);

  if (!dateValue) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

/**
 * Status priority:
 * ممنوع                  => بلوك
 * تم اخذ جزاء بسبب       => تحت المراجعة
 * لا مانع / لامانع       => سليم
 */
function getSecurityStatusFromNotes(notes, fallback = "غير محدد") {
  const value = normalizeArabic(notes);

  if (value.includes("ممنوع")) {
    return "بلوك";
  }

  if (value.includes("تمأخذجزاءبسبب")) {
    return "تحت المراجعة";
  }

  if (value.includes("لامانع")) {
    return "سليم";
  }

  return clean(fallback) || "غير محدد";
}

/**
 * الشخص يعتمد على ملاحظاته هو فقط.
 * ملاحظات الوقائع والتصاريح لا تؤثر على موقف الشخص.
 */
function getSecurityStatus(body) {
  return getSecurityStatusFromNotes(body?.notes, body?.security_status);
}

function validateBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "بيانات الطلب غير صحيحة.";
  }

  const name = clean(body.name);
  const nationalId = clean(body.national_id_number);
  const job = clean(body.job);
  const status = getSecurityStatus(body);

  const amount = clean(body.value_of_stolen_goods);
  const incidentDate = clean(body.incident_date);
  const permitDate = clean(body.permit_issue_date);

  if (!name) return "يرجى إدخال الاسم.";

  if (!validNationalId(nationalId)) {
    return "الرقم القومي يجب أن يتكون من 14 رقمًا.";
  }

  if (!VALID_JOBS.includes(job)) {
    return "الوظيفة غير صحيحة.";
  }

  if (!VALID_STATUSES.includes(status)) {
    return "الموقف الأمني غير صحيح.";
  }

  if (
    amount !== null &&
    (!Number.isFinite(Number(amount)) || Number(amount) < 0)
  ) {
    return "قيمة البضاعة غير صحيحة.";
  }

  if (incidentDate && !parseDate(incidentDate)) {
    return "تاريخ الواقعة غير صحيح. استخدم صيغة YYYY-MM-DD.";
  }

  if (permitDate && !parseDate(permitDate)) {
    return "تاريخ إصدار التصريح غير صحيح. استخدم صيغة YYYY-MM-DD.";
  }

  if (
    body.advertising_company !== undefined &&
    body.advertising_company !== null &&
    body.advertising_company !== "" &&
    (!/^\d+$/.test(String(body.advertising_company)) ||
      !Number.isSafeInteger(Number(body.advertising_company)))
  ) {
    return "رقم شركة الدعاية غير صحيح.";
  }

  return null;
}

/**
 * Validation خاص بتحديث بيانات الشخص فقط.
 * لا نتحقق من تواريخ الوقائع والتصاريح هنا لأنها لها endpoints مستقلة.
 */
function validatePersonBody(body, nationalId) {
  return validateBody({
    ...body,
    national_id_number: nationalId,
    incident_date: null,
    value_of_stolen_goods: null,
    permit_issue_date: null,
  });
}

function getPaginationValue(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return parsed;
}

function sendServerError(res, error, action) {
  console.error(`${action} error:`, error);

  return res.status(500).json({
    message: `تعذر ${action}.`,
  });
}

async function rollbackSafely(transaction) {
  if (!transaction) return;

  try {
    await transaction.rollback();
  } catch {
    // Transaction may already be rolled back or committed.
  }
}

/* -------------------------------------------------------------------------- */
/* SQL Binding                                                                */
/* -------------------------------------------------------------------------- */

function bindPerson(request, body) {
  request.input("name", sql.NVarChar(255), clean(body.name));

  request.input("nationalId", sql.NVarChar(50), clean(body.national_id_number));

  request.input("job", sql.NVarChar(100), clean(body.job));

  request.input("companyId", sql.NVarChar(100), clean(body.company_name));

  request.input(
    "companyDisplayName",
    sql.NVarChar(255),
    clean(body.company_display_name),
  );

  request.input(
    "advertisingCompanyId",
    sql.Int,
    clean(body.advertising_company) === null
      ? null
      : Number(body.advertising_company),
  );

  request.input(
    "advertisingCompanyName",
    sql.NVarChar(255),
    clean(body.advertising_company_name),
  );

  request.input("branch", sql.NVarChar(255), clean(body.branch));

  request.input("branchName", sql.NVarChar(255), clean(body.branch_name));

  request.input("governorate", sql.NVarChar(100), clean(body.governorate));

  request.input("fileType", sql.NVarChar(100), clean(body.file_type));

  request.input("securityStatus", sql.NVarChar(50), getSecurityStatus(body));

  request.input("notes", sql.NVarChar(sql.MAX), clean(body.notes));
}

function bindIncident(request, body) {
  const amount = clean(body.value_of_stolen_goods);

  request.input("stolenGoods", sql.NVarChar(sql.MAX), clean(body.stolen_goods));

  request.input(
    "stolenGoodsValue",
    sql.Decimal(18, 2),
    amount === null ? null : Number(amount),
  );

  request.input("incidentDate", sql.Date, parseDate(body.incident_date));

  request.input(
    "incidentBranch",
    sql.NVarChar(255),
    clean(body.incident_branch) || clean(body.branch),
  );

  request.input(
    "incidentNotes",
    sql.NVarChar(sql.MAX),
    clean(body.incident_notes) || clean(body.notes),
  );
}

function bindPermit(request, body) {
  request.input("permitNumber", sql.NVarChar(50), clean(body.permit_number));

  request.input(
    "permitCompanyName",
    sql.NVarChar(255),
    clean(body.permit_company_name) || clean(body.company_display_name),
  );

  request.input("permitIssueDate", sql.Date, parseDate(body.permit_issue_date));

  request.input(
    "permitBranch",
    sql.NVarChar(255),
    clean(body.permit_branch) || clean(body.branch),
  );

  request.input(
    "permitNotes",
    sql.NVarChar(sql.MAX),
    clean(body.permit_notes) || clean(body.notes),
  );
}

/* -------------------------------------------------------------------------- */
/* Record Helpers                                                             */
/* -------------------------------------------------------------------------- */

function hasIncidentData(body) {
  return Boolean(
    clean(body.stolen_goods) ||
    clean(body.value_of_stolen_goods) ||
    clean(body.incident_date) ||
    clean(body.incident_notes) ||
    clean(body.incident_branch),
  );
}

function hasPermitData(body) {
  return Boolean(
    clean(body.permit_number) ||
    clean(body.permit_company_name) ||
    clean(body.permit_issue_date) ||
    clean(body.permit_branch) ||
    clean(body.permit_notes),
  );
}

/* -------------------------------------------------------------------------- */
/* Coordinator Synchronization                                                */
/* -------------------------------------------------------------------------- */

/**
 * مهم:
 * هذه الدالة تستخدم retailPoolPromise لأن جداول المنسقين موجودة في retail.
 * لا تستخدم transaction الخاص بقاعدة الأمن هنا.
 *
 * يتم استدعاء الدالة بعد commit لمعاملة قاعدة الأمن.
 */
async function syncCoordinatorSecurityStatus(nationalId, securityStatus) {
  const normalizedNationalId = clean(nationalId);

  if (!normalizedNationalId) {
    throw new Error("National ID is required for security synchronization.");
  }

  const retailPool = await retailPoolPromise;

  if (!retailPool) {
    throw new Error("Retail database connection is unavailable.");
  }

  // Permanent coordinators
  const coordinatorResult = await retailPool
    .request()
    .input("nationalId", sql.VarChar(50), normalizedNationalId)
    .input("securityStatus", sql.NVarChar(50), securityStatus).query(`
      UPDATE dbo.coordinator
      SET security_situation = @securityStatus
      WHERE LTRIM(RTRIM(national_id_number)) = @nationalId;
    `);

  // Temporary coordinators
  const temporaryResult = await retailPool
    .request()
    .input("nationalId", sql.NVarChar(50), normalizedNationalId)
    .input("securityStatus", sql.NVarChar(50), securityStatus).query(`
      UPDATE dbo.temporary_coordinator
      SET security_situation = @securityStatus
      WHERE
        LTRIM(RTRIM(national_id_number)) = @nationalId
        AND isdeleted = 0;
    `);

  const synchronization = {
    nationalId: normalizedNationalId,
    securityStatus,
    coordinatorRows: coordinatorResult.rowsAffected,
    temporaryCoordinatorRows: temporaryResult.rowsAffected,
  };

  console.log("Security status synchronization:", synchronization);

  return synchronization;
}

/**
 * لا نلغي نجاح حفظ سجل الأمن إذا فشلت المزامنة في قاعدة retail.
 * نعيد تفاصيل الفشل حتى يمكن إعادة المحاولة ومعرفة سبب المشكلة.
 */
async function syncCoordinatorSecurityStatusSafely(nationalId, securityStatus) {
  try {
    const synchronization = await syncCoordinatorSecurityStatus(
      nationalId,
      securityStatus,
    );

    return {
      success: true,
      ...synchronization,
    };
  } catch (error) {
    console.error("Coordinator security synchronization failed:", {
      nationalId,
      securityStatus,
      error: error.message,
    });

    return {
      success: false,
      nationalId,
      securityStatus,
      message: error.message,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Status History                                                             */
/* -------------------------------------------------------------------------- */

async function saveStatusHistory(
  transaction,
  personId,
  oldStatus,
  newStatus,
  reason,
  changedBy,
) {
  if (oldStatus === newStatus) return;

  const request = new sql.Request(transaction);

  request.input("personId", sql.Int, personId);
  request.input("oldStatus", sql.NVarChar(50), oldStatus);
  request.input("newStatus", sql.NVarChar(50), newStatus);
  request.input("reason", sql.NVarChar(sql.MAX), clean(reason));

  request.input(
    "changedBy",
    sql.Int,
    changedBy == null ? null : Number(changedBy),
  );

  await request.query(`
    INSERT INTO dbo.security_status_history (
      security_person_id,
      old_status,
      new_status,
      reason,
      changed_by
    )
    VALUES (
      @personId,
      @oldStatus,
      @newStatus,
      @reason,
      @changedBy
    );
  `);
}

/* -------------------------------------------------------------------------- */
/* GET /security                                                              */
/* -------------------------------------------------------------------------- */



export async function getSecurityRecords(req, res) {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(
            100,
            Math.max(1, parseInt(req.query.limit, 10) || 25)
        );

        const offset = (page - 1) * limit;

        const search = clean(req.query.search);
        const job = clean(req.query.job);
        const status = clean(req.query.status);
        const fileType = clean(req.query.file_type);

        const pool = await retailPoolPromise;

        if (!pool) {
            return res.status(503).json({
                success: false,
                message: "Security database unavailable.",
            });
        }

        const request = pool.request();

        request.input(
            "search",
            sql.NVarChar(255),
            search ? `%${search}%` : null
        );

        request.input("job", sql.NVarChar(100), job || null);
        request.input("status", sql.NVarChar(50), status || null);
        request.input("fileType", sql.NVarChar(100), fileType || null);
        request.input("offset", sql.Int, offset);
        request.input("limit", sql.Int, limit);

        const query = `
            WITH SecurityRecords AS (

                /* ====================================================== */
                /* Incidents                                              */
                /* ====================================================== */

                SELECT
                    i.id,
                    p.id AS person_id,
                    p.name,
                    p.national_id_number,
                    p.job,
                    p.branch AS person_branch,
                    p.security_situation,

                    N'incident' AS record_type,
                    N'واقعة' AS record_type_name,
                    N'25' AS file_type,

                    i.branch AS incident_branch,
                    i.stolen_goods,
                    i.stolen_goods_value,
                    i.incident_date AS record_date,
                    i.notes,

                    p.company_display_name,
                    p.advertising_company_name,

                    CAST(NULL AS NVARCHAR(255)) AS permit_number,
                    CAST(NULL AS NVARCHAR(255)) AS permit_company_name,
                    CAST(NULL AS NVARCHAR(255)) AS permit_branch

                FROM dbo.security_incidents i
                INNER JOIN dbo.security_persons p
                    ON p.id = i.security_person_id

                WHERE ISNULL(p.is_deleted, 0) = 0

                UNION ALL

                /* ====================================================== */
                /* Permits                                                */
                /* ====================================================== */

                SELECT
                    pr.id,
                    p.id AS person_id,
                    p.name,
                    p.national_id_number,
                    p.job,
                    p.branch AS person_branch,
                    p.security_situation,

                    N'permit' AS record_type,
                    N'تصريح' AS record_type_name,
                    N'مناديب/ منسقين' AS file_type,

                    pr.branch AS incident_branch,
                    CAST(NULL AS NVARCHAR(MAX)) AS stolen_goods,
                    CAST(NULL AS DECIMAL(18, 2)) AS stolen_goods_value,
                    pr.issue_date AS record_date,
                    pr.notes,

                    p.company_display_name,
                    p.advertising_company_name,

                    pr.permit_number,
                    pr.company_name AS permit_company_name,
                    pr.branch AS permit_branch

                FROM dbo.security_permits pr
                INNER JOIN dbo.security_persons p
                    ON p.id = pr.security_person_id

                WHERE ISNULL(p.is_deleted, 0) = 0

                UNION ALL

                /* ====================================================== */
                /* Persons without incidents or permits                  */
                /* ====================================================== */

                SELECT
                    p.id,
                    p.id AS person_id,
                    p.name,
                    p.national_id_number,
                    p.job,
                    p.branch AS person_branch,
                    p.security_situation,

                    N'person' AS record_type,
                    N'شخص' AS record_type_name,
                    COALESCE(p.file_type, N'غير محدد') AS file_type,

                    CAST(NULL AS NVARCHAR(255)) AS incident_branch,
                    CAST(NULL AS NVARCHAR(MAX)) AS stolen_goods,
                    CAST(NULL AS DECIMAL(18, 2)) AS stolen_goods_value,
                    CAST(NULL AS DATE) AS record_date,
                    p.notes,

                    p.company_display_name,
                    p.advertising_company_name,

                    CAST(NULL AS NVARCHAR(255)) AS permit_number,
                    CAST(NULL AS NVARCHAR(255)) AS permit_company_name,
                    CAST(NULL AS NVARCHAR(255)) AS permit_branch

                FROM dbo.security_persons p

                WHERE
                    ISNULL(p.is_deleted, 0) = 0

                    AND NOT EXISTS (
                        SELECT 1
                        FROM dbo.security_incidents i
                        WHERE i.security_person_id = p.id
                    )

                    AND NOT EXISTS (
                        SELECT 1
                        FROM dbo.security_permits pr
                        WHERE pr.security_person_id = p.id
                    )
            ),

            FilteredRecords AS (
                SELECT *
                FROM SecurityRecords r
                WHERE

                    /* Job Filter */
                    (
                        @job IS NULL
                        OR LTRIM(RTRIM(ISNULL(r.job, N''))) =
                           LTRIM(RTRIM(@job))
                    )

                    /* Security Status Filter */
                    AND (
                        @status IS NULL
                        OR LTRIM(RTRIM(ISNULL(r.security_situation, N'غير محدد'))) =
                           LTRIM(RTRIM(@status))
                    )

                    /* File Type Filter */
                    AND (
                        @fileType IS NULL
                        OR REPLACE(
                            LTRIM(RTRIM(ISNULL(r.file_type, N''))),
                            N' ',
                            N''
                        ) =
                        REPLACE(
                            LTRIM(RTRIM(@fileType)),
                            N' ',
                            N''
                        )
                    )

                    /* Search Filter */
                    AND (
                        @search IS NULL
                        OR ISNULL(r.name, N'') LIKE @search
                        OR ISNULL(r.national_id_number, N'') LIKE @search
                        OR CONVERT(NVARCHAR(20), r.person_id) LIKE @search
                        OR CONVERT(NVARCHAR(20), r.id) LIKE @search
                        OR ISNULL(r.notes, N'') LIKE @search
                        OR ISNULL(r.person_branch, N'') LIKE @search
                        OR ISNULL(r.incident_branch, N'') LIKE @search
                        OR ISNULL(r.company_display_name, N'') LIKE @search
                        OR ISNULL(r.advertising_company_name, N'') LIKE @search
                        OR ISNULL(r.permit_company_name, N'') LIKE @search
                        OR ISNULL(r.permit_number, N'') LIKE @search
                        OR ISNULL(r.stolen_goods, N'') LIKE @search
                        OR ISNULL(r.file_type, N'') LIKE @search
                    )
            )

            SELECT
                *,
                COUNT(*) OVER() AS total_count
            FROM FilteredRecords
            ORDER BY record_date DESC, id DESC
            OFFSET @offset ROWS
            FETCH NEXT @limit ROWS ONLY;
        `;

        const result = await request.query(query);

        const records = result.recordset || [];

        const total = records.length
            ? Number(records[0].total_count)
            : 0;

        return res.status(200).json({
            success: true,
            records,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });

    } catch (error) {
        console.error("getSecurityRecords error:", error);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء تحميل سجلات الأمن.",
            error: error.message,
        });
    }
}



/* -------------------------------------------------------------------------- */
/* GET /security/national-id/:nationalId                                      */
/* -------------------------------------------------------------------------- */

export async function getSecurityByNationalId(req, res) {
  try {
    const nationalId = clean(req.params.nationalId);

    if (!validNationalId(nationalId)) {
      return res.status(400).json({
        message: "الرقم القومي يجب أن يتكون من 14 رقمًا.",
      });
    }

    const pool = await retailPoolPromise;
    const request = pool.request();

    request.input("nationalId", sql.NVarChar(50), nationalId);

    const result = await request.query(`
      /* Person */

      SELECT
        p.*,
        CASE
          WHEN ISNULL(p.notes, N'') LIKE N'%ممنوع%'
            THEN N'بلوك'
          WHEN REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(p.notes, N''), N' ', N''), NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N'') LIKE N'%تمأخذجزاءبسبب%'
            THEN N'تحت المراجعة'
          WHEN REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(p.notes, N''), N' ', N''), NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N'') LIKE N'%لامانع%'
            THEN N'سليم'
          ELSE ISNULL(NULLIF(p.security_situation, N''), N'غير محدد')
        END AS security_status
      FROM dbo.security_persons p
      WHERE
        p.national_id_number = @nationalId
        AND p.is_deleted = 0;

      /* Incidents */

      SELECT
        i.id,
        i.security_person_id,
        i.branch,
        i.stolen_goods,
        i.stolen_goods_value,
        i.incident_date,
        i.notes,

        CASE
          WHEN ISNULL(i.notes, N'') LIKE N'%ممنوع%'
            THEN N'بلوك'
          WHEN REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(i.notes, N''), N' ', N''), NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N'') LIKE N'%تمأخذجزاءبسبب%'
            THEN N'تحت المراجعة'
          WHEN REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(i.notes, N''), N' ', N''), NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N'') LIKE N'%لامانع%'
            THEN N'سليم'
          ELSE ISNULL(NULLIF(p.security_situation, N''), N'غير محدد')
        END AS security_status,

        N'25' AS file_type,
        N'incident' AS record_type

      FROM dbo.security_incidents i
      INNER JOIN dbo.security_persons p
        ON p.id = i.security_person_id
      WHERE
        p.national_id_number = @nationalId
        AND p.is_deleted = 0
      ORDER BY i.id DESC;

      /* Permits */

      SELECT
        pm.id,
        pm.security_person_id,
        pm.permit_number,
        pm.company_name,
        pm.issue_date,
        pm.branch,
        pm.notes,

        CASE
          WHEN ISNULL(pm.notes, N'') LIKE N'%ممنوع%'
            THEN N'بلوك'
          WHEN REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(pm.notes, N''), N' ', N''), NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N'') LIKE N'%تمأخذجزاءبسبب%'
            THEN N'تحت المراجعة'
          WHEN REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(pm.notes, N''), N' ', N''), NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N'') LIKE N'%لامانع%'
            THEN N'سليم'
          ELSE ISNULL(NULLIF(p.security_situation, N''), N'غير محدد')
        END AS security_status,

        N'مناديب/ منسقين' AS file_type,
        N'permit' AS record_type

      FROM dbo.security_permits pm
      INNER JOIN dbo.security_persons p
        ON p.id = pm.security_person_id
      WHERE
        p.national_id_number = @nationalId
        AND p.is_deleted = 0
      ORDER BY pm.id DESC;
    `);

    const person = result.recordsets?.[0]?.[0];

    if (!person) {
      return res.status(404).json({
        message: "لا يوجد سجل نشط بهذا الرقم القومي.",
      });
    }

    return res.json({
      record: {
        ...person,
        incidents: result.recordsets?.[1] || [],
        permits: result.recordsets?.[2] || [],
      },
    });
  } catch (error) {
    return sendServerError(res, error, "البحث عن السجل");
  }
}

/* -------------------------------------------------------------------------- */
/* POST /security                                                             */
/* -------------------------------------------------------------------------- */

export async function createSecurityRecord(req, res) {
  const validationError = validateBody(req.body);

  if (validationError) {
    return res.status(400).json({
      message: validationError,
    });
  }

  let transaction;

  try {
    const pool = await retailPoolPromise;

    transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    const nationalId = clean(req.body.national_id_number);
    const securityStatus = getSecurityStatus(req.body);

    const duplicate = await new sql.Request(transaction).input(
      "nationalId",
      sql.NVarChar(50),
      nationalId,
    ).query(`
        SELECT TOP 1 id, is_deleted
        FROM dbo.security_persons WITH (UPDLOCK, HOLDLOCK)
        WHERE national_id_number = @nationalId;
      `);

    if (duplicate.recordset.length) {
      await transaction.rollback();

      return res.status(409).json({
        message: duplicate.recordset[0].is_deleted
          ? "هذا الرقم القومي مسجل في سجل محذوف. لا يمكن إضافته مرة أخرى."
          : "يوجد سجل مسجل بالفعل بهذا الرقم القومي.",
      });
    }

    const personRequest = new sql.Request(transaction);
    bindPerson(personRequest, req.body);

    const personResult = await personRequest.query(`
      INSERT INTO dbo.security_persons (
        name,
        national_id_number,
        job,
        company_id,
        company_display_name,
        advertising_company_id,
        advertising_company_name,
        branch,
        branch_name,
        governorate,
        file_type,
        security_situation,
        notes,
        is_deleted
      )
      OUTPUT INSERTED.id
      VALUES (
        @name,
        @nationalId,
        @job,
        @companyId,
        @companyDisplayName,
        @advertisingCompanyId,
        @advertisingCompanyName,
        @branch,
        @branchName,
        @governorate,
        @fileType,
        @securityStatus,
        @notes,
        0
      );
    `);

    const personId = personResult.recordset[0].id;

    /* Create initial incident, if provided */

    if (hasIncidentData(req.body)) {
      const incidentRequest = new sql.Request(transaction);

      bindIncident(incidentRequest, req.body);
      incidentRequest.input("personId", sql.Int, personId);

      await incidentRequest.query(`
        INSERT INTO dbo.security_incidents (
          security_person_id,
          branch,
          stolen_goods,
          stolen_goods_value,
          incident_date,
          notes
        )
        VALUES (
          @personId,
          @incidentBranch,
          @stolenGoods,
          @stolenGoodsValue,
          @incidentDate,
          @incidentNotes
        );
      `);
    }

    /* Create initial permit, if provided */

    if (hasPermitData(req.body)) {
      const permitRequest = new sql.Request(transaction);

      bindPermit(permitRequest, req.body);
      permitRequest.input("personId", sql.Int, personId);

      await permitRequest.query(`
        INSERT INTO dbo.security_permits (
          security_person_id,
          permit_number,
          company_name,
          issue_date,
          branch,
          notes
        )
        VALUES (
          @personId,
          @permitNumber,
          @permitCompanyName,
          @permitIssueDate,
          @permitBranch,
          @permitNotes
        );
      `);
    }

    // Save the security record first.
    await transaction.commit();

    // Then synchronize coordinator tables in the retail database.
    const synchronization = await syncCoordinatorSecurityStatusSafely(
      nationalId,
      securityStatus,
    );

    return res.status(201).json({
      message: "تمت إضافة السجل بنجاح.",
      id: personId,
      security_status: securityStatus,
      synchronization,
    });
  } catch (error) {
    await rollbackSafely(transaction);

    if (error.number === 2601 || error.number === 2627) {
      return res.status(409).json({
        message: "الرقم القومي مسجل بالفعل.",
      });
    }

    return sendServerError(res, error, "إضافة السجل");
  }
}

/* -------------------------------------------------------------------------- */
/* PUT /security/national-id/:nationalId                                      */
/* Update person ONLY                                                         */
/* -------------------------------------------------------------------------- */

export async function updateSecurityRecord(req, res) {
  const nationalId = clean(req.params.nationalId);

  if (!validNationalId(nationalId)) {
    return res.status(400).json({
      message: "الرقم القومي غير صحيح.",
    });
  }

  const validationError = validatePersonBody(req.body, nationalId);

  if (validationError) {
    return res.status(400).json({
      message: validationError,
    });
  }

  let transaction;

  try {
    const pool = await retailPoolPromise;

    transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    const securityStatus = getSecurityStatus(req.body);

    const existing = await new sql.Request(transaction).input(
      "nationalId",
      sql.NVarChar(50),
      nationalId,
    ).query(`
        SELECT TOP 1
          id,
          security_situation
        FROM dbo.security_persons WITH (UPDLOCK, HOLDLOCK)
        WHERE
          national_id_number = @nationalId
          AND is_deleted = 0;
      `);

    if (!existing.recordset.length) {
      await transaction.rollback();

      return res.status(404).json({
        message: "السجل المطلوب غير موجود أو سبق حذفه.",
      });
    }

    const person = existing.recordset[0];
    const oldStatus = person.security_situation || "غير محدد";

    const updateRequest = new sql.Request(transaction);

    bindPerson(updateRequest, {
      ...req.body,
      national_id_number: nationalId,
    });

    updateRequest.input("personId", sql.Int, person.id);

    await updateRequest.query(`
      UPDATE dbo.security_persons
      SET
        name = @name,
        job = @job,
        company_id = @companyId,
        company_display_name = @companyDisplayName,
        advertising_company_id = @advertisingCompanyId,
        advertising_company_name = @advertisingCompanyName,
        branch = @branch,
        branch_name = @branchName,
        governorate = @governorate,
        file_type = @fileType,
        security_situation = @securityStatus,
        notes = @notes,
        updated_at = SYSDATETIME()
      WHERE
        id = @personId
        AND is_deleted = 0;
    `);

    /* Save person status history */

    await saveStatusHistory(
      transaction,
      person.id,
      oldStatus,
      securityStatus,
      req.body.notes,
      req.user?.id,
    );

    /*
      IMPORTANT:
      No incident INSERT or UPDATE here.
      Incidents are updated only through:
      PUT /security/incidents/:incidentId
    */

    /*
      IMPORTANT:
      No permit INSERT or UPDATE here.
      Permits are updated only through:
      PUT /security/permits/:permitId
    */

    // Save the security update first.
    await transaction.commit();

    // Then synchronize coordinator tables in the retail database.
    const synchronization = await syncCoordinatorSecurityStatusSafely(
      nationalId,
      securityStatus,
    );

    return res.json({
      message: "تم تحديث بيانات الشخص بنجاح.",
      security_status: securityStatus,
      synchronization,
    });
  } catch (error) {
    await rollbackSafely(transaction);
    return sendServerError(res, error, "تحديث بيانات الشخص");
  }
}

/* -------------------------------------------------------------------------- */
/* PUT /security/incidents/:incidentId                                        */
/* -------------------------------------------------------------------------- */

export async function updateSecurityIncident(req, res) {
  const incidentId = Number(req.params.incidentId);

  if (!Number.isSafeInteger(incidentId) || incidentId <= 0) {
    return res.status(400).json({
      message: "رقم الواقعة غير صحيح.",
    });
  }

  const amount = clean(req.body?.value_of_stolen_goods);
  const incidentDate = clean(req.body?.incident_date);

  if (
    amount !== null &&
    (!Number.isFinite(Number(amount)) || Number(amount) < 0)
  ) {
    return res.status(400).json({
      message: "قيمة البضاعة غير صحيحة.",
    });
  }

  if (incidentDate && !parseDate(incidentDate)) {
    return res.status(400).json({
      message: "تاريخ الواقعة غير صحيح.",
    });
  }

  let transaction;

  try {
    const pool = await retailPoolPromise;

    transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    const existing = await new sql.Request(transaction).input(
      "incidentId",
      sql.Int,
      incidentId,
    ).query(`
        SELECT
          i.id,
          i.security_person_id
        FROM dbo.security_incidents i WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN dbo.security_persons p
          ON p.id = i.security_person_id
        WHERE
          i.id = @incidentId
          AND p.is_deleted = 0;
      `);

    if (!existing.recordset.length) {
      await transaction.rollback();

      return res.status(404).json({
        message: "الواقعة غير موجودة أو الشخص المرتبط بها معطل.",
      });
    }

    const personId = existing.recordset[0].security_person_id;

    const updateRequest = new sql.Request(transaction);

    bindIncident(updateRequest, {
      ...req.body,
      incident_notes: req.body?.incident_notes ?? req.body?.notes,
    });

    updateRequest.input("incidentId", sql.Int, incidentId);
    updateRequest.input("personId", sql.Int, personId);

    await updateRequest.query(`
      UPDATE dbo.security_incidents
      SET
        branch = @incidentBranch,
        stolen_goods = @stolenGoods,
        stolen_goods_value = @stolenGoodsValue,
        incident_date = @incidentDate,
        notes = @incidentNotes
      WHERE
        id = @incidentId
        AND security_person_id = @personId;
    `);

    await transaction.commit();

    return res.json({
      message: "تم تعديل الواقعة بنجاح.",
      incident_id: incidentId,
    });
  } catch (error) {
    await rollbackSafely(transaction);
    return sendServerError(res, error, "تعديل الواقعة");
  }
}

/* -------------------------------------------------------------------------- */
/* PUT /security/permits/:permitId                                            */
/* -------------------------------------------------------------------------- */

export async function updateSecurityPermit(req, res) {
  const permitId = Number(req.params.permitId);

  if (!Number.isSafeInteger(permitId) || permitId <= 0) {
    return res.status(400).json({
      message: "رقم التصريح غير صحيح.",
    });
  }

  const permitDate = clean(req.body?.permit_issue_date);

  if (permitDate && !parseDate(permitDate)) {
    return res.status(400).json({
      message: "تاريخ إصدار التصريح غير صحيح.",
    });
  }

  let transaction;

  try {
    const pool = await retailPoolPromise;

    transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    const existing = await new sql.Request(transaction).input(
      "permitId",
      sql.Int,
      permitId,
    ).query(`
        SELECT
          pm.id,
          pm.security_person_id
        FROM dbo.security_permits pm WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN dbo.security_persons p
          ON p.id = pm.security_person_id
        WHERE
          pm.id = @permitId
          AND p.is_deleted = 0;
      `);

    if (!existing.recordset.length) {
      await transaction.rollback();

      return res.status(404).json({
        message: "التصريح غير موجود أو الشخص المرتبط به معطل.",
      });
    }

    const personId = existing.recordset[0].security_person_id;

    const updateRequest = new sql.Request(transaction);

    bindPermit(updateRequest, {
      ...req.body,
      permit_notes: req.body?.permit_notes ?? req.body?.notes,
    });

    updateRequest.input("permitId", sql.Int, permitId);
    updateRequest.input("personId", sql.Int, personId);

    await updateRequest.query(`
      UPDATE dbo.security_permits
      SET
        permit_number = @permitNumber,
        company_name = @permitCompanyName,
        issue_date = @permitIssueDate,
        branch = @permitBranch,
        notes = @permitNotes
      WHERE
        id = @permitId
        AND security_person_id = @personId;
    `);

    await transaction.commit();

    return res.json({
      message: "تم تعديل التصريح بنجاح.",
      permit_id: permitId,
    });
  } catch (error) {
    await rollbackSafely(transaction);
    return sendServerError(res, error, "تعديل التصريح");
  }
}

/* -------------------------------------------------------------------------- */
/* DELETE /security/national-id/:nationalId                                   */
/* -------------------------------------------------------------------------- */

export async function deleteSecurityRecord(req, res) {
  const nationalId = clean(req.params.nationalId);

  if (!validNationalId(nationalId)) {
    return res.status(400).json({
      message: "الرقم القومي يجب أن يتكون من 14 رقمًا.",
    });
  }

  let transaction;

  try {
    const pool = await retailPoolPromise;

    transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    const findResult = await new sql.Request(transaction).input(
      "nationalId",
      sql.NVarChar(50),
      nationalId,
    ).query(`
        SELECT TOP 1
          id,
          name,
          national_id_number
        FROM dbo.security_persons WITH (UPDLOCK, HOLDLOCK)
        WHERE
          national_id_number = @nationalId
          AND is_deleted = 0;
      `);

    if (!findResult.recordset.length) {
      await transaction.rollback();

      return res.status(404).json({
        message: "السجل غير موجود أو سبق حذفه.",
      });
    }

    const person = findResult.recordset[0];

    await new sql.Request(transaction).input("personId", sql.Int, person.id)
      .query(`
        UPDATE dbo.security_persons
        SET
          is_deleted = 1,
          updated_at = SYSDATETIME()
        WHERE
          id = @personId
          AND is_deleted = 0;
      `);

    await transaction.commit();

    return res.json({
      message: "تم حذف السجل بنجاح.",
      deleted: {
        id: person.id,
        name: person.name,
        national_id_number: person.national_id_number,
      },
    });
  } catch (error) {
    await rollbackSafely(transaction);
    return sendServerError(res, error, "حذف السجل");
  }
}
