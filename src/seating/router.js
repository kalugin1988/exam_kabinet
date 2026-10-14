const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { DATA_DIR, transaction, quoteIdentifier } = require('../database');
const { HttpError } = require('../errors');
const validation = require('./validation');
const {
  pool,
  parallelColors,
  generateTableName,
  initializeDatabase,
  initializeExistingClassroomTables,
  importStudentsFromSubjectTable,
  createClassroomTable,
  populateClassroomTable,
  checkPlacementRules,
  getAllClassrooms,
  getAllStudents,
  getUnplacedStudents,
  getSubjects,
  createClassroom,
  updateClassroom,
  deleteClassroom,
  getClassroomById,
  updateStudentPlace,
  updateStudentPlaceWithDetails,
  getStudentById,
  getClassroomPlaces,
  getOccupiedPlaces,
  updatePlaceBlockStatus,
  getBlockedPlaces,
  clearAllSeating,
  clearAllStudents,
  getStudentsWithPlaces,
  insertStudent,
  updateClassroomLayout,
  getClassroomLayout,
  deleteClassroomLayout,
  moveDesk,
  healthCheck,
  getStudentsByClassroom
} = require('../../bd');

const { generateSeating } = require('../../algorithms/seatingAlgorithm');
const app = express.Router();
app.param('id', (req, res, next, id) => {
  try { validation.integer(id, 'Идентификатор'); next(); } catch (error) { next(error); }
});

// Главная страница
app.get('/seating', async (req, res, next) => {
  try {
    const [classrooms, students, subjectsResult] = await Promise.all([
      getAllClassrooms(),
      getAllStudents(),
      getSubjects()
    ]);

    const subjects = subjectsResult.map(row => row.subject);

    console.log(`📊 Загружено: ${classrooms.length} кабинетов, ${students.length} учеников, ${subjects.length} предметов`);

    res.render('seating', {
      classrooms,
      students,
      subjects,
      parallelColors
    });
  } catch (error) {
    console.error('❌ Ошибка загрузки данных:', error);
    res.status(500).render('error', { message: 'Ошибка загрузки данных' });
  }
});

// Страница управления кабинетами
app.get('/kabinet', async (req, res, next) => {
  try {
    const classrooms = await getAllClassrooms();
    console.log(`🏫 Загружено кабинетов для управления: ${classrooms.length}`);
    res.render('kabinet', { classrooms });
  } catch (error) {
    console.error('❌ Ошибка загрузки кабинетов:', error);
    res.status(500).render('error', { message: 'Ошибка загрузки кабинетов' });
  }
});

// ========== API ROUTES ==========

// ========== КАБИНЕТЫ ==========

app.post('/api/classrooms', async (req, res, next) => {
  try {
    const room = validation.room(req.body || {});
    const classroom = await transaction(async () => {
      const created = await createClassroom(room.номер_кабинета, room.количество_парт, room.количество_рядов_парт, room.этаж);
      await createClassroomTable(created.номер_кабинета);
      return created;
    });
    res.status(201).json({ success: true, classroom, tableCreated: true });
  } catch (error) { next(error); }
});

app.put('/api/classrooms/:id', async (req, res, next) => {
  try {
    const room = validation.room(req.body || {});
    const result = await transaction(async () => {
      const old = await getClassroomById(req.params.id);
      if (!old) throw new HttpError(404, 'Кабинет не найден');
      const blocked = await getBlockedPlaces(old.номер_кабинета);
      const classroom = await updateClassroom(old.id, room.номер_кабинета, room.количество_парт, room.количество_рядов_парт, room.этаж);
      if (old.номер_кабинета !== room.номер_кабинета) {
        await pool.query(`ALTER TABLE ${quoteIdentifier(`kabinet_${old.номер_кабинета}`)} RENAME TO ${quoteIdentifier(`kabinet_${room.номер_кабинета}`)}`);
        await pool.query('UPDATE Ученики SET номер_кабинета=$1 WHERE номер_кабинета=$2', [room.номер_кабинета, old.номер_кабинета]);
      }
      const sizeChanged = old.количество_парт !== room.количество_парт || old.количество_рядов_парт !== room.количество_рядов_парт;
      let unseatedCount = 0;
      if (sizeChanged) {
        await populateClassroomTable(room.номер_кабинета, `kabinet_${room.номер_кабинета}`);
        const available = new Set((await getClassroomPlaces(room.номер_кабинета)).map(row => row.номер_места));
        for (const place of blocked) if (available.has(place)) await updatePlaceBlockStatus(room.номер_кабинета, place, true);
        const students = await getStudentsByClassroom(room.номер_кабинета);
        for (const student of students) if (!available.has(student.номер_места)) { await updateStudentPlace(student.id, null, null); unseatedCount++; }
        await deleteClassroomLayout(old.id);
      }
      return { classroom, unseatedCount };
    });
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
});

app.delete('/api/classrooms/:id', async (req, res, next) => {
  try {
    await transaction(async () => {
      const classroom = await getClassroomById(req.params.id);
      if (!classroom) throw new HttpError(404, 'Кабинет не найден');
      await pool.query('UPDATE Ученики SET номер_кабинета=NULL,номер_места=NULL WHERE номер_кабинета=$1', [classroom.номер_кабинета]);
      await deleteClassroomLayout(classroom.id);
      await deleteClassroom(classroom.id);
      await pool.query(`DROP TABLE IF EXISTS ${quoteIdentifier(`kabinet_${classroom.номер_кабинета}`)}`);
    });
    res.json({ success: true });
  } catch (error) { next(error); }
});

// ========== УЧЕНИКИ ==========

app.put('/api/students/place', async (req, res, next) => {
  try {
    const studentId = validation.integer(req.body?.studentId, 'Ученик');
    const { classroomNumber, placeNumber, studentData } = req.body;
    await transaction(async () => {
      const student = await getStudentById(studentId);
      if (!student) throw new HttpError(404, 'Ученик не найден');
      if (classroomNumber === null && placeNumber === null) {
        await updateStudentPlace(studentId, null, null);
        return;
      }
      const number = validation.integer(classroomNumber, 'Кабинет');
      const place = validation.place(placeNumber);
      const seats = (await pool.query('SELECT номер_кабинета FROM Кабинеты WHERE номер_кабинета=$1', [number])).rows;
      if (!seats.length) throw new HttpError(404, 'Кабинет не найден');
      const target = (await getClassroomPlaces(number)).find(row => row.номер_места === place);
      if (!target) throw new HttpError(404, 'Место не найдено');
      if (target.заблокировано) throw new HttpError(409, 'Место заблокировано');
      const classmates = (await getStudentsByClassroom(number)).filter(row => row.id !== studentId && row.предмет === student.предмет);
      if (classmates.some(row => row.номер_места === place)) throw new HttpError(409, 'Место уже занято');
      if (!checkPlacementRules(student, number, place, classmates)) throw new HttpError(409, 'Нарушены правила соседства');
      if (studentData !== undefined && (!studentData || typeof studentData !== 'object' || Array.isArray(studentData))) throw new HttpError(400, 'Некорректные данные ученика');
      const fields = {};
      for (const key of ['school_code','school_name','school_number_oo','school_name_oo','participant_code']) {
        if (studentData?.[key] !== undefined) fields[key] = validation.text(studentData[key], key, key.includes('name') ? 500 : 50, false);
      }
      await updateStudentPlaceWithDetails(studentId, number, place, fields);
    });
    res.json({ success: true });
  } catch (error) { next(error); }
});

app.get('/api/students', async (req, res, next) => {
  try {
    console.log('📚 Загрузка всех учеников');
    const students = await getAllStudents();
    console.log(`✅ Загружено учеников: ${students.length}`);
    res.json({ success: true, students });
  } catch (error) {
    console.error('❌ Ошибка загрузки учеников:', error);
    next(error);
  }
});

app.get('/api/students/unplaced', async (req, res, next) => {
  try {
    console.log('📚 Загрузка учеников без мест');
    const students = await getUnplacedStudents();
    console.log(`✅ Загружено учеников без мест: ${students.length}`);
    res.json({ success: true, students });
  } catch (error) {
    console.error('❌ Ошибка загрузки учеников без мест:', error);
    next(error);
  }
});

app.post('/api/check-placement', async (req, res, next) => {
  try {
    const studentId = validation.integer(req.body?.studentId, 'Ученик');
    const classroomNumber = validation.integer(req.body?.classroomNumber, 'Кабинет');
    const placeNumber = validation.place(req.body?.placeNumber);

    console.log(`🔍 Проверка размещения: ученик=${studentId}, кабинет=${classroomNumber}, место=${placeNumber}`);

    const student = await getStudentById(studentId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Ученик не найден' });
    }

    if (!(await pool.query('SELECT id FROM Кабинеты WHERE номер_кабинета=$1', [classroomNumber])).rowCount) throw new HttpError(404, 'Кабинет не найден');
    const tableName = `kabinet_${classroomNumber}`;
    const placeResult = await pool.query(
      `SELECT заблокировано FROM ${tableName} WHERE номер_места = $1`,
      [placeNumber]
    );

    if (!placeResult.rowCount) throw new HttpError(404, 'Место не найдено');
    if (placeResult.rows[0].заблокировано) {
      return res.json({
        success: false,
        error: 'Место заблокировано',
        canPlace: false
      });
    }

    const occupiedResult = await pool.query(
      'SELECT * FROM Ученики WHERE номер_кабинета = $1 AND номер_места = $2 AND id != $3 AND предмет = $4',
      [classroomNumber, placeNumber, studentId, student.предмет]
    );

    if (occupiedResult.rows.length > 0) {
      return res.json({
        success: false,
        error: 'Место уже занято',
        canPlace: false
      });
    }

    const classmatesResult = await pool.query(
      'SELECT * FROM Ученики WHERE номер_кабинета = $1 AND id != $2 AND предмет = $3',
      [classroomNumber, studentId, student.предмет]
    );

    const canPlace = checkPlacementRules(student, classroomNumber, placeNumber, classmatesResult.rows);

    if (canPlace) {
      res.json({
        success: true,
        canPlace: true,
        message: 'Ученик может быть размещен'
      });
    } else {
      res.json({
        success: false,
        canPlace: false,
        error: 'Нарушены правила соседства'
      });
    }

  } catch (error) {
    console.error('❌ Ошибка проверки размещения:', error);
    next(error);
  }
});

// ========== МЕСТА В КАБИНЕТАХ ==========

app.get('/api/classrooms/:id/free-places', async (req, res, next) => {
  try {
    const { id } = req.params;
    console.log(`🪑 Получение свободных мест для кабинета ID=${id}`);

    const classroom = await getClassroomById(id);
    if (!classroom) {
      return res.status(404).json({ success: false, error: 'Кабинет не найден' });
    }

    const classroomNumber = classroom.номер_кабинета;
    const allPlaces = await getClassroomPlaces(classroomNumber);
    const occupiedPlaces = await getOccupiedPlaces(classroomNumber);

    const freePlaces = allPlaces
      .filter(place => !place.заблокировано && !occupiedPlaces.includes(place.номер_места))
      .map(place => place.номер_места);

    const blockedPlaces = allPlaces
      .filter(place => place.заблокировано)
      .map(place => place.номер_места);

    console.log(`✅ Свободных мест: ${freePlaces.length}, заблокированных: ${blockedPlaces.length}`);

    res.json({
      success: true,
      freePlaces,
      blockedPlaces,
      totalPlaces: allPlaces.length,
      occupiedPlaces: occupiedPlaces.length
    });
  } catch (error) {
    console.error('❌ Ошибка получения свободных мест:', error);
    next(error);
  }
});

app.put('/api/classrooms/:id/block-place', async (req, res, next) => {
  try {
    const { id } = req.params;
    const placeNumber = validation.place(req.body?.placeNumber);
    const blocked = req.body?.blocked;
    if (typeof blocked !== 'boolean') throw new HttpError(400, 'Укажите состояние блокировки');

    console.log(`${blocked ? '🔒' : '🔓'} ${blocked ? 'Блокировка' : 'Разблокировка'} места: кабинет ID=${id}, место=${placeNumber}`);

    const classroom = await getClassroomById(id);
    if (!classroom) {
      return res.status(404).json({ success: false, error: 'Кабинет не найден' });
    }

    const classroomNumber = classroom.номер_кабинета;

    const tableName = `kabinet_${classroomNumber}`;
    const placeResult = await pool.query(
      `SELECT номер_места FROM ${tableName} WHERE номер_места = $1`,
      [placeNumber]
    );

    if (placeResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Место не найдено' });
    }

    await updatePlaceBlockStatus(classroomNumber, placeNumber, blocked);
    console.log(`✅ Место ${placeNumber} ${blocked ? 'заблокировано' : 'разблокировано'}`);

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка блокировки места:', error);
    next(error);
  }
});

app.get('/api/classrooms/:id/blocked-places', async (req, res, next) => {
  try {
    const { id } = req.params;
    console.log(`🔒 Получение заблокированных мест для кабинета ID=${id}`);

    const classroom = await getClassroomById(id);
    if (!classroom) {
      return res.status(404).json({ success: false, error: 'Кабинет не найден' });
    }

    const classroomNumber = classroom.номер_кабинета;
    const blockedPlaces = await getBlockedPlaces(classroomNumber);

    console.log(`✅ Заблокированных мест: ${blockedPlaces.length}`);

    res.json({
      success: true,
      blockedPlaces,
      count: blockedPlaces.length
    });
  } catch (error) {
    console.error('❌ Ошибка получения заблокированных мест:', error);
    next(error);
  }
});

// ========== ПОСАДКА ==========

app.post('/api/generate-seating', async (req, res, next) => {
  const log = (message) => {
    console.log(message);
  };

  try {
    const response = await transaction(async () => {
    const subject = validation.text(req.body?.subject, 'Предмет', 100);

    if (!subject) {
      throw new HttpError(400, 'Не указан предмет');
    }

    log(`🎯 НАЧАЛО ФОРМИРОВАНИЯ ПОСАДКИ ДЛЯ ПРЕДМЕТА: ${subject}`);

    const tableName = generateTableName(subject);

    log(`📋 Проверяем таблицу: ${tableName}`);

    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = $1
      )
    `, [tableName]);

    let students;
    let studentsSource = '';

    if (tableExists.rows[0].exists) {
      log(`✅ Таблица ${tableName} существует`);
      students = await pool.query(`SELECT * FROM ${quoteIdentifier(tableName)}`);
      students = students.rows;
      studentsSource = tableName;

      if (students.length > 0) {
        const importSuccess = await importStudentsFromSubjectTable(students, subject);
        if (!importSuccess) {
          log(`❌ Ошибка импорта учеников`);
          throw new Error('Ошибка импорта учеников');
        }
      }
    } else {
      log(`ℹ️ Таблица ${tableName} не существует`);
      students = await pool.query(
        'SELECT * FROM Ученики WHERE предмет = $1 ORDER BY паралель, фимилия',
        [subject]
      );
      students = students.rows;
      studentsSource = 'Ученики';
    }

    log(`📚 Загружено учеников из ${studentsSource}: ${students.length}`);

    if (students.length === 0) {
      log(`⚠️ Нет учеников для предмета "${subject}"`);
      throw new HttpError(400, `Нет учеников для предмета "${subject}"`);
    }

    const actualStudents = await pool.query(
      'SELECT * FROM Ученики WHERE предмет = $1 ORDER BY паралель, фимилия',
      [subject]
    );

    log(`📊 Актуальные данные: ${actualStudents.rows.length} записей`);

    const classrooms = await getAllClassrooms();
    log(`🏫 Загружено кабинетов: ${classrooms.length}`);

    const blockedPlacesByClassroom = {};
    for (const classroom of classrooms) {
      const tableName = `kabinet_${classroom.номер_кабинета}`;
      const blockedResult = await pool.query(
        `SELECT номер_места FROM ${tableName} WHERE заблокировано = true`
      );
      blockedPlacesByClassroom[classroom.номер_кабинета] = blockedResult.rows.map(row => row.номер_места);
      log(`🔒 Кабинет ${classroom.номер_кабинета}: ${blockedResult.rows.length} заблокированных мест`);
    }

    const result = generateSeating(actualStudents.rows, classrooms, blockedPlacesByClassroom, log);
    const { seating, unplacedStudents } = result;

    log(`✅ Сформировано размещений: ${seating.length}`);
    log(`⚠️ Не размещено: ${unplacedStudents.length}`);

    await pool.query('UPDATE Ученики SET номер_кабинета=NULL,номер_места=NULL WHERE предмет=$1', [subject]);
    log('💾 Обновляем места в базе данных...');
    for (const assignment of seating) {
      // Находим полные данные ученика для обновления дополнительных полей
      const student = actualStudents.rows.find(s => s.id === assignment.studentId);

      if (student) {
        await updateStudentPlaceWithDetails(
          assignment.studentId,
          assignment.classroom,
          assignment.place,
          {
            school_code: student.school_code,
            school_name: student.school_name,
            school_number_oo: student.school_number_oo,
            school_name_oo: student.school_name_oo,
            participant_code: student.participant_code
          }
        );
      } else {
        // Если не нашли полные данные, обновляем только место
        await updateStudentPlace(assignment.studentId, assignment.classroom, assignment.place);
      }
    }
    log('✅ Места и данные учеников обновлены');

    log(`🎉 ЗАВЕРШЕНО ФОРМИРОВАНИЕ ПОСАДКИ ДЛЯ: ${subject}`);

    return {
      success: true,
      seating,
      unplacedStudents,
      stats: {
        studentsCount: actualStudents.rows.length,
        seatingCount: seating.length,
        unplacedCount: unplacedStudents.length,
        source: studentsSource
      }
    };
    });
    res.json(response);
  } catch (error) {
    console.error('❌ Ошибка формирования посадки:', error);
    next(error);
  }
});

app.post('/api/clear-seating', async (req, res, next) => {
  try {
    console.log('🧹 Очистка всех мест учеников');
    await clearAllSeating();
    console.log('✅ Все места очищены');
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка очистки мест:', error);
    next(error);
  }
});

app.post('/api/clear-all-data', async (req, res, next) => {
  try {
    console.log('🗑️ Полная очистка данных учеников');
    await clearAllStudents();
    console.log('✅ Все данные учеников удалены');
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка очистки данных:', error);
    next(error);
  }
});

// ========== ЭКСПОРТ/ИМПОРТ ==========

app.get('/api/export-seating', async (req, res, next) => {
  try {
    console.log('📤 Экспорт данных о посадке');

    const students = await getStudentsWithPlaces();
    console.log(`✅ Экспортируется ${students.length} учеников`);

    const data = {
      exportDate: new Date().toISOString(),
      exportInfo: {
        system: 'Seating Arrangement System',
        version: '1.0',
        totalStudents: students.length
      },
      students
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `seating_export_${timestamp}.json`;
    const filePath = path.join(DATA_DIR, 'exports', filename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`✅ Файл экспорта создан: ${filename}`);

    res.download(filePath, `seating_export.json`, (err) => {
      if (err && !res.headersSent) next(err);
      setTimeout(() => {
        try {
          fs.unlinkSync(filePath);
          console.log(`✅ Временный файл удален: ${filename}`);
        } catch (unlinkError) {
          console.error('❌ Ошибка удаления временного файла:', unlinkError);
        }
      }, 1000);
    });

  } catch (error) {
    console.error('❌ Ошибка экспорта:', error);
    next(error);
  }
});

app.post('/api/import-seating', async (req, res, next) => {
  try {
    const input = req.body?.data?.students;
    if (!Array.isArray(input) || !input.length || input.length > 50000) throw new HttpError(400, 'Нужен непустой список учеников (до 50000 записей)');
    const identifiers = new Set();
    const seatKeys = new Set();
    const students = input.map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, `Неверная запись ${index + 1}`);
      const student = {};
      for (const [key, max] of [['фимилия',100],['имя',100],['паралель',10],['предмет',100]]) student[key] = validation.text(raw[key], key, max);
      for (const [key, max] of [['отчество',100],['school_code',50],['school_name',500],['school_number_oo',50],['school_name_oo',500],['participant_code',50]]) student[key] = validation.text(raw[key], key, max, false);
      if (raw.id !== undefined) {
        student.id = validation.integer(raw.id, 'Идентификатор ученика');
        if (identifiers.has(student.id)) throw new HttpError(400, 'Повторяется идентификатор ученика');
        identifiers.add(student.id);
      }
      student.номер_кабинета = raw.номер_кабинета == null ? null : validation.integer(raw.номер_кабинета, 'Кабинет');
      student.номер_места = raw.номер_места == null ? null : validation.place(raw.номер_места);
      if ((student.номер_кабинета === null) !== (student.номер_места === null)) throw new HttpError(400, 'Укажите и кабинет, и место либо оставьте оба поля пустыми');
      if (student.номер_кабинета !== null) {
        const key = JSON.stringify([student.предмет,student.номер_кабинета,student.номер_места]);
        if (seatKeys.has(key)) throw new HttpError(409, 'Несколько учеников занимают одно место');
        seatKeys.add(key);
      }
      return student;
    });
    await transaction(async () => {
      for (const student of students) {
        if (student.номер_кабинета === null) continue;
        const room = await pool.query('SELECT id FROM Кабинеты WHERE номер_кабинета=$1', [student.номер_кабинета]);
        if (!room.rowCount) throw new HttpError(400, `Кабинет ${student.номер_кабинета} отсутствует. Сначала создайте его.`);
        const target = (await getClassroomPlaces(student.номер_кабинета)).find(row => row.номер_места === student.номер_места);
        if (!target || target.заблокировано) throw new HttpError(400, 'В файле указано отсутствующее или заблокированное место');
      }
      await clearAllStudents();
      for (const student of students) {
        await insertStudent(student);
        await pool.query('INSERT INTO id_subject(subject) VALUES($1) ON CONFLICT(subject) DO NOTHING', [student.предмет]);
      }
    });
    res.json({ success: true, stats: { total: students.length, success: students.length, errors: 0 } });
  } catch (error) { next(error); }
});

// ========== КОНФИГУРАЦИЯ РЯДОВ ==========

app.put('/api/classrooms/:id/layout', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { row_mapping } = req.body || {};
    if (!row_mapping || typeof row_mapping !== 'object' || Array.isArray(row_mapping)) throw new HttpError(400, 'Неверная конфигурация рядов');
    if (!(await getClassroomById(id))) throw new HttpError(404, 'Кабинет не найден');

    console.log(`⚙️ Обновление конфигурации кабинета ID=${id}`);
    await updateClassroomLayout(id, row_mapping);
    console.log(`✅ Конфигурация обновлена`);

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка обновления конфигурации:', error);
    next(error);
  }
});

app.get('/api/classrooms/:id/layout', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!(await getClassroomById(id))) throw new HttpError(404, 'Кабинет не найден');
    console.log(`⚙️ Загрузка конфигурации кабинета ID=${id}`);

    const row_mapping = await getClassroomLayout(id);
    res.json({ success: true, row_mapping });
  } catch (error) {
    console.error('❌ Ошибка загрузки конфигурации:', error);
    next(error);
  }
});

app.delete('/api/classrooms/:id/layout', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!(await getClassroomById(id))) throw new HttpError(404, 'Кабинет не найден');
    console.log(`🗑️ Удаление конфигурации кабинета ID=${id}`);

    await deleteClassroomLayout(id);
    console.log(`✅ Конфигурация удалена`);

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка удаления конфигурации:', error);
    next(error);
  }
});

// ========== ПЕРЕМЕЩЕНИЕ ПАРТ ==========

app.put('/api/classrooms/:id/move-desk', async (req, res, next) => {
  try {
    const fromRow = validation.integer(req.body?.fromRow, 'Исходный ряд', 1, 6);
    const toRow = validation.integer(req.body?.toRow, 'Новый ряд', 1, 6);
    const fromDesk = validation.integer(req.body?.fromDesk, 'Исходная парта', 1, 300);
    const toDesk = validation.integer(req.body?.toDesk, 'Новая парта', 1, 300);
    const movedCount = await transaction(async () => {
      const classroom = await getClassroomById(req.params.id);
      if (!classroom) throw new HttpError(404, 'Кабинет не найден');
      const letters = ['А','Б','В','Г','Д','Е','Ж','З','И','К','Л','М'];
      const source = [fromDesk + letters[(fromRow-1)*2], fromDesk + letters[(fromRow-1)*2+1]];
      const destination = [toDesk + letters[(toRow-1)*2], toDesk + letters[(toRow-1)*2+1]];
      const seats = await getClassroomPlaces(classroom.номер_кабинета);
      const byPlace = new Map(seats.map(seat => [seat.номер_места,seat]));
      if (![...source,...destination].every(place => byPlace.has(place))) throw new HttpError(400, 'Выбранная парта отсутствует в кабинете');
      if (source[0] === destination[0]) return 0;
      const mapping = new Map([[source[0],destination[0]],[source[1],destination[1]],[destination[0],source[0]],[destination[1],source[1]]]);
      const students = await getStudentsByClassroom(classroom.номер_кабинета);
      const moved = students.filter(student => mapping.has(student.номер_места));
      const planned = students.map(student => ({...student,номер_места:mapping.get(student.номер_места) || student.номер_места}));
      for (const student of moved) {
        const target = mapping.get(student.номер_места);
        if (byPlace.get(target).заблокировано) throw new HttpError(409, 'Нельзя переместить ученика на заблокированное место');
        const classmates = planned.filter(row => row.id !== student.id && row.предмет === student.предмет);
        if (classmates.some(row => row.номер_места === target)) throw new HttpError(409, 'Место уже занято');
        if (!checkPlacementRules(student, classroom.номер_кабинета, target, classmates)) throw new HttpError(409, 'Обмен нарушает правила соседства');
      }
      for (const student of moved) await updateStudentPlace(student.id, classroom.номер_кабинета, mapping.get(student.номер_места));
      return moved.length;
    });
    res.json({ success: true, movedCount });
  } catch (error) { next(error); }
});

app.get('/api/classrooms/:id/available-desks', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { currentRow, currentDesk } = req.query;

    console.log(`🔍 Получение доступных мест для кабинета ${id}`);

    const classroom = await getClassroomById(id);
    if (!classroom) {
      return res.status(404).json({ success: false, error: 'Кабинет не найден' });
    }

    const availableDesks = [];
    const rows = classroom.количество_рядов_парт;
    const totalDesks = classroom.количество_парт;
    const desksPerRow = Math.ceil(totalDesks / rows);

    for (let row = 1; row <= rows; row++) {
      for (let desk = 1; desk <= desksPerRow; desk++) {
        if (row == currentRow && desk == currentDesk) continue;

        const deskNumber = (row - 1) * desksPerRow + desk;
        if (deskNumber <= totalDesks) {
          availableDesks.push({
            row,
            desk,
            display: `Ряд ${row}, Парта ${desk}`
          });
        }
      }
    }

    res.json({ success: true, availableDesks });
  } catch (error) {
    console.error('❌ Ошибка получения доступных мест:', error);
    next(error);
  }
});

// ========== ПРЕДМЕТЫ ==========

app.get('/api/subjects', async (req, res, next) => {
  try {
    console.log('📖 Загрузка списка предметов');
    const subjects = await getSubjects();
    console.log(`✅ Загружено предметов: ${subjects.length}`);
    res.json({ success: true, subjects });
  } catch (error) {
    console.error('❌ Ошибка загрузки предметов:', error);
    next(error);
  }
});

// ========== HEALTH CHECK ==========

app.get('/api/health', async (req, res, next) => {
  try {
    await healthCheck();
    res.json({
      success: true,
      status: 'OK',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    error.status = 503;
    next(error);
  }
});


module.exports = app;
