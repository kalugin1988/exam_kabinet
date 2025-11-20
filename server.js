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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware для логирования
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Цвета для параллелей
const parallelColors = {
  '1': '#FF6B6B', '2': '#4ECDC4', '3': '#45B7D1', '4': '#96CEB4', '5': '#FFEAA7',
  '6': '#DDA0DD', '7': '#98D8C8', '8': '#F7DC6F', '9': '#BB8FCE', '10': '#85C1E9', '11': '#F8C471'
};

// Вспомогательные функции
function generateTableName(subject) {
  return `subject_${subject.toLowerCase().replace(/\s+/g, '_')}`;
}

async function importStudentsFromSubjectTable(students, subject) {
  console.log(`Импорт учеников в основную таблицу Ученики для предмета: ${subject}`);
  
  try {
    // Очищаем старые данные для этого предмета
    await pool.query('DELETE FROM Ученики WHERE предмет = $1', [subject]);
    console.log(`Очищены старые данные для предмета: ${subject}`);
    
    // Импортируем новых учеников
    let importedCount = 0;
    for (const student of students) {
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
        importedCount++;
      }
    }
    
    console.log(`Успешно импортировано ${importedCount} учеников в таблицу Ученики`);
    return true;
  } catch (error) {
    console.error('Ошибка импорта учеников:', error);
    return false;
  }
}

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
        заблокировано BOOLEAN DEFAULT FALSE,
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
    await populateClassroomTable(classroomNumber, tableName);
    
    return true;
  } catch (error) {
    console.error(`Ошибка создания таблицы кабинета ${classroomNumber}:`, error);
    return false;
  }
}

async function populateClassroomTable(classroomNumber, tableName) {
  try {
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
    
    await pool.query(`DELETE FROM ${tableName}`);
    
    const desksPerRow = Math.ceil(totalDesks / rows);
    console.log(`  Парт в одном ряду: ${desksPerRow}`);
    
    let deskCounter = 0;
    
    for (let row = 1; row <= rows; row++) {
      const rowLetterIndex = (row - 1) * 2;
      
      if (rowLetterIndex >= russianLetters.length - 1) {
        console.log(`  ⚠️ Превышен лимит букв для рядов`);
        break;
      }
      
      const leftLetter = russianLetters[rowLetterIndex];
      const rightLetter = russianLetters[rowLetterIndex + 1];
      
      for (let deskInRow = 1; deskInRow <= desksPerRow; deskInRow++) {
        deskCounter++;
        
        if (deskCounter > totalDesks) break;
        
        const deskNumber = deskInRow;
        const placeLeft = `${deskNumber}${leftLetter}`;
        const placeRight = `${deskNumber}${rightLetter}`;
        
        await pool.query(
          `INSERT INTO ${tableName} (номер_места, номер_парты, буква_места) VALUES ($1, $2, $3)`,
          [placeLeft, deskNumber, leftLetter]
        );
        
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

async function initializeExistingClassroomTables() {
  try {
    console.log('Проверка таблиц существующих кабинетов...');
    
    const classrooms = await pool.query('SELECT номер_кабинета FROM Кабинеты ORDER BY номер_кабинета');
    
    for (const classroom of classrooms.rows) {
      const tableName = `kabinet_${classroom.номер_кабинета}`;
      
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
      } else {
        console.log(`Таблица ${tableName} уже существует`);
        // Добавляем колонку заблокировано если её нет
        try {
          await pool.query(`
            ALTER TABLE ${tableName} 
            ADD COLUMN IF NOT EXISTS заблокировано BOOLEAN DEFAULT FALSE
          `);
          console.log(`Колонка 'заблокировано' добавлена в таблицу ${tableName}`);
        } catch (alterError) {
          console.log(`Колонка 'заблокировано' уже существует в таблице ${tableName}`);
        }
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

    // Создание таблицы предметов
    await pool.query(`
      CREATE TABLE IF NOT EXISTS id_subject (
        id SERIAL PRIMARY KEY,
        subject VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Создание таблицы для конфигурации рядов
    await pool.query(`
      CREATE TABLE IF NOT EXISTS classroom_layouts (
        classroom_id INTEGER PRIMARY KEY,
        row_mapping JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('База данных инициализирована');
  } catch (error) {
    console.error('Ошибка инициализации базы данных:', error);
  }
}

// Функция проверки правил размещения
function checkPlacementRules(student, classroomNumber, placeNumber, classmates) {
  const place = placeNumber;
  const placeDesk = parseInt(place.slice(0, -1)); // номер парты
  const placeLetter = place.slice(-1); // буква места
  
  const russianLetters = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К', 'Л', 'М'];
  const currentLetterIndex = russianLetters.indexOf(placeLetter);
  
  if (currentLetterIndex < 0) return false;
  
  // Находим запрещенные соседние места
  const forbiddenPlaces = [];
  
  // 1. ЗАПРЕЩЕНО: Место в той же парте (сосед слева/справа)
  if (currentLetterIndex % 2 === 0) {
    // Левое место (А, В, Г...) - проверяем правое
    if (currentLetterIndex + 1 < russianLetters.length) {
      forbiddenPlaces.push(`${placeDesk}${russianLetters[currentLetterIndex + 1]}`);
    }
  } else {
    // Правое место (Б, Д, Е...) - проверяем левое
    if (currentLetterIndex - 1 >= 0) {
      forbiddenPlaces.push(`${placeDesk}${russianLetters[currentLetterIndex - 1]}`);
    }
  }
  
  // 2. ЗАПРЕЩЕНО: Место прямо перед текущим (в предыдущем ряду с той же буквой)
  if (placeDesk > 1) {
    forbiddenPlaces.push(`${placeDesk - 1}${placeLetter}`);
  }
  
  // 3. ЗАПРЕЩЕНО: Место прямо за текущим (в следующем ряду с той же буквой)
  if (placeDesk < 10) {
    forbiddenPlaces.push(`${placeDesk + 1}${placeLetter}`);
  }
  
  // Проверяем все запрещенные места на наличие учеников из той же параллели
  for (const forbiddenPlace of forbiddenPlaces) {
    const adjacentStudent = classmates.find(s => s.номер_места === forbiddenPlace);
    if (adjacentStudent && adjacentStudent.паралель === student.паралель) {
      console.log(`Запрещенное соседство: место ${place} рядом с ${forbiddenPlace} (${adjacentStudent.фимилия})`);
      return false;
    }
  }
  
  return true;
}

// Маршруты

// Главная страница
app.get('/', async (req, res) => {
  try {
    const classrooms = await pool.query('SELECT * FROM Кабинеты ORDER BY номер_кабинета');
    const students = await pool.query('SELECT * FROM Ученики ORDER BY паралель, фимилия');
    
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
    
    if (oldClassroomNumber && oldClassroomNumber !== номер_кабинета) {
      const oldTableName = `kabinet_${oldClassroomNumber}`;
      const newTableName = `kabinet_${номер_кабинета}`;
      
      try {
        await pool.query(`ALTER TABLE ${oldTableName} RENAME TO ${newTableName}`);
        console.log(`Таблица переименована: ${oldTableName} -> ${newTableName}`);
        await populateClassroomTable(номер_кабинета, newTableName);
      } catch (error) {
        console.error(`Ошибка переименования таблицы:`, error);
        await createClassroomTable(номер_кабинета);
      }
    } else {
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
    
    const classroomResult = await pool.query(
      'SELECT номер_кабинета FROM Кабинеты WHERE id = $1',
      [id]
    );
    
    const classroomNumber = classroomResult.rows[0]?.номер_кабинета;
    
    await pool.query('DELETE FROM Кабинеты WHERE id = $1', [id]);
    
    console.log(`Кабинет удален: ID=${id}`);
    
    if (classroomNumber) {
      const tableName = `kabinet_${classroomNumber}`;
      try {
        await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
        console.log(`Таблица кабинета удалена: ${tableName}`);
      } catch (error) {
        console.error(`Ошибка удаления таблицы кабинета ${tableName}:`, error);
      }
      
      // Удаляем конфигурацию рядов
      await pool.query('DELETE FROM classroom_layouts WHERE classroom_id = $1', [id]);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка удаления кабинета:', error);
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

// API для получения всех учеников
app.get('/api/students', async (req, res) => {
  try {
    console.log('Загрузка всех учеников');
    
    const students = await pool.query('SELECT * FROM Ученики ORDER BY паралель, фимилия');
    
    console.log(`Загружено учеников: ${students.rows.length}`);
    
    res.json({ success: true, students: students.rows });
  } catch (error) {
    console.error('Ошибка загрузки учеников:', error);
    res.json({ success: false, error: error.message });
  }
});

// API для получения всех учеников без мест
app.get('/api/students/unplaced', async (req, res) => {
  try {
    console.log('Загрузка учеников без мест');
    
    const students = await pool.query(
      'SELECT * FROM Ученики WHERE номер_кабинета IS NULL OR номер_места IS NULL ORDER BY паралель, фимилия'
    );
    
    console.log(`Загружено учеников без мест: ${students.rows.length}`);
    
    res.json({ success: true, students: students.rows });
  } catch (error) {
    console.error('Ошибка загрузки учеников без мест:', error);
    res.json({ success: false, error: error.message });
  }
});

// API для проверки возможности размещения ученика
app.post('/api/check-placement', async (req, res) => {
  try {
    const { studentId, classroomNumber, placeNumber } = req.body;
    
    console.log(`Проверка возможности размещения: studentId=${studentId}, classroom=${classroomNumber}, place=${placeNumber}`);
    
    // Получаем информацию об ученике
    const studentResult = await pool.query(
      'SELECT * FROM Ученики WHERE id = $1',
      [studentId]
    );
    
    if (studentResult.rows.length === 0) {
      return res.json({ success: false, error: 'Ученик не найден' });
    }
    
    const student = studentResult.rows[0];
    
    // Проверяем, что место не заблокировано
    const tableName = `kabinet_${classroomNumber}`;
    const placeResult = await pool.query(
      `SELECT заблокировано FROM ${tableName} WHERE номер_места = $1`,
      [placeNumber]
    );
    
    if (placeResult.rows.length > 0 && placeResult.rows[0].заблокировано) {
      return res.json({ 
        success: false, 
        error: 'Место заблокировано и недоступно для размещения',
        canPlace: false 
      });
    }
    
    // Проверяем, что место свободно
    const occupiedResult = await pool.query(
      'SELECT * FROM Ученики WHERE номер_кабинета = $1 AND номер_места = $2 AND id != $3',
      [classroomNumber, placeNumber, studentId]
    );
    
    if (occupiedResult.rows.length > 0) {
      return res.json({ 
        success: false, 
        error: 'Место уже занято другим учеником',
        canPlace: false 
      });
    }
    
    // Получаем всех учеников в этом кабинете
    const classmatesResult = await pool.query(
      'SELECT * FROM Ученики WHERE номер_кабинета = $1 AND id != $2',
      [classroomNumber, studentId]
    );
    
    const classmates = classmatesResult.rows;
    
    // Проверяем правила соседства
    const canPlace = checkPlacementRules(student, classroomNumber, placeNumber, classmates);
    
    if (canPlace) {
      res.json({ 
        success: true, 
        canPlace: true,
        message: 'Ученик может быть размещен на этом месте'
      });
    } else {
      res.json({ 
        success: false, 
        canPlace: false,
        error: 'Невозможно разместить ученика: нарушены правила соседства (рядом находится ученик из той же параллели)'
      });
    }
    
  } catch (error) {
    console.error('Ошибка проверки размещения:', error);
    res.json({ success: false, error: error.message });
  }
});

// API для получения всех свободных мест
app.get('/api/classrooms/:id/free-places', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`Получение свободных мест для кабинета ID=${id}`);
    
    const classroomResult = await pool.query(
      'SELECT номер_кабинета FROM Кабинеты WHERE id = $1',
      [id]
    );
    
    if (classroomResult.rows.length === 0) {
      return res.json({ success: false, error: 'Кабинет не найден' });
    }
    
    const classroomNumber = classroomResult.rows[0].номер_кабинета;
    
    // Получаем все места кабинета
    const tableName = `kabinet_${classroomNumber}`;
    const allPlacesResult = await pool.query(`SELECT номер_места, заблокировано FROM ${tableName} ORDER BY номер_парты, буква_места`);
    const allPlaces = allPlacesResult.rows.map(row => ({
      номер_места: row.номер_места,
      заблокировано: row.заблокировано
    }));
    
    // Получаем занятые места
    const occupiedResult = await pool.query(
      'SELECT номер_места FROM Ученики WHERE номер_кабинета = $1 AND номер_места IS NOT NULL',
      [classroomNumber]
    );
    
    const occupiedPlaces = occupiedResult.rows.map(row => row.номер_места);
    
    // Находим свободные места (не заблокированные и не занятые)
    const freePlaces = allPlaces
      .filter(place => !place.заблокировано && !occupiedPlaces.includes(place.номер_места))
      .map(place => place.номер_места);
    
    // Находим заблокированные места
    const blockedPlaces = allPlaces
      .filter(place => place.заблокировано)
      .map(place => place.номер_места);
    
    console.log(`Свободных мест в кабинете ${classroomNumber}: ${freePlaces.length}`);
    console.log(`Заблокированных мест в кабинете ${classroomNumber}: ${blockedPlaces.length}`);
    
    res.json({ 
      success: true, 
      freePlaces,
      blockedPlaces,
      totalPlaces: allPlaces.length,
      occupiedPlaces: occupiedPlaces.length
    });
  } catch (error) {
    console.error('Ошибка получения свободных мест:', error);
    res.json({ success: false, error: error.message });
  }
});

// API для блокировки/разблокировки места
app.put('/api/classrooms/:id/block-place', async (req, res) => {
  try {
    const { id } = req.params;
    const { placeNumber, blocked } = req.body;
    
    console.log(`${blocked ? 'Блокировка' : 'Разблокировка'} места: кабинет ID=${id}, место=${placeNumber}`);
    
    const classroomResult = await pool.query(
      'SELECT номер_кабинета FROM Кабинеты WHERE id = $1',
      [id]
    );
    
    if (classroomResult.rows.length === 0) {
      return res.json({ success: false, error: 'Кабинет не найден' });
    }
    
    const classroomNumber = classroomResult.rows[0].номер_кабинета;
    const tableName = `kabinet_${classroomNumber}`;
    
    // Проверяем существование места
    const placeResult = await pool.query(
      `SELECT номер_места FROM ${tableName} WHERE номер_места = $1`,
      [placeNumber]
    );
    
    if (placeResult.rows.length === 0) {
      return res.json({ success: false, error: 'Место не найдено' });
    }
    
    // Обновляем статус блокировки
    await pool.query(
      `UPDATE ${tableName} SET заблокировано = $1 WHERE номер_места = $2`,
      [blocked, placeNumber]
    );
    
    console.log(`Место ${placeNumber} ${blocked ? 'заблокировано' : 'разблокировано'}`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка блокировки места:', error);
    res.json({ success: false, error: error.message });
  }
});

// API для получения заблокированных мест
app.get('/api/classrooms/:id/blocked-places', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`Получение заблокированных мест для кабинета ID=${id}`);
    
    const classroomResult = await pool.query(
      'SELECT номер_кабинета FROM Кабинеты WHERE id = $1',
      [id]
    );
    
    if (classroomResult.rows.length === 0) {
      return res.json({ success: false, error: 'Кабинет не найден' });
    }
    
    const classroomNumber = classroomResult.rows[0].номер_кабинета;
    const tableName = `kabinet_${classroomNumber}`;
    
    const blockedResult = await pool.query(
      `SELECT номер_места FROM ${tableName} WHERE заблокировано = true ORDER BY номер_парты, буква_места`
    );
    
    const blockedPlaces = blockedResult.rows.map(row => row.номер_места);
    
    console.log(`Заблокированных мест в кабинете ${classroomNumber}: ${blockedPlaces.length}`);
    
    res.json({ 
      success: true, 
      blockedPlaces,
      count: blockedPlaces.length
    });
  } catch (error) {
    console.error('Ошибка получения заблокированных мест:', error);
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
    
    if (!subject) {
      return res.json({ success: false, error: 'Не указан предмет' });
    }
    
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
        const importSuccess = await importStudentsFromSubjectTable(students, subject);
        if (!importSuccess) {
          const errorMsg = 'Ошибка импорта учеников в основную таблицу';
          log(`❌ ${errorMsg}`);
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
      return res.json({ 
        success: false, 
        error: `Нет учеников для предмета "${subject}". Проверьте таблицу: ${tableName}` 
      });
    }
    
    const actualStudents = await pool.query(
      'SELECT * FROM Ученики WHERE предмет = $1 ORDER BY паралель, фимилия',
      [subject]
    );
    
    log(`Актуальные данные из таблицы Ученики: ${actualStudents.rows.length} записей`);
    
    const classrooms = await pool.query('SELECT * FROM Кабинеты ORDER BY номер_кабинета');
    log(`Загружено кабинетов: ${classrooms.rows.length}`);
    
    // Получаем информацию о заблокированных местах для каждого кабинета
    const blockedPlacesByClassroom = {};
    for (const classroom of classrooms.rows) {
      const tableName = `kabinet_${classroom.номер_кабинета}`;
      const blockedResult = await pool.query(
        `SELECT номер_места FROM ${tableName} WHERE заблокировано = true`
      );
      blockedPlacesByClassroom[classroom.номер_кабинета] = blockedResult.rows.map(row => row.номер_места);
      log(`Кабинет ${classroom.номер_кабинета}: ${blockedResult.rows.length} заблокированных мест`);
    }
    
    const result = generateSeating(actualStudents.rows, classrooms.rows, blockedPlacesByClassroom, log);
    const seating = result.seating;
    const unplacedStudents = result.unplacedStudents;
    
    log(`Сформировано размещений: ${seating.length}`);
    log(`Не размещено учеников: ${unplacedStudents.length}`);
    
    log('Обновляем места в базе данных...');
    for (const assignment of seating) {
      await pool.query(
        'UPDATE Ученики SET номер_кабинета = $1, номер_места = $2 WHERE id = $3',
        [assignment.classroom, assignment.place, assignment.studentId]
      );
    }
    log('Места обновлены в базе данных');
    
    log(`=== ЗАВЕРШЕНО ФОРМИРОВАНИЯ ПОСАДКИ ДЛЯ ПРЕДМЕТА: ${subject} ===`);
    
    res.json({ 
      success: true, 
      seating: seating,
      unplacedStudents: unplacedStudents,
      stats: {
        studentsCount: actualStudents.rows.length,
        seatingCount: seating.length,
        unplacedCount: unplacedStudents.length,
        source: studentsSource
      }
    });
  } catch (error) {
    console.error('Ошибка формирования посадки:', error);
    res.json({ success: false, error: error.message });
  }
});

// API для очистки посадки
app.post('/api/clear-seating', async (req, res) => {
  try {
    console.log('Очистка всех мест учеников');
    
    await pool.query('UPDATE Ученики SET номер_кабинета = NULL, номер_места = NULL');
    
    console.log('Все места учеников очищены');
    
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка очистки мест учеников:', error);
    res.json({ success: false, error: error.message });
  }
});

// API для полной очистки всех данных
app.post('/api/clear-all-data', async (req, res) => {
  try {
    console.log('Полная очистка всех данных учеников');
    
    await pool.query('DELETE FROM Ученики');
    
    console.log('Все данные учеников удалены');
    
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка очистки всех данных:', error);
    res.json({ success: false, error: error.message });
  }
});

// API для экспорта посадки в JSON
app.get('/api/export-seating', async (req, res) => {
  try {
    console.log('Экспорт данных о посадке в JSON');
    
    const students = await pool.query(`
      SELECT 
        Ученики.id,
        Ученики.фимилия,
        Ученики.имя,
        Ученики.отчество,
        Ученики.паралель,
        Ученики.предмет,
        Ученики.номер_кабинета,
        Ученики.номер_места,
        Кабинеты.этаж,
        Ученики.дата_последнего_изменения
      FROM Ученики 
      LEFT JOIN Кабинеты ON Ученики.номер_кабинета = Кабинеты.номер_кабинета
      WHERE Ученики.номер_кабинета IS NOT NULL 
      AND Ученики.номер_места IS NOT NULL
      ORDER BY Ученики.паралель, Ученики.фимилия
    `);
    
    console.log(`Экспортируется ${students.rows.length} учеников с местами`);
    
    const data = {
      exportDate: new Date().toISOString(),
      exportInfo: {
        system: 'Seating Arrangement System',
        version: '1.0',
        totalStudents: students.rows.length
      },
      students: students.rows
    };
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `seating_export_${timestamp}.json`;
    const filePath = path.join(__dirname, filename);
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    
    console.log(`Файл экспорта создан: ${filename}`);
    
    res.download(filePath, `seating_export.json`, (err) => {
      setTimeout(() => {
        try {
          fs.unlinkSync(filePath);
          console.log(`Временный файл удален: ${filename}`);
        } catch (unlinkError) {
          console.error('Ошибка удаления временного файла:', unlinkError);
        }
      }, 1000);
    });
    
  } catch (error) {
    console.error('Ошибка экспорта:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка экспорта: ' + error.message 
    });
  }
});

// API для импорта посадки из JSON
app.post('/api/import-seating', async (req, res) => {
  try {
    console.log('Начало импорта данных...');
    
    if (!req.body || !req.body.data) {
      return res.json({ success: false, error: 'Нет данных для импорта' });
    }

    const { students } = req.body.data;
    
    if (!students || !Array.isArray(students)) {
      return res.json({ success: false, error: 'Неверный формат данных: ожидается массив students' });
    }

    console.log(`Импорт данных о посадке из JSON: ${students.length} учеников`);

    let successCount = 0;
    let errorCount = 0;

    // Очищаем ВСЕ данные и вставляем заново
    await pool.query('DELETE FROM Ученики');

    for (const student of students) {
      try {
        // Проверяем обязательные поля
        if (!student.фимилия || !student.имя || !student.паралель || !student.предмет) {
          console.warn(`Пропущен ученик с неполными данными:`, student);
          errorCount++;
          continue;
        }

        // Вставляем ученика с сохранением ID если есть
        if (student.id) {
          await pool.query(
            `INSERT INTO Ученики (id, фимилия, имя, отчество, паралель, предмет, номер_кабинета, номер_места) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              student.id,
              student.фимилия,
              student.имя,
              student.отчество || '',
              student.паралель,
              student.предмет,
              student.номер_кабинета,
              student.номер_места
            ]
          );
        } else {
          await pool.query(
            `INSERT INTO Ученики (фимилия, имя, отчество, паралель, предмет, номер_кабинета, номер_места) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              student.фимилия,
              student.имя,
              student.отчество || '',
              student.паралель,
              student.предмет,
              student.номер_кабинета,
              student.номер_места
            ]
          );
        }
        successCount++;
      } catch (error) {
        console.error(`Ошибка импорта ученика:`, student, error);
        errorCount++;
      }
    }

    console.log(`Импорт завершен: успешно ${successCount}, ошибок ${errorCount}`);

    res.json({ 
      success: true, 
      stats: {
        total: students.length,
        success: successCount,
        errors: errorCount
      }
    });
  } catch (error) {
    console.error('Ошибка импорта:', error);
    res.json({ success: false, error: error.message });
  }
});

// API для работы с конфигурацией рядов
app.put('/api/classrooms/:id/layout', async (req, res) => {
  try {
    const { id } = req.params;
    const { row_mapping } = req.body;
    
    console.log(`Обновление конфигурации кабинета ID=${id}:`, row_mapping);
    
    await pool.query(`
      INSERT INTO classroom_layouts (classroom_id, row_mapping) 
      VALUES ($1, $2)
      ON CONFLICT (classroom_id) 
      DO UPDATE SET row_mapping = $2, updated_at = CURRENT_TIMESTAMP
    `, [id, JSON.stringify(row_mapping)]);
    
    console.log(`Конфигурация кабинета ${id} обновлена`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка обновления конфигурации кабинета:', error);
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/classrooms/:id/layout', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`Загрузка конфигурации кабинета ID=${id}`);
    
    const result = await pool.query(
      'SELECT row_mapping FROM classroom_layouts WHERE classroom_id = $1',
      [id]
    );
    
    if (result.rows.length > 0) {
      res.json({ success: true, row_mapping: result.rows[0].row_mapping });
    } else {
      res.json({ success: true, row_mapping: null });
    }
  } catch (error) {
    console.error('Ошибка загрузки конфигурации кабинета:', error);
    res.json({ success: false, error: error.message });
  }
});

app.delete('/api/classrooms/:id/layout', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`Удаление конфигурации кабинета ID=${id}`);
    
    await pool.query(
      'DELETE FROM classroom_layouts WHERE classroom_id = $1',
      [id]
    );
    
    console.log(`Конфигурация кабинета ${id} удалена`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка удаления конфигурации кабинета:', error);
    res.json({ success: false, error: error.message });
  }
});

// API для перемещения парты
app.put('/api/classrooms/:id/move-desk', async (req, res) => {
  try {
    const { id } = req.params;
    const { fromRow, fromDesk, toRow, toDesk } = req.body;
    
    console.log(`Перемещение парты в кабинете ${id}: из ряда ${fromRow} парта ${fromDesk} -> в ряд ${toRow} парта ${toDesk}`);
    
    // Получаем номер кабинета
    const classroomResult = await pool.query(
      'SELECT номер_кабинета FROM Кабинеты WHERE id = $1',
      [id]
    );
    
    if (classroomResult.rows.length === 0) {
      return res.json({ success: false, error: 'Кабинет не найден' });
    }
    
    const classroomNumber = classroomResult.rows[0].номер_кабинета;
    
    // Обновляем места у учеников
    const russianLetters = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К', 'Л', 'М'];
    const fromLeftLetter = russianLetters[(fromRow - 1) * 2];
    const fromRightLetter = russianLetters[(fromRow - 1) * 2 + 1];
    const toLeftLetter = russianLetters[(toRow - 1) * 2];
    const toRightLetter = russianLetters[(toRow - 1) * 2 + 1];
    
    const fromPlaceLeft = `${fromDesk}${fromLeftLetter}`;
    const fromPlaceRight = `${fromDesk}${fromRightLetter}`;
    const toPlaceLeft = `${toDesk}${toLeftLetter}`;
    const toPlaceRight = `${toDesk}${toRightLetter}`;
    
    // Обновляем места у учеников
    await pool.query(
      'UPDATE Ученики SET номер_места = $1 WHERE номер_кабинета = $2 AND номер_места = $3',
      [toPlaceLeft, classroomNumber, fromPlaceLeft]
    );
    
    await pool.query(
      'UPDATE Ученики SET номер_места = $1 WHERE номер_кабинета = $2 AND номер_места = $3',
      [toPlaceRight, classroomNumber, fromPlaceRight]
    );
    
    console.log(`Парта перемещена: ${fromPlaceLeft}/${fromPlaceRight} -> ${toPlaceLeft}/${toPlaceRight}`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка перемещения парты:', error);
    res.json({ success: false, error: error.message });
  }
});

// API для получения доступных мест для перемещения
app.get('/api/classrooms/:id/available-desks', async (req, res) => {
  try {
    const { id } = req.params;
    const { currentRow, currentDesk } = req.query;
    
    console.log(`Получение доступных мест для перемещения в кабинете ${id}, текущее: ряд ${currentRow}, парта ${currentDesk}`);
    
    const classroomResult = await pool.query(
      'SELECT номер_кабинета, количество_парт, количество_рядов_парт FROM Кабинеты WHERE id = $1',
      [id]
    );
    
    if (classroomResult.rows.length === 0) {
      return res.json({ success: false, error: 'Кабинет не найден' });
    }
    
    const classroom = classroomResult.rows[0];
    const availableDesks = [];
    
    // Генерируем все возможные места в кабинете
    const rows = classroom.количество_рядов_парт;
    const totalDesks = classroom.количество_парт;
    const desksPerRow = Math.ceil(totalDesks / rows);
    
    for (let row = 1; row <= rows; row++) {
      for (let desk = 1; desk <= desksPerRow; desk++) {
        // Пропускаем текущее место
        if (row == currentRow && desk == currentDesk) continue;
        
        // Проверяем, что парта существует (не превышает общее количество)
        const deskNumber = (row - 1) * desksPerRow + desk;
        if (deskNumber <= totalDesks) {
          availableDesks.push({
            row: row,
            desk: desk,
            display: `Ряд ${row}, Парта ${desk}`
          });
        }
      }
    }
    
    res.json({ success: true, availableDesks });
  } catch (error) {
    console.error('Ошибка получения доступных мест:', error);
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

// API для проверки здоровья
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
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

// Запуск сервера
app.listen(port, async () => {
  try {
    await initializeDatabase();
    await initializeExistingClassroomTables();
    console.log(`🚀 Сервер запущен на порту ${port}`);
    console.log(`📊 Подключение к базе данных: ${process.env.PG_HOST}:${process.env.PG_PORT}/${process.env.PG_DATABASE}`);
    console.log(`🌐 Доступно по адресу: http://localhost:${port}`);
    console.log(`❤️  Проверка здоровья: http://localhost:${port}/api/health`);
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