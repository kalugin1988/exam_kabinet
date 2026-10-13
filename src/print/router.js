const express = require('express');
const { pool } = require('../database');

const router = express.Router();
const DEFAULT_SCHOOL_NAME = 'МАОУ-СОШ № 25 имени В. Г. Феофанова';
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

function stringInput(value, label, maxLength, required = true) {
  if (value === undefined || value === '') {
    if (required) throw httpError(400, `Заполните поле «${label}».`);
    return '';
  }
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw httpError(400, `Некорректное значение поля «${label}».`);
  }
  return value.trim();
}

function formParameters(query, requireClassroom = false) {
  const subject = stringInput(query.subject, 'Предмет', 100);
  const exam_date = stringInput(query.exam_date, 'Дата проведения', 10);
  const site_code = stringInput(query.site_code, 'Код площадки', 50);
  const school_name = stringInput(query.school_name, 'Название площадки', 500, false) || DEFAULT_SCHOOL_NAME;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exam_date)) {
    throw httpError(400, 'Дата проведения должна быть в формате ГГГГ-ММ-ДД.');
  }
  const date = new Date(`${exam_date}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== exam_date) {
    throw httpError(400, 'Укажите существующую дату проведения.');
  }
  if (query.all_classrooms !== undefined && !['true', 'false'].includes(query.all_classrooms)) {
    throw httpError(400, 'Некорректный режим выбора аудиторий.');
  }
  const all_classrooms = query.all_classrooms === 'true';
  const classroom = stringInput(query.classroom, 'Аудитория', 10, requireClassroom && !all_classrooms);
  if (classroom && (!/^\d+$/.test(classroom) || !Number.isSafeInteger(Number(classroom)) || Number(classroom) < 1)) {
    throw httpError(400, 'Номер аудитории должен быть положительным целым числом.');
  }
  return {
    subject, exam_date, site_code, school_name, classroom, all_classrooms,
    exam_day: date.getUTCDate(),
    exam_month: MONTHS[date.getUTCMonth()],
    exam_year: date.getUTCFullYear()
  };
}

function fullName(student) {
  return [student.last_name, student.first_name, student.middle_name].filter(Boolean).join(' ');
}

function padRows(rows, emptyRow, minimum = 15) {
  while (rows.length < minimum) rows.push({ ...emptyRow });
  return rows;
}

async function getOptions() {
  try {
    const classrooms = await pool.query(`
      SELECT DISTINCT "номер_кабинета" FROM "Ученики"
      WHERE "номер_кабинета" IS NOT NULL ORDER BY "номер_кабинета"
    `);
    const subjects = await pool.query(`
      SELECT DISTINCT "предмет" FROM "Ученики"
      WHERE "предмет" IS NOT NULL AND "предмет" <> '' ORDER BY "предмет"
    `);
    return { classrooms: classrooms.rows, subjects: subjects.rows };
  } catch (error) {
    throw error;
  }
}

async function getStudents(subject, classroom) {
  try {
    const result = await pool.query(`
      SELECT "фимилия" AS "last_name", "имя" AS "first_name",
        "отчество" AS "middle_name", "номер_места" AS "workplace",
        "паралель" AS "parallel", "номер_кабинета" AS "classroom",
        COALESCE(NULLIF("school_name_oo", ''), NULLIF("school_number_oo", ''), "school_name", '') AS "school_name"
      FROM "Ученики" WHERE "предмет" = $1
        AND "номер_кабинета" IS NOT NULL
        ${classroom ? 'AND "номер_кабинета" = $2' : ''}
      ORDER BY "номер_кабинета", "номер_места", "фимилия", "имя", "id"
    `, classroom ? [subject, classroom] : [subject]);
    if (!result.rows.length) {
      throw httpError(404, 'Участники для выбранного предмета и аудитории не найдены. Сначала выполните рассадку.');
    }
    return result.rows;
  } catch (error) {
    throw error;
  }
}

function groupByClassroom(students) {
  const classrooms = new Map();
  for (const student of students) {
    if (!classrooms.has(student.classroom)) classrooms.set(student.classroom, []);
    classrooms.get(student.classroom).push(student);
  }
  return classrooms;
}

router.get('/', asyncRoute(async (req, res) => {
  res.render('forms/index', await getOptions());
}));

router.get('/api/options', asyncRoute(async (req, res) => {
  res.json(await getOptions());
}));

router.get('/api/all-subjects', asyncRoute(async (req, res) => {
  const { subjects } = await getOptions();
  res.json(subjects.map(row => row.предмет));
}));

router.get('/api/subjects/:classroom', asyncRoute(async (req, res) => {
  const classroom = stringInput(req.params.classroom, 'Аудитория', 10);
  if (!/^\d+$/.test(classroom) || !Number.isSafeInteger(Number(classroom)) || Number(classroom) < 1) {
    throw httpError(400, 'Некорректный номер аудитории.');
  }
  const result = await pool.query(`
    SELECT DISTINCT "предмет" FROM "Ученики"
    WHERE "номер_кабинета" = $1 AND "предмет" IS NOT NULL AND "предмет" <> ''
    ORDER BY "предмет"
  `, [classroom]);
  res.json(result.rows.map(row => row.предмет));
}));

router.get('/generate', asyncRoute(async (req, res) => {
  const parameters = formParameters(req.query, true);
  const students = await getStudents(parameters.subject, parameters.all_classrooms ? '' : parameters.classroom);
  const statements = [...groupByClassroom(students)].map(([classroom, participants]) => ({
    ...parameters, classroom,
    title: `Ведомость для аудитории ${classroom}`,
    students: padRows(participants.map(student => ({
      fullName: fullName(student), workplace: student.workplace,
      parallel: student.parallel, sheets: '', signature: ''
    })), { fullName: '', workplace: '', parallel: '', sheets: '', signature: '' })
  }));
  if (parameters.all_classrooms) {
    res.render('forms/all-statements', { ...parameters, statements });
  } else {
    res.render('forms/statement', statements[0]);
  }
}));

router.get('/general-statement', asyncRoute(async (req, res) => {
  const parameters = formParameters(req.query);
  const result = await pool.query(`
    SELECT "номер_кабинета", "паралель", COUNT(*) AS "planned_count"
    FROM "Ученики" WHERE "предмет" = $1 AND "номер_кабинета" IS NOT NULL
    GROUP BY "номер_кабинета", "паралель" ORDER BY "номер_кабинета", "паралель"
  `, [parameters.subject]);
  if (!result.rows.length) throw httpError(404, 'Рассадка участников по выбранному предмету не найдена.');
  const rows = padRows(result.rows.map(row => ({
    classroom: row.номер_кабинета, parallel: row.паралель, planned: row.planned_count,
    actual: '', responsible: '', signature: ''
  })), { classroom: '', parallel: '', planned: '', actual: '', responsible: '', signature: '' });
  res.render('forms/general-statement', { ...parameters, rows });
}));

router.get('/transfer-act', asyncRoute(async (req, res) => {
  const parameters = formParameters(req.query);
  const result = await pool.query(`
    SELECT "паралель", "номер_кабинета", COUNT(*) AS "work_count"
    FROM "Ученики" WHERE "предмет" = $1 AND "номер_кабинета" IS NOT NULL
    GROUP BY "паралель", "номер_кабинета" ORDER BY "паралель", "номер_кабинета"
  `, [parameters.subject]);
  if (!result.rows.length) throw httpError(404, 'Рассадка участников по выбранному предмету не найдена.');
  const totals = new Map();
  const worksRows = result.rows.map(row => {
    totals.set(row.паралель, (totals.get(row.паралель) || 0) + Number(row.work_count));
    return { parallel: row.паралель, classroom: row.номер_кабинета, count: row.work_count };
  });
  const parallelTotals = [...totals].map(([parallel, total]) => ({ parallel, total }));
  res.render('forms/transfer-act', {
    ...parameters,
    worksRows: padRows(worksRows, { parallel: '', classroom: '', count: '' }),
    parallelTotals: padRows(parallelTotals, { parallel: '', total: '' })
  });
}));

router.get('/accompanying-sheet', asyncRoute(async (req, res) => {
  const parameters = formParameters(req.query, true);
  const result = await pool.query(`
    SELECT "номер_кабинета", "предмет", "паралель", "participant_code"
    FROM "Ученики" WHERE "предмет" = $1 AND "номер_кабинета" IS NOT NULL
      ${parameters.all_classrooms ? '' : 'AND "номер_кабинета" = $2'}
    ORDER BY "номер_кабинета", "паралель", "номер_места", "id"
  `, parameters.all_classrooms ? [parameters.subject] : [parameters.subject, parameters.classroom]);
  if (!result.rows.length) throw httpError(404, 'Данные для выбранного предмета и аудитории не найдены.');
  const grouped = new Map();
  for (const row of result.rows) {
    const key = JSON.stringify([row.номер_кабинета, row.паралель]);
    if (!grouped.has(key)) {
      grouped.set(key, {
        school_code: parameters.site_code, school_name: parameters.school_name,
        subject: row.предмет, classroom: row.номер_кабинета, parallel: row.паралель,
        student_count: 0, participant_codes: []
      });
    }
    const sheet = grouped.get(key);
    sheet.student_count += 1;
    sheet.participant_codes.push(row.participant_code || '');
  }
  const sheets = [];
  for (const sheet of grouped.values()) {
    const pageCount = Math.ceil(sheet.participant_codes.length / 16);
    for (let page = 0; page < pageCount; page += 1) {
      sheets.push({
        ...sheet, participant_codes: sheet.participant_codes.slice(page * 16, (page + 1) * 16),
        code_offset: page * 16, page_number: page + 1, page_count: pageCount
      });
    }
  }
  res.render('forms/accompanying-sheet', { ...parameters, sheets, single_mode: !parameters.all_classrooms });
}));

router.get('/registration-list', asyncRoute(async (req, res) => {
  const parameters = formParameters(req.query, true);
  const students = await getStudents(parameters.subject, parameters.all_classrooms ? '' : parameters.classroom);
  const registrationLists = [...groupByClassroom(students)].map(([classroom, participants]) => ({
    ...parameters, classroom,
    students: participants.map((student, index) => ({
      number: index + 1, school: student.school_name, class: student.parallel,
      fullName: fullName(student), classroom, workplace: student.workplace, signature: ''
    }))
  }));
  if (parameters.all_classrooms) {
    res.render('forms/all-registration-lists', { ...parameters, registrationLists });
  } else {
    res.render('forms/registration-list', { ...registrationLists[0], single_mode: true });
  }
}));

module.exports = router;
