const express = require('express');
const multer = require('multer');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  pool, DATA_DIR, databasePath, quoteIdentifier, tableExists, getTableColumns, transaction
} = require('../database');
const {
  ImportError, parseScanFile, parseParticipantsFile, parseNewParticipantsFile, parseOOFile
} = require('./parsing');

const router = express.Router();
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });

const storage = multer.diskStorage({
  destination(req, file, callback) {
    callback(null, UPLOAD_DIR);
  },
  filename(req, file, callback) {
    callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 10, parts: 12 },
  fileFilter(req, file, callback) {
    const allowed = new Set(['.xlsx', '.xls', '.csv']);
    if (!allowed.has(path.extname(file.originalname).toLowerCase())) {
      return callback(new ImportError('Допускаются только файлы XLSX, XLS и CSV.', 415));
    }
    callback(null, true);
  }
});

function receiveUpload(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      error.status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      error.message = error.code === 'LIMIT_FILE_SIZE'
        ? 'Файл превышает лимит 20 МБ.' : 'Загрузите один файл в поле «file».';
    }
    next(error);
  });
}

function importHandler(parser) {
  return async (req, res, next) => {
    try {
      if (!req.file) throw new ImportError('Выберите файл для загрузки.', 400);
      const result = await parser(req.file.path);
      res.json(result);
    } catch (error) {
      next(error);
    } finally {
      if (req.file) {
        try {
          // Only the temporary uploaded file is removed. Persistent data and
          // the data directory are never cleared by this lifecycle operation.
          await fs.promises.unlink(req.file.path);
        } catch (error) {
          if (error.code !== 'ENOENT') console.error('Не удалось удалить временный файл импорта:', error.message);
        }
      }
    }
  };
}

async function listTables(prefix) {
  try {
    const result = await pool.query(`SELECT name AS table_name FROM sqlite_master
      WHERE type = 'table' AND substr(name, 1, $1) = $2 ORDER BY name`, [prefix.length + 1, `${prefix}_`]);
    return result.rows.map((row) => row.table_name);
  } catch (error) {
    throw error;
  }
}

async function requireImportTable(tableName, prefix) {
  try {
    if (typeof tableName !== 'string' || !tableName.startsWith(`${prefix}_`) || !/^[\p{L}\p{N}_]+$/u.test(tableName)) {
      throw new ImportError('Недопустимое имя таблицы импорта.', 400);
    }
    if (!(await tableExists(tableName))) throw new ImportError('Таблица импорта не найдена.', 404);
    return quoteIdentifier(tableName);
  } catch (error) {
    throw error;
  }
}

function searchCondition(column, parameter) {
  return `lower_ru(COALESCE(${quoteIdentifier(column)}, '')) LIKE lower_ru($${parameter}) ESCAPE '\\'`;
}

function searchPattern(value) {
  if (typeof value !== 'string' || value.length > 200) {
    throw new ImportError('Поисковая строка должна быть не длиннее 200 символов.', 400);
  }
  // Search treats SQL wildcard characters as text, so filenames and codes
  // containing underscores are filtered as users expect.
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

function integerParameter(value, fallback, minimum, maximum) {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new ImportError('Некорректные параметры страницы.', 400);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new ImportError(`Параметр страницы должен быть от ${minimum} до ${maximum}.`, 400);
  }
  return number;
}

router.get('/', (req, res) => {
  res.render('import', { pageTitle: 'Импорт данных', activePage: 'import' });
});

for (const legacyPage of ['/scan', '/scan/load', '/participants', '/participants/load', '/participants/new/load', '/oo/load']) {
  router.get(legacyPage, (req, res) => res.redirect('/import'));
}

router.post('/scan/load', receiveUpload, importHandler(parseScanFile));
router.post('/participants/load', receiveUpload, importHandler(parseParticipantsFile));
router.post('/participants/new/load', receiveUpload, importHandler(parseNewParticipantsFile));
router.post('/oo/load', receiveUpload, importHandler(parseOOFile));

router.get('/scan/api/stats', async (req, res, next) => {
  try {
    const stats = [];
    for (const tableName of await listTables('scan')) {
      const result = await pool.query(`SELECT COUNT(*) AS count, MAX(created_at) AS last_update FROM ${quoteIdentifier(tableName)}`);
      stats.push({ tableName, recordCount: Number(result.rows[0].count), lastUpdate: result.rows[0].last_update });
    }
    stats.sort((a, b) => b.recordCount - a.recordCount);
    res.json({ stats });
  } catch (error) {
    next(error);
  }
});

router.get('/scan/api/data', async (req, res, next) => {
  try {
    const pattern = searchPattern(req.query.filter || '');
    const names = req.query.table ? [req.query.table] : await listTables('scan');
    const tables = [];
    for (const tableName of names) {
      const identifier = await requireImportTable(tableName, 'scan');
      const columns = (await getTableColumns(tableName)).map((column) => column.name).filter((column) => column !== 'id');
      const conditions = columns.map((column) => searchCondition(column, 1));
      const result = await pool.query(`SELECT * FROM ${identifier} WHERE ${conditions.join(' OR ')} ORDER BY id DESC LIMIT 1000`, [pattern]);
      tables.push({ tableName, data: result.rows });
    }
    res.json({ tables });
  } catch (error) {
    next(error);
  }
});

router.get('/participants/api/tables', async (req, res, next) => {
  try {
    const tables = [];
    for (const name of await listTables('participants')) {
      const count = await pool.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`);
      tables.push({ name, rowCount: Number(count.rows[0].count) });
    }
    res.json({ tables });
  } catch (error) {
    next(error);
  }
});

router.get('/participants/api/table/:name', async (req, res, next) => {
  try {
    const identifier = await requireImportTable(req.params.name, 'participants');
    const columns = new Set((await getTableColumns(req.params.name)).map((column) => column.name));
    const params = [];
    const conditions = [];
    for (const [column, value] of Object.entries(req.query)) {
      if (column === 'limit' || column === 'offset' || value === '') continue;
      if (!columns.has(column)) throw new ImportError('Неизвестный столбец фильтра.', 400);
      params.push(searchPattern(value));
      conditions.push(searchCondition(column, params.length));
    }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const limit = integerParameter(req.query.limit, 100, 1, 1000);
    const offset = integerParameter(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const total = await pool.query(`SELECT COUNT(*) AS total FROM ${identifier}${where}`, params);
    const data = await pool.query(`SELECT * FROM ${identifier}${where} ORDER BY id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);
    res.json({ data: data.rows, total: Number(total.rows[0].total), limit, offset });
  } catch (error) {
    next(error);
  }
});

router.post('/participants/api/import-students', async (req, res, next) => {
  try {
    const { table, subject: requestedSubject } = req.body || {};
    const identifier = await requireImportTable(table, 'participants');
    if (requestedSubject !== undefined && (typeof requestedSubject !== 'string' || requestedSubject.trim().length > 100)) {
      throw new ImportError('Название предмета должно быть не длиннее 100 символов.', 400);
    }
    const overrideSubject = requestedSubject?.trim() || '';
    const source = await pool.query(`SELECT * FROM ${identifier} ORDER BY id`);
    const students = [];
    const skippedRows = [];
    const codeIdentities = new Map();
    for (const row of source.rows) {
      const surname = String(row.surname || '').trim();
      const name = String(row.name || '').trim();
      const patronymic = String(row.patronymic || '').trim();
      const parallel = String(row.parallel || row.class || '').trim();
      const subject = overrideSubject || String(row.subject || '').trim();
      const schoolCode = String(row.school_code || '').trim();
      const schoolName = String(row.school_name || '').trim();
      const participantCode = String(row.participant_code || row.work_code || '').trim();
      if (!surname || !name || !parallel || !subject) {
        skippedRows.push({ id: row.id, reason: 'Нужны фамилия, имя, класс и предмет. При необходимости укажите предмет в форме.' });
        continue;
      }
      if (surname.length > 100 || name.length > 100 || patronymic.length > 100 || parallel.length > 10 || subject.length > 100
          || schoolCode.length > 50 || participantCode.length > 50 || schoolName.length > 500) {
        skippedRows.push({ id: row.id, reason: 'Имя, класс, предмет, код или наименование школы превышают допустимую длину.' });
        continue;
      }
      if (participantCode) {
        const codeKey = JSON.stringify([subject, participantCode]);
        const personKey = JSON.stringify([surname, name, patronymic, parallel, schoolCode]);
        if (codeIdentities.has(codeKey)) {
          if (codeIdentities.get(codeKey) !== personKey) {
            throw new ImportError('В таблице один код участника для одного предмета указан у разных учеников. Исправьте повторяющиеся коды и повторите импорт.');
          }
          skippedRows.push({ id: row.id, reason: 'Повторная строка с тем же кодом участника и предметом.' });
          continue;
        }
        codeIdentities.set(codeKey, personKey);
      }
      students.push({ surname, name, patronymic, parallel, subject, schoolCode, schoolName, participantCode });
    }
    if (!students.length) {
      throw new ImportError(`Нет подходящих учеников. ${skippedRows[0]?.reason || 'В выбранной таблице нет строк данных.'}`);
    }
    let inserted = 0;
    let updated = 0;
    const subjects = [...new Set(students.map((student) => student.subject))];
    await transaction(async (tx) => {
      try {
        for (const subject of subjects) {
          await tx.query('INSERT INTO id_subject (subject) VALUES ($1) ON CONFLICT(subject) DO NOTHING', [subject]);
        }
        for (const student of students) {
          let identity = student.participantCode
            ? await tx.query('SELECT id FROM Ученики WHERE participant_code = $1 AND предмет = $2 ORDER BY id LIMIT 2', [student.participantCode, student.subject])
            : { rows: [] };
          if (!identity.rows.length) {
            // A later file can add a work code to a learner imported in the old
            // format. Match only records without a code in that case, so two
            // namesakes with different participant codes remain distinct.
            const noExistingCode = student.participantCode ? " AND COALESCE(participant_code, '') = ''" : '';
            identity = await tx.query(`SELECT id FROM Ученики WHERE фимилия = $1 AND имя = $2 AND COALESCE(отчество, '') = $3
              AND паралель = $4 AND COALESCE(school_code, '') = $5 AND предмет = $6${noExistingCode} ORDER BY id LIMIT 2`,
              [student.surname, student.name, student.patronymic, student.parallel, student.schoolCode, student.subject]);
          }
          if (identity.rows.length > 1) {
            skippedRows.push({ name: `${student.surname} ${student.name}`, reason: 'Найдено несколько участников с одним кодом или одинаковыми данными. Проверьте уникальность кода участника.' });
            continue;
          }
          const school = student.schoolCode
            ? (await tx.query('SELECT number_oo, name_oo, full_name FROM oo WHERE code_oo = $1 ORDER BY id LIMIT 1', [student.schoolCode])).rows[0]
            : undefined;
          const values = [student.surname, student.name, student.patronymic, student.parallel, student.subject,
            student.schoolCode, school?.full_name || student.schoolName, school?.number_oo || '', school?.name_oo || '', student.participantCode];
          if (identity.rows.length) {
            await tx.query(`UPDATE Ученики SET фимилия = $1, имя = $2, отчество = $3, паралель = $4, предмет = $5,
              school_code = COALESCE(NULLIF($6, ''), school_code), school_name = COALESCE(NULLIF($7, ''), school_name),
              school_number_oo = COALESCE(NULLIF($8, ''), school_number_oo), school_name_oo = COALESCE(NULLIF($9, ''), school_name_oo),
              participant_code = COALESCE(NULLIF($10, ''), participant_code), дата_последнего_изменения = CURRENT_TIMESTAMP WHERE id = $11`, [...values, identity.rows[0].id]);
            updated++;
          } else {
            await tx.query(`INSERT INTO Ученики (фимилия, имя, отчество, паралель, предмет,
              school_code, school_name, school_number_oo, school_name_oo, participant_code)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, values);
            inserted++;
          }
        }
      } catch (error) {
        throw error;
      }
    });
    res.json({ success: true, inserted, updated, skipped: skippedRows.length, skippedRows: skippedRows.slice(0, 100), subjects,
      message: `Добавлено ${inserted}, обновлено ${updated}, пропущено ${skippedRows.length}. Существующая рассадка сохранена.` });
  } catch (error) {
    next(error);
  }
});

router.get('/oo/api/data', async (req, res, next) => {
  try {
    const pattern = searchPattern(req.query.filter || '');
    const conditions = ['code_omsu', 'code_oo', 'number_oo', 'name_oo', 'full_name'].map((column) => searchCondition(column, 1));
    const result = await pool.query(`SELECT * FROM oo WHERE ${conditions.join(' OR ')} ORDER BY name_oo LIMIT 1000`, [pattern]);
    res.json({ success: true, data: result.rows, total: result.rows.length });
  } catch (error) {
    next(error);
  }
});

router.get('/oo/api/stats', async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT COUNT(*) AS total, COUNT(DISTINCT NULLIF(code_oo, '')) AS unique_oo,
      COUNT(DISTINCT NULLIF(code_omsu, '')) AS unique_omsu FROM oo`);
    res.json({ success: true, stats: { totalRecords: Number(result.rows[0].total),
      uniqueOO: Number(result.rows[0].unique_oo), uniqueOMSU: Number(result.rows[0].unique_omsu) } });
  } catch (error) {
    next(error);
  }
});

router.get('/api/db-info', async (req, res, next) => {
  try {
    const scanTables = await listTables('scan');
    const participantTables = await listTables('participants');
    let scanRecords = 0;
    let participantsRecords = 0;
    for (const name of scanTables) {
      scanRecords += Number((await pool.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`)).rows[0].count);
    }
    for (const name of participantTables) {
      participantsRecords += Number((await pool.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`)).rows[0].count);
    }
    const info = await fs.promises.stat(databasePath);
    res.json({ path: './data/exam.sqlite', exists: true, size: info.size,
      tablesCount: scanTables.length + participantTables.length, scanRecords, participantsRecords });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
