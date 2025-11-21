const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

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
} = require('./bd');

const { generateSeating } = require('./algorithms/seatingAlgorithm');

// Импорт модулей
const ooRoutes = require('./server_oo');
const printRoutes = require('./server_print');

const app = express();
const port = process.env.PORT || 3000;

// ========== MIDDLEWARE ==========
app.use(express.static('public'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware для логирования
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// ========== ПОДКЛЮЧЕНИЕ МОДУЛЕЙ ==========
app.use('/', ooRoutes);
app.use('/', printRoutes);

// ========== ОСНОВНЫЕ МАРШРУТЫ ==========

// Главная страница
app.get('/', async (req, res) => {
  try {
    const [classrooms, students, subjectsResult] = await Promise.all([
      getAllClassrooms(),
      getAllStudents(),
      getSubjects()
    ]);
    
    const subjects = subjectsResult.map(row => row.subject);
    
    console.log(`📊 Загружено: ${classrooms.length} кабинетов, ${students.length} учеников, ${subjects.length} предметов`);
    
    res.render('index', { 
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
app.get('/kabinet', async (req, res) => {
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

app.post('/api/classrooms', async (req, res) => {
  try {
    const { номер_кабинета, количество_парт, количество_рядов_парт, этаж } = req.body;
    
    console.log(`🏗️ Создание кабинета: №${номер_кабинета}, парт:${количество_парт}, рядов:${количество_рядов_парт}, этаж:${этаж}`);
    
    const classroom = await createClassroom(номер_кабинета, количество_парт, количество_рядов_парт, этаж);
    const tableCreated = await createClassroomTable(номер_кабинета);
    
    console.log(`✅ Кабинет создан: ID=${classroom.id}`);
    
    res.json({ 
      success: true, 
      classroom,
      tableCreated 
    });
  } catch (error) {
    console.error('❌ Ошибка создания кабинета:', error);
    res.json({ success: false, error: error.message });
  }
});

app.put('/api/classrooms/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { номер_кабинета, количество_парт, количество_рядов_парт, этаж } = req.body;
    
    console.log(`🔄 Обновление кабинета ID=${id}: №${номер_кабинета}, парт:${количество_парт}, рядов:${количество_рядов_парт}`);
    
    const oldClassroom = await getClassroomById(id);
    const oldClassroomNumber = oldClassroom?.номер_кабинета;
    
    const classroom = await updateClassroom(id, номер_кабинета, количество_парт, количество_рядов_парт, этаж);
    
    console.log(`✅ Кабинет обновлен: ID=${classroom.id}`);
    
    if (oldClassroomNumber && oldClassroomNumber !== номер_кабинета) {
      const oldTableName = `kabinet_${oldClassroomNumber}`;
      const newTableName = `kabinet_${номер_кабинета}`;
      
      try {
        await pool.query(`ALTER TABLE ${oldTableName} RENAME TO ${newTableName}`);
        console.log(`✅ Таблица переименована: ${oldTableName} -> ${newTableName}`);
        await populateClassroomTable(номер_кабинета, newTableName);
      } catch (error) {
        console.error('❌ Ошибка переименования таблицы:', error);
        await createClassroomTable(номер_кабинета);
      }
    } else {
      await populateClassroomTable(номер_кабинета, `kabinet_${номер_кабинета}`);
    }
    
    res.json({ success: true, classroom });
  } catch (error) {
    console.error('❌ Ошибка обновления кабинета:', error);
    res.json({ success: false, error: error.message });
  }
});

app.delete('/api/classrooms/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🗑️ Удаление кабинета ID=${id}`);
    
    const classroom = await getClassroomById(id);
    const classroomNumber = classroom?.номер_кабинета;
    
    await deleteClassroom(id);
    console.log(`✅ Кабинет удален: ID=${id}`);
    
    if (classroomNumber) {
      const tableName = `kabinet_${classroomNumber}`;
      try {
        await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
        console.log(`✅ Таблица кабинета удалена: ${tableName}`);
      } catch (error) {
        console.error(`❌ Ошибка удаления таблицы кабинета ${tableName}:`, error);
      }
      
      await deleteClassroomLayout(id);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка удаления кабинета:', error);
    res.json({ success: false, error: error.message });
  }
});

// ========== УЧЕНИКИ ==========

app.put('/api/students/place', async (req, res) => {
  try {
    const { studentId, classroomNumber, placeNumber, studentData } = req.body;
    
    console.log(`🎓 Обновление места ученика: ID=${studentId}, кабинет=${classroomNumber}, место=${placeNumber}`);
    
    if (studentData) {
      // Обновляем место и дополнительные данные
      await updateStudentPlaceWithDetails(studentId, classroomNumber, placeNumber, studentData);
    } else {
      // Обновляем только место
      await updateStudentPlace(studentId, classroomNumber, placeNumber);
    }
    
    console.log(`✅ Место ученика обновлено: ID=${studentId}`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка обновления места ученика:', error);
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/students', async (req, res) => {
  try {
    console.log('📚 Загрузка всех учеников');
    const students = await getAllStudents();
    console.log(`✅ Загружено учеников: ${students.length}`);
    res.json({ success: true, students });
  } catch (error) {
    console.error('❌ Ошибка загрузки учеников:', error);
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/students/unplaced', async (req, res) => {
  try {
    console.log('📚 Загрузка учеников без мест');
    const students = await getUnplacedStudents();
    console.log(`✅ Загружено учеников без мест: ${students.length}`);
    res.json({ success: true, students });
  } catch (error) {
    console.error('❌ Ошибка загрузки учеников без мест:', error);
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/check-placement', async (req, res) => {
  try {
    const { studentId, classroomNumber, placeNumber } = req.body;
    
    console.log(`🔍 Проверка размещения: ученик=${studentId}, кабинет=${classroomNumber}, место=${placeNumber}`);
    
    const student = await getStudentById(studentId);
    if (!student) {
      return res.json({ success: false, error: 'Ученик не найден' });
    }
    
    const tableName = `kabinet_${classroomNumber}`;
    const placeResult = await pool.query(
      `SELECT заблокировано FROM ${tableName} WHERE номер_места = $1`,
      [placeNumber]
    );
    
    if (placeResult.rows.length > 0 && placeResult.rows[0].заблокировано) {
      return res.json({ 
        success: false, 
        error: 'Место заблокировано',
        canPlace: false 
      });
    }
    
    const occupiedResult = await pool.query(
      'SELECT * FROM Ученики WHERE номер_кабинета = $1 AND номер_места = $2 AND id != $3',
      [classroomNumber, placeNumber, studentId]
    );
    
    if (occupiedResult.rows.length > 0) {
      return res.json({ 
        success: false, 
        error: 'Место уже занято',
        canPlace: false 
      });
    }
    
    const classmatesResult = await pool.query(
      'SELECT * FROM Ученики WHERE номер_кабинета = $1 AND id != $2',
      [classroomNumber, studentId]
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
    res.json({ success: false, error: error.message });
  }
});

// ========== МЕСТА В КАБИНЕТАХ ==========

app.get('/api/classrooms/:id/free-places', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🪑 Получение свободных мест для кабинета ID=${id}`);
    
    const classroom = await getClassroomById(id);
    if (!classroom) {
      return res.json({ success: false, error: 'Кабинет не найден' });
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
    res.json({ success: false, error: error.message });
  }
});

app.put('/api/classrooms/:id/block-place', async (req, res) => {
  try {
    const { id } = req.params;
    const { placeNumber, blocked } = req.body;
    
    console.log(`${blocked ? '🔒' : '🔓'} ${blocked ? 'Блокировка' : 'Разблокировка'} места: кабинет ID=${id}, место=${placeNumber}`);
    
    const classroom = await getClassroomById(id);
    if (!classroom) {
      return res.json({ success: false, error: 'Кабинет не найден' });
    }
    
    const classroomNumber = classroom.номер_кабинета;
    
    const tableName = `kabinet_${classroomNumber}`;
    const placeResult = await pool.query(
      `SELECT номер_места FROM ${tableName} WHERE номер_места = $1`,
      [placeNumber]
    );
    
    if (placeResult.rows.length === 0) {
      return res.json({ success: false, error: 'Место не найдено' });
    }
    
    await updatePlaceBlockStatus(classroomNumber, placeNumber, blocked);
    console.log(`✅ Место ${placeNumber} ${blocked ? 'заблокировано' : 'разблокировано'}`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка блокировки места:', error);
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/classrooms/:id/blocked-places', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🔒 Получение заблокированных мест для кабинета ID=${id}`);
    
    const classroom = await getClassroomById(id);
    if (!classroom) {
      return res.json({ success: false, error: 'Кабинет не найден' });
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
    res.json({ success: false, error: error.message });
  }
});

// ========== ПОСАДКА ==========

app.post('/api/generate-seating', async (req, res) => {
  let logData = '';
  const log = (message) => {
    console.log(message);
    logData += message + '\n';
  };
  
  try {
    const { subject } = req.body;
    
    if (!subject) {
      return res.json({ success: false, error: 'Не указан предмет' });
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
      students = await pool.query(`SELECT * FROM ${tableName}`);
      students = students.rows;
      studentsSource = tableName;
      
      if (students.length > 0) {
        const importSuccess = await importStudentsFromSubjectTable(students, subject);
        if (!importSuccess) {
          log(`❌ Ошибка импорта учеников`);
          return res.json({ success: false, error: 'Ошибка импорта учеников' });
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
      return res.json({ success: false, error: `Нет учеников для предмета "${subject}"` });
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
    
    res.json({ 
      success: true, 
      seating,
      unplacedStudents,
      stats: {
        studentsCount: actualStudents.rows.length,
        seatingCount: seating.length,
        unplacedCount: unplacedStudents.length,
        source: studentsSource
      }
    });
  } catch (error) {
    console.error('❌ Ошибка формирования посадки:', error);
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/clear-seating', async (req, res) => {
  try {
    console.log('🧹 Очистка всех мест учеников');
    await clearAllSeating();
    console.log('✅ Все места очищены');
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка очистки мест:', error);
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/clear-all-data', async (req, res) => {
  try {
    console.log('🗑️ Полная очистка данных учеников');
    await clearAllStudents();
    console.log('✅ Все данные учеников удалены');
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка очистки данных:', error);
    res.json({ success: false, error: error.message });
  }
});

// ========== ЭКСПОРТ/ИМПОРТ ==========

app.get('/api/export-seating', async (req, res) => {
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
    const filePath = path.join(__dirname, filename);
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`✅ Файл экспорта создан: ${filename}`);
    
    res.download(filePath, `seating_export.json`, (err) => {
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
    res.status(500).json({ success: false, error: 'Ошибка экспорта: ' + error.message });
  }
});

app.post('/api/import-seating', async (req, res) => {
  try {
    console.log('📥 Начало импорта данных...');
    
    if (!req.body?.data) {
      return res.json({ success: false, error: 'Нет данных для импорта' });
    }

    const { students } = req.body.data;
    
    if (!students || !Array.isArray(students)) {
      return res.json({ success: false, error: 'Неверный формат данных' });
    }

    console.log(`📚 Импорт данных: ${students.length} учеников`);

    let successCount = 0;
    let errorCount = 0;

    await clearAllStudents();

    for (const student of students) {
      try {
        if (!student.фимилия || !student.имя || !student.паралель || !student.предмет) {
          console.warn(`⚠️ Пропущен ученик с неполными данными:`, student);
          errorCount++;
          continue;
        }

        await insertStudent(student);
        successCount++;
      } catch (error) {
        console.error(`❌ Ошибка импорта ученика:`, student, error);
        errorCount++;
      }
    }

    console.log(`✅ Импорт завершен: успешно ${successCount}, ошибок ${errorCount}`);

    res.json({ 
      success: true, 
      stats: { total: students.length, success: successCount, errors: errorCount }
    });
  } catch (error) {
    console.error('❌ Ошибка импорта:', error);
    res.json({ success: false, error: error.message });
  }
});

// ========== КОНФИГУРАЦИЯ РЯДОВ ==========

app.put('/api/classrooms/:id/layout', async (req, res) => {
  try {
    const { id } = req.params;
    const { row_mapping } = req.body;
    
    console.log(`⚙️ Обновление конфигурации кабинета ID=${id}`);
    await updateClassroomLayout(id, row_mapping);
    console.log(`✅ Конфигурация обновлена`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка обновления конфигурации:', error);
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/classrooms/:id/layout', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`⚙️ Загрузка конфигурации кабинета ID=${id}`);
    
    const row_mapping = await getClassroomLayout(id);
    res.json({ success: true, row_mapping });
  } catch (error) {
    console.error('❌ Ошибка загрузки конфигурации:', error);
    res.json({ success: false, error: error.message });
  }
});

app.delete('/api/classrooms/:id/layout', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🗑️ Удаление конфигурации кабинета ID=${id}`);
    
    await deleteClassroomLayout(id);
    console.log(`✅ Конфигурация удалена`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка удаления конфигурации:', error);
    res.json({ success: false, error: error.message });
  }
});

// ========== ПЕРЕМЕЩЕНИЕ ПАРТ ==========

app.put('/api/classrooms/:id/move-desk', async (req, res) => {
  try {
    const { id } = req.params;
    const { fromRow, fromDesk, toRow, toDesk } = req.body;
    
    console.log(`🔄 Перемещение парты в кабинете ${id}: ряд ${fromRow} парта ${fromDesk} -> ряд ${toRow} парта ${toDesk}`);
    
    const classroom = await getClassroomById(id);
    if (!classroom) {
      return res.json({ success: false, error: 'Кабинет не найден' });
    }
    
    await moveDesk(classroom.номер_кабинета, fromRow, fromDesk, toRow, toDesk);
    console.log(`✅ Парта перемещена`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка перемещения парты:', error);
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/classrooms/:id/available-desks', async (req, res) => {
  try {
    const { id } = req.params;
    const { currentRow, currentDesk } = req.query;
    
    console.log(`🔍 Получение доступных мест для кабинета ${id}`);
    
    const classroom = await getClassroomById(id);
    if (!classroom) {
      return res.json({ success: false, error: 'Кабинет не найден' });
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
    res.json({ success: false, error: error.message });
  }
});

// ========== ПРЕДМЕТЫ ==========

app.get('/api/subjects', async (req, res) => {
  try {
    console.log('📖 Загрузка списка предметов');
    const subjects = await getSubjects();
    console.log(`✅ Загружено предметов: ${subjects.length}`);
    res.json({ success: true, subjects });
  } catch (error) {
    console.error('❌ Ошибка загрузки предметов:', error);
    res.json({ success: false, error: error.message });
  }
});

// ========== HEALTH CHECK ==========

app.get('/api/health', async (req, res) => {
  try {
    await healthCheck();
    res.json({ 
      success: true, 
      status: 'OK', 
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({ 
      success: false, 
      status: 'ERROR', 
      database: 'disconnected',
      error: error.message 
    });
  }
});

// ========== ERROR HANDLING ==========

// Обработка 404 - Страница не найдена
app.use((req, res) => {
  console.log(`❌ Страница не найдена: ${req.method} ${req.url}`);
  
  // Если это API запрос, возвращаем JSON
  if (req.url.startsWith('/api/')) {
    return res.status(404).json({
      success: false,
      error: 'Страница не найдена'
    });
  }
  
  // Для обычных запросов рендерим страницу ошибки
  res.status(404).render('error', { 
    message: 'Страница не найдена' 
  });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('❌ Необработанная ошибка:', err);
  
  // Если это API запрос, возвращаем JSON
  if (req.url.startsWith('/api/')) {
    return res.status(500).json({
      success: false,
      error: 'Внутренняя ошибка сервера',
      message: process.env.NODE_ENV === 'development' ? err.message : 'Произошла внутренняя ошибка'
    });
  }
  
  // Для обычных запросов рендерим страницу ошибки
  res.status(500).render('error', { 
    message: 'Внутренняя ошибка сервера',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

// ========== SERVER STARTUP ==========

app.listen(port, async () => {
  try {
    await initializeDatabase();
    await initializeExistingClassroomTables();
    console.log(`🚀 Сервер запущен на порту ${port}`);
    console.log(`📊 База данных: ${process.env.PG_HOST}:${process.env.PG_PORT}/${process.env.PG_DATABASE}`);
    console.log(`🌐 Доступно по адресу: http://localhost:${port}`);
    console.log(`❤️  Проверка здоровья: http://localhost:${port}/api/health`);
  } catch (error) {
    console.error('❌ Ошибка запуска сервера:', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Получен SIGINT, завершение работы...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Получен SIGTERM, завершение работы...');
  await pool.end();
  process.exit(0);
});