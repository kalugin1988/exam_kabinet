const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { generateSeating } = require('./algorithms/seatingAlgorithm');

const app = express();
const port = process.env.PORT || 3000;

// Настройка подключения к PostgreSQL
const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
});

// Middleware
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware для логирования
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Функция для записи лога в файл
function writeSeatingLog(subject, logData) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `seating_log_${subject}_${timestamp}.txt`;
    const logContent = `=== ЛОГ ФОРМИРОВАНИЯ ПОСАДКИ ===
Предмет: ${subject}
Время: ${new Date().toISOString()}
${logData}
=== КОНЕЦ ЛОГА ===
`;
    
    // fs.writeFileSync(filename, logContent, 'utf8');
    console.log(`Лог сохранен в файл: ${filename}`);
    return filename;
  } catch (error) {
    console.error('Ошибка записи лога:', error);
    return null;
  }
}

// Цвета для параллелей
const parallelColors = {
  '1': '#FF6B6B', '2': '#4ECDC4', '3': '#45B7D1', '4': '#96CEB4', '5': '#FFEAA7',
  '6': '#DDA0DD', '7': '#98D8C8', '8': '#F7DC6F', '9': '#BB8FCE', '10': '#85C1E9', '11': '#F8C471'
};

// Вспомогательные функции
function generateTableName(subject) {
  const tableName = `subject_${subject.toLowerCase().replace(/\s+/g, '_')}`;
  console.log(`Сгенерировано имя таблицы: ${tableName}`);
  return tableName;
}

async function importStudentsFromSubjectTable(students, subject) {
  console.log(`Импорт учеников в основную таблицу Ученики...`);
  
  try {
    // Очищаем старые данные для этого предмета
    await pool.query('DELETE FROM Ученики WHERE предмет = $1', [subject]);
    console.log(`Очищены старые данные для предмета: ${subject}`);
    
    // Импортируем новых учеников
    for (const student of students) {
      // Определяем поля в зависимости от структуры таблицы предмета
      const surname = student.surname || student.фимилия || student.last_name;
      const name = student.name || student.имя || student.first_name;
      const patronymic = student.patronymic || student.отчество || student.middle_name;
      const parallel = student.parallel || student.паралель || student.class;
      
      if (surname && name && parallel) {
        await pool.query(
          `INSERT INTO Ученики (фимилия, имя, отчество, паралель, предмет) 
           VALUES ($1, $2, $3, $4, $5)`,
          [surname, name, patronymic || '', parallel, subject]
        );
      }
    }
    
    console.log(`Успешно импортировано ${students.length} учеников в таблицу Ученики`);
    return true;
  } catch (error) {
    console.error('Ошибка импорта учеников:', error);
    return false;
  }
}

// Функция для создания таблицы кабинета
async function createClassroomTable(classroomNumber) {
  try {
    const tableName = `kabinet_${classroomNumber}`;
    
    console.log(`Создание таблицы кабинета: ${tableName}`);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id SERIAL PRIMARY KEY,
        номер_места VARCHAR(10) UNIQUE NOT NULL,
        номер_парты INTEGER NOT NULL,
        буква_места VARCHAR(1) NOT NULL,
        занято BOOLEAN DEFAULT FALSE,
        id_ученика INTEGER,
        фимилия_ученика VARCHAR(100),
        имя_ученика VARCHAR(100),
        отчество_ученика VARCHAR(100),
        паралель_ученика VARCHAR(10),
        предмет_ученика VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log(`Таблица ${tableName} создана или уже существует`);
    
    // Заполняем таблицу местами
    await populateClassroomTable(classroomNumber, tableName);
    
    return true;
  } catch (error) {
    console.error(`Ошибка создания таблицы кабинета ${classroomNumber}:`, error);
    return false;
  }
}

// Функция для заполнения таблицы кабинета местами
async function populateClassroomTable(classroomNumber, tableName) {
  try {
    // Получаем информацию о кабинете
    const classroomResult = await pool.query(
      'SELECT количество_парт, количество_рядов_парт FROM Кабинеты WHERE номер_кабинета = $1',
      [classroomNumber]
    );
    
    if (classroomResult.rows.length === 0) {
      console.error(`Кабинет ${classroomNumber} не найден`);
      return false;
    }
    
    const classroom = classroomResult.rows[0];
    const totalDesks = classroom.количество_парт;
    const rows = classroom.количество_рядов_парт;
    
    console.log(`Заполнение таблицы ${tableName}: ${totalDesks} парт, ${rows} рядов`);
    
    const russianLetters = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К', 'Л', 'М'];
    
    // Очищаем старые данные
    await pool.query(`DELETE FROM ${tableName}`);
    
    // Рассчитываем количество парт в одном ряду
    const desksPerRow = Math.ceil(totalDesks / rows);
    console.log(`  Парт в одном ряду: ${desksPerRow}`);
    
    // Создаем места для каждой парты
    let deskCounter = 0;
    
    for (let row = 1; row <= rows; row++) {
      const rowLetterIndex = (row - 1) * 2;
      const leftLetter = russianLetters[rowLetterIndex];
      const rightLetter = russianLetters[rowLetterIndex + 1];
      
      for (let deskInRow = 1; deskInRow <= desksPerRow; deskInRow++) {
        deskCounter++;
        
        if (deskCounter > totalDesks) break;
        
        // Номер парты теперь состоит из номера ряда и номера в ряду
        const deskNumber = deskInRow; // Номер парты в ряду (1, 2, 3...)
        const placeLeft = `${deskNumber}${leftLetter}`;
        const placeRight = `${deskNumber}${rightLetter}`;
        
        // Вставляем левое место
        await pool.query(
          `INSERT INTO ${tableName} (номер_места, номер_парты, буква_места) VALUES ($1, $2, $3)`,
          [placeLeft, deskNumber, leftLetter]
        );
        
        // Вставляем правое место
        await pool.query(
          `INSERT INTO ${tableName} (номер_места, номер_парты, буква_места) VALUES ($1, $2, $3)`,
          [placeRight, deskNumber, rightLetter]
        );
        
        console.log(`  Добавлены места: ${placeLeft}, ${placeRight} (парта ${deskNumber}, ряд ${row})`);
      }
      
      if (deskCounter >= totalDesks) break;
    }
    
    const countResult = await pool.query(`SELECT COUNT(*) FROM ${tableName}`);
    console.log(`Таблица ${tableName} заполнена: ${countResult.rows[0].count} мест`);
    
    return true;
  } catch (error) {
    console.error(`Ошибка заполнения таблицы кабинета ${classroomNumber}:`, error);
    return false;
  }
}

// Функция для создания таблиц для существующих кабинетов
async function initializeExistingClassroomTables() {
  try {
    console.log('Проверка таблиц существующих кабинетов...');
    
    const classrooms = await pool.query('SELECT номер_кабинета FROM Кабинеты ORDER BY номер_кабинета');
    
    for (const classroom of classrooms.rows) {
      const tableName = `kabinet_${classroom.номер_кабинета}`;
      
      // Проверяем существование таблицы
      const tableExists = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = $1
        )
      `, [tableName]);
      
      if (!tableExists.rows[0].exists) {
        console.log(`Создание таблицы для существующего кабинета: ${classroom.номер_кабинета}`);
        await createClassroomTable(classroom.номер_кабинета);
      }
    }
    
    console.log('Проверка таблиц кабинетов завершена');
  } catch (error) {
    console.error('Ошибка инициализации таблиц кабинетов:', error);
  }
}

async function initializeDatabase() {
  try {
    // Создание таблицы Кабинеты
    await pool.query(`
      CREATE TABLE IF NOT EXISTS Кабинеты (
        id SERIAL PRIMARY KEY,
        номер_кабинета INTEGER UNIQUE NOT NULL,
        количество_парт INTEGER NOT NULL,
        количество_рядов_парт INTEGER NOT NULL,
        этаж INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Создание таблицы Ученики
    await pool.query(`
      CREATE TABLE IF NOT EXISTS Ученики (
        id SERIAL PRIMARY KEY,
        фимилия VARCHAR(100) NOT NULL,
        имя VARCHAR(100) NOT NULL,
        отчество VARCHAR(100),
        паралель VARCHAR(10) NOT NULL,
        предмет VARCHAR(100) NOT NULL,
        номер_кабинета INTEGER,
        номер_места VARCHAR(10),
        дата_последнего_изменения TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Создание таблицы предметов если ее нет
    await pool.query(`
      CREATE TABLE IF NOT EXISTS id_subject (
        id SERIAL PRIMARY KEY,
        subject VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('База данных инициализирована');
  } catch (error) {
    console.error('Ошибка инициализации базы данных:', error);
  }
}

// Маршруты

// Главная страница
app.get('/', async (req, res) => {
  try {
    const classrooms = await pool.query('SELECT * FROM Кабинеты ORDER BY номер_кабинета');
    const students = await pool.query('SELECT * FROM Ученики');
    
    const subjectsResult = await pool.query('SELECT * FROM id_subject ORDER BY subject');
    const subjects = subjectsResult.rows.map(row => row.subject);
    
    console.log(`Загружено кабинетов: ${classrooms.rows.length}, учеников: ${students.rows.length}, предметов: ${subjects.length}`);
    
    res.render('index', { 
      classrooms: classrooms.rows,
      students: students.rows,
      subjects: subjects,
      parallelColors: parallelColors
    });
  } catch (error) {
    console.error('Ошибка загрузки данных:', error);
    res.status(500).send('Ошибка сервера');
  }
});

// Страница управления кабинетами
app.get('/kabinet', async (req, res) => {
  try {
    const classrooms = await pool.query('SELECT * FROM Кабинеты ORDER BY номер_кабинета');
    console.log(`Загружено кабинетов для управления: ${classrooms.rows.length}`);
    res.render('kabinet', { classrooms: classrooms.rows });
  } catch (error) {
    console.error('Ошибка загрузки кабинетов:', error);
    res.status(500).send('Ошибка сервера');
  }
});

// API для работы с кабинетами
app.post('/api/classrooms', async (req, res) => {
  try {
    const { номер_кабинета, количество_парт, количество_рядов_парт, этаж } = req.body;
    
    console.log(`Создание кабинета: номер=${номер_кабинета}, парт=${количество_парт}, рядов=${количество_рядов_парт}, этаж=${этаж}`);
    
    const result = await pool.query(
      'INSERT INTO Кабинеты (номер_кабинета, количество_парт, количество_рядов_парт, этаж) VALUES ($1, $2, $3, $4) RETURNING *',
      [номер_кабинета, количество_парт, количество_рядов_парт, этаж]
    );
    
    console.log(`Кабинет создан: ID=${result.rows[0].id}`);
    
    // Создаем таблицу для кабинета
    const tableCreated = await createClassroomTable(номер_кабинета);
    
    if (!tableCreated) {
      console.warn(`Не удалось создать таблицу для кабинета ${номер_кабинета}, но кабинет создан`);
    }
    
    res.json({ 
      success: true, 
      classroom: result.rows[0],
      tableCreated: tableCreated
    });
  } catch (error) {
    console.error('Ошибка создания кабинета:', error);
    res.json({ success: false, error: error.message });
  }
});

app.put('/api/classrooms/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { номер_кабинета, количество_парт, количество_рядов_парт, этаж } = req.body;
    
    console.log(`Обновление кабинета ID=${id}: номер=${номер_кабинета}, парт=${количество_парт}, рядов=${количество_рядов_парт}, этаж=${этаж}`);
    
    // Получаем старый номер кабинета для переименования таблицы
    const oldClassroomResult = await pool.query(
      'SELECT номер_кабинета FROM Кабинеты WHERE id = $1',
      [id]
    );
    
    const oldClassroomNumber = oldClassroomResult.rows[0]?.номер_кабинета;
    
    const result = await pool.query(
      'UPDATE Кабинеты SET номер_кабинета = $1, количество_парт = $2, количество_рядов_парт = $3, этаж = $4 WHERE id = $5 RETURNING *',
      [номер_кабинета, количество_парт, количество_рядов_парт, этаж, id]
    );
    
    console.log(`Кабинет обновлен: ID=${result.rows[0].id}`);
    
    // Если изменился номер кабинета, переименовываем таблицу
    if (oldClassroomNumber && oldClassroomNumber !== номер_кабинета) {
      const oldTableName = `kabinet_${oldClassroomNumber}`;
      const newTableName = `kabinet_${номер_кабинета}`;
      
      try {
        await pool.query(`ALTER TABLE ${oldTableName} RENAME TO ${newTableName}`);
        console.log(`Таблица переименована: ${oldTableName} -> ${newTableName}`);
        
        // Обновляем места в таблице согласно новой конфигурации
        await populateClassroomTable(номер_кабинета, newTableName);
      } catch (error) {
        console.error(`Ошибка переименования таблицы:`, error);
        // Если не удалось переименовать, создаем новую таблицу
        await createClassroomTable(номер_кабинета);
      }
    } else {
      // Обновляем места в таблице согласно новой конфигурации
      await populateClassroomTable(номер_кабинета, `kabinet_${номер_кабинета}`);
    }
    
    res.json({ success: true, classroom: result.rows[0] });
  } catch (error) {
    console.error('Ошибка обновления кабинета:', error);
    res.json({ success: false, error: error.message });
  }
});

app.delete('/api/classrooms/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`Удаление кабинета ID=${id}`);
    
    // Получаем номер кабинета для удаления таблицы
    const classroomResult = await pool.query(
      'SELECT номер_кабинета FROM Кабинеты WHERE id = $1',
      [id]
    );
    
    const classroomNumber = classroomResult.rows[0]?.номер_кабинета;
    
    // Удаляем кабинет
    await pool.query('DELETE FROM Кабинеты WHERE id = $1', [id]);
    
    console.log(`Кабинет удален: ID=${id}`);
    
    // Удаляем таблицу кабинета если она существует
    if (classroomNumber) {
      const tableName = `kabinet_${classroomNumber}`;
      try {
        await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
        console.log(`Таблица кабинета удалена: ${tableName}`);
      } catch (error) {
        console.error(`Ошибка удаления таблицы кабинета ${tableName}:`, error);
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка удаления кабинета:', error);
    res.json({ success: false, error: error.message });
  }
});

// API для получения информации о таблице кабинета
app.get('/api/classroom-table/:classroomNumber', async (req, res) => {
  try {
    const { classroomNumber } = req.params;
    const tableName = `kabinet_${classroomNumber}`;
    
    console.log(`Запрос таблицы кабинета: ${tableName}`);
    
    // Проверяем существование таблицы
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      )
    `, [tableName]);
    
    if (!tableExists.rows[0].exists) {
      return res.json({ success: false, error: `Таблица кабинета ${classroomNumber} не найдена` });
    }
    
    // Получаем данные из таблицы кабинета
    const places = await pool.query(`SELECT * FROM ${tableName} ORDER BY номер_парты, буква_места`);
    
    res.json({ 
      success: true, 
      classroomNumber: classroomNumber,
      places: places.rows,
      count: places.rows.length
    });
  } catch (error) {
    console.error('Ошибка загрузки таблицы кабинета:', error);
    res.json({ success: false, error: error.message });
  }
});

// API для работы с учениками
app.put('/api/students/place', async (req, res) => {
  try {
    const { studentId, classroomNumber, placeNumber } = req.body;
    
    console.log(`Обновление места ученика: studentId=${studentId}, classroom=${classroomNumber}, place=${placeNumber}`);
    
    await pool.query(
      'UPDATE Ученики SET номер_кабинета = $1, номер_места = $2, дата_последнего_изменения = CURRENT_TIMESTAMP WHERE id = $3',
      [classroomNumber, placeNumber, studentId]
    );
    
    console.log(`Место ученика обновлено: studentId=${studentId}`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка обновления места ученика:', error);
    res.json({ success: false, error: error.message });
  }
});

// API для формирования посадки
app.post('/api/generate-seating', async (req, res) => {
  let logData = '';
  const log = (message) => {
    console.log(message);
    logData += message + '\n';
  };
  
  try {
    const { subject } = req.body;
    
    log(`=== НАЧАЛО ФОРМИРОВАНИЯ ПОСАДКИ ДЛЯ ПРЕДМЕТА: ${subject} ===`);
    
    const tableName = generateTableName(subject);
    
    log(`Проверяем существование таблицы: ${tableName}`);
    
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
      log(`Таблица ${tableName} существует, загружаем учеников из нее`);
      students = await pool.query(`SELECT * FROM ${tableName}`);
      students = students.rows;
      studentsSource = tableName;
      
      if (students.length > 0) {
        log(`Структура данных из таблицы ${tableName}: ${Object.keys(students[0])}`);
        
        // Импортируем учеников в основную таблицу
        const importSuccess = await importStudentsFromSubjectTable(students, subject);
        if (!importSuccess) {
          const errorMsg = 'Ошибка импорта учеников в основную таблицу';
          log(`❌ ${errorMsg}`);
          writeSeatingLog(subject, logData);
          return res.json({ 
            success: false, 
            error: errorMsg
          });
        }
      }
    } else {
      log(`Таблица ${tableName} не существует, загружаем учеников из таблицы Ученики с фильтром по предмету`);
      students = await pool.query(
        'SELECT * FROM Ученики WHERE предмет = $1 ORDER BY паралель, фимилия',
        [subject]
      );
      students = students.rows;
      studentsSource = 'Ученики (фильтр по предмету)';
    }
    
    log(`Загружено учеников из ${studentsSource}: ${students.length}`);
    
    if (students.length === 0) {
      log(`ВНИМАНИЕ: Нет учеников для предмета "${subject}"`);
      log(`Проверьте таблицу: ${tableName}`);
      writeSeatingLog(subject, logData);
      return res.json({ 
        success: false, 
        error: `Нет учеников для предмета "${subject}". Проверьте таблицу: ${tableName}` 
      });
    }
    
    // Загружаем актуальные данные из таблицы Ученики после импорта
    const actualStudents = await pool.query(
      'SELECT * FROM Ученики WHERE предмет = $1 ORDER BY паралель, фимилия',
      [subject]
    );
    
    log(`Актуальные данные из таблицы Ученики: ${actualStudents.rows.length} записей`);
    
    // Логируем информацию о загруженных учениках
    log('Загруженные ученики:');
    actualStudents.rows.forEach((student, index) => {
      log(`  ${index + 1}: ${student.фимилия} ${student.имя}, параллель: ${student.паралель}`);
    });
    
    const classrooms = await pool.query('SELECT * FROM Кабинеты ORDER BY номер_кабинета');
    log(`Загружено кабинетов: ${classrooms.rows.length}`);
    
    classrooms.rows.forEach(classroom => {
      log(`Кабинет ${classroom.номер_кабинета}: ${classroom.количество_парт} парт, ${classroom.количество_рядов_парт} рядов, этаж ${classroom.этаж}`);
    });
    
    // Используем алгоритм рассадки с актуальными данными и передаем функцию логирования
    const result = generateSeating(actualStudents.rows, classrooms.rows, log);
    const seating = result.seating;
    const unplacedStudents = result.unplacedStudents;
    
    log(`Сформировано размещений: ${seating.length}`);
    log(`Не размещено учеников: ${unplacedStudents.length}`);
    
    // Логируем размещения
    log('Размещения учеников:');
    seating.forEach(assignment => {
      const student = actualStudents.rows.find(s => s.id === assignment.studentId);
      if (student) {
        log(`  ${student.фимилия} ${student.имя} -> Кабинет ${assignment.classroom}, Место ${assignment.place}`);
      }
    });
    
    // Логируем неразмещенных учеников
    if (unplacedStudents.length > 0) {
      log('Неразмещенные ученики:');
      unplacedStudents.forEach((item, index) => {
        log(`  ${index + 1}: ${item.student.surname} ${item.student.name} (${item.parallel} класс)`);
      });
    }
    
    // Обновляем места в базе данных только для размещенных учеников
    log('Обновляем места в базе данных...');
    for (const assignment of seating) {
      await pool.query(
        'UPDATE Ученики SET номер_кабинета = $1, номер_места = $2 WHERE id = $3',
        [assignment.classroom, assignment.place, assignment.studentId]
      );
    }
    log('Места обновлены в базе данных');
    
    log(`=== ЗАВЕРШЕНО ФОРМИРОВАНИЯ ПОСАДКИ ДЛЯ ПРЕДМЕТА: ${subject} ===`);
    
    // Сохраняем лог в файл
    const logFilename = writeSeatingLog(subject, logData);
    
    res.json({ 
      success: true, 
      seating: seating,
      unplacedStudents: unplacedStudents,
      stats: {
        studentsCount: actualStudents.rows.length,
        seatingCount: seating.length,
        unplacedCount: unplacedStudents.length,
        source: studentsSource
      },
      logFile: logFilename
    });
  } catch (error) {
    log(`❌ Ошибка формирования посадки: ${error.message}`);
    writeSeatingLog('ERROR', logData);
    res.json({ success: false, error: error.message });
  }
});

// API для очистки посадки
app.post('/api/clear-seating', async (req, res) => {
  try {
    console.log('Полная очистка таблицы Ученики');
    
    // Удаляем ВСЕ данные из таблицы Ученики
    await pool.query('DELETE FROM Ученики');
    
    console.log('Все данные из таблицы Ученики удалены');
    
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка очистки таблицы Ученики:', error);
    res.json({ success: false, error: error.message });
  }
});

// API для экспорта посадки в JSON
app.get('/api/export-seating', async (req, res) => {
  try {
    console.log('Экспорт данных о посадке в JSON');
    
    const students = await pool.query(`
      SELECT Ученики.*, Кабинеты.этаж 
      FROM Ученики 
      LEFT JOIN Кабинеты ON Ученики.номер_кабинета = Кабинеты.номер_кабинета
      WHERE Ученики.номер_кабинета IS NOT NULL
    `);
    
    console.log(`Экспортируется ${students.rows.length} учеников с местами`);
    
    const data = {
      exportDate: new Date().toISOString(),
      students: students.rows
    };
    
    const filename = `seating_${Date.now()}.json`;
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
    
    console.log(`Файл экспорта создан: ${filename}`);
    
    res.download(filename, () => {
      setTimeout(() => {
        fs.unlinkSync(filename);
        console.log(`Временный файл удален: ${filename}`);
      }, 1000);
    });
  } catch (error) {
    console.error('Ошибка экспорта:', error);
    res.status(500).send('Ошибка экспорта');
  }
});

// API для импорта посадки из JSON
app.post('/api/import-seating', async (req, res) => {
  try {
    const { students } = req.body;
    
    console.log(`Импорт данных о посадке из JSON: ${students.length} учеников`);
    
    for (const student of students) {
      await pool.query(
        'UPDATE Ученики SET номер_кабинета = $1, номер_места = $2 WHERE id = $3',
        [student.номер_кабинета, student.номер_места, student.id]
      );
    }
    
    console.log('Импорт завершен успешно');
    
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка импорта:', error);
    res.json({ success: false, error: error.message });
  }
});

// API для получения списка предметов
app.get('/api/subjects', async (req, res) => {
  try {
    console.log('Загрузка списка предметов');
    
    const subjects = await pool.query('SELECT * FROM id_subject ORDER BY subject');
    
    console.log(`Загружено предметов: ${subjects.rows.length}`);
    
    res.json({ success: true, subjects: subjects.rows });
  } catch (error) {
    console.error('Ошибка загрузки предметов:', error);
    res.json({ success: false, error: error.message });
  }
});

// Запуск сервера
app.listen(port, async () => {
  try {
    await initializeDatabase();
    await initializeExistingClassroomTables();
    console.log(`🚀 Сервер запущен на порту ${port}`);
    console.log(`📊 Подключение к базе данных: ${process.env.PG_HOST}:${process.env.PG_PORT}/${process.env.PG_DATABASE}`);
    console.log(`🌐 Доступно по адресу: http://localhost:${port}`);
  } catch (error) {
    console.error('❌ Ошибка запуска сервера:', error);
    process.exit(1);
  }
});

// Обработка graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Получен сигнал SIGINT, завершение работы...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Получен сигнал SIGTERM, завершение работы...');
  await pool.end();
  process.exit(0);
});