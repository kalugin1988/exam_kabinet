const { pool, transaction, quoteIdentifier, tableExists, getTableColumns } = require('./src/database');

// Константы
const PARALLEL_COLORS = {
  '1': '#FF6B6B', '2': '#4ECDC4', '3': '#45B7D1', '4': '#96CEB4', '5': '#FFEAA7',
  '6': '#DDA0DD', '7': '#98D8C8', '8': '#F7DC6F', '9': '#BB8FCE', '10': '#85C1E9', '11': '#F8C471'
};

const RUSSIAN_LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К', 'Л', 'М'];

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

const generateTableName = (subject) => {
  return `subject_${String(subject).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_')}`;
};

const classroomTableName = (classroomNumber) => {
  if (!/^\d{1,9}$/.test(String(classroomNumber))) {
    const error = new Error('Неверный номер кабинета');
    error.status = 400;
    throw error;
  }
  return `kabinet_${classroomNumber}`;
};

const checkColumnExists = async (tableName, columnName) => {
  try {
    const columns = await getTableColumns(tableName);
    return columns.some(column => column.name === columnName);
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'checkColumnExists';
    throw error;
  }
};

const addColumnIfNotExists = async (tableName, columnName, dataType, defaultValue = '') => {
  try {
    const exists = await checkColumnExists(tableName, columnName);
    if (!exists) {
      // SQLite allows adding constant defaults, but not CURRENT_TIMESTAMP to
      // populated tables. Add and backfill that optional legacy timestamp instead.
      const timestampDefault = /DEFAULT CURRENT_TIMESTAMP/i.test(defaultValue);
      const supportedDefault = timestampDefault ? '' : defaultValue;
      await pool.query(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${dataType} ${supportedDefault}`);
      if (timestampDefault) {
        await pool.query(`UPDATE ${quoteIdentifier(tableName)} SET ${quoteIdentifier(columnName)} = CURRENT_TIMESTAMP WHERE ${quoteIdentifier(columnName)} IS NULL`);
      }
      console.log(`✅ Добавлено поле ${columnName} в таблицу ${tableName}`);
      return true;
    }
    return false;
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'addColumnIfNotExists';
    throw error;
  }
};

// ========== ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ ==========

const initializeSchoolsTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schools (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(500) NOT NULL,
        address VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Таблица schools инициализирована');
  } catch (error) {
    console.error('❌ Ошибка инициализации таблицы schools:', error);
    throw error;
  }
};

const initializeOOTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS oo (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code_omsu VARCHAR(50),
        code_oo VARCHAR(50),
        number_oo VARCHAR(50),
        name_oo VARCHAR(500),
        full_name VARCHAR(500) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Добавляем недостающие поля
    const columns = [
      { name: 'code_omsu', type: 'VARCHAR(50)' },
      { name: 'code_oo', type: 'VARCHAR(50)' },
      { name: 'number_oo', type: 'VARCHAR(50)' },
      { name: 'name_oo', type: 'VARCHAR(500)' },
      { name: 'full_name', type: 'VARCHAR(500)', defaultValue: "DEFAULT 'Образовательное учреждение'" },
      { name: 'updated_at', type: 'TIMESTAMP', defaultValue: 'DEFAULT CURRENT_TIMESTAMP' }
    ];

    for (const column of columns) {
      await addColumnIfNotExists('oo', column.name, column.type, column.defaultValue);
    }

    // Добавляем запись по умолчанию
    const recordsExist = await pool.query('SELECT COUNT(*) FROM oo');
    if (parseInt(recordsExist.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO oo (code_omsu, code_oo, number_oo, name_oo, full_name)
        VALUES ('0000', '000000', '001', 'Образовательное учреждение', 'Полное наименование образовательного учреждения')
      `);
      console.log('✅ Добавлена запись по умолчанию в таблицу oo');
    }

    console.log('✅ Таблица oo инициализирована');
  } catch (error) {
    console.error('❌ Ошибка инициализации таблицы oo:', error);
    throw error;
  }
};

const initializeDatabase = async () => {
  try {
    console.log('🔄 Инициализация базы данных...');

    // Таблица Кабинеты
    await pool.query(`
      CREATE TABLE IF NOT EXISTS Кабинеты (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        номер_кабинета INTEGER UNIQUE NOT NULL,
        количество_парт INTEGER NOT NULL,
        количество_рядов_парт INTEGER NOT NULL,
        этаж INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица Ученики
    await pool.query(`
      CREATE TABLE IF NOT EXISTS Ученики (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        фимилия VARCHAR(100) NOT NULL,
        имя VARCHAR(100) NOT NULL,
        отчество VARCHAR(100),
        паралель VARCHAR(10) NOT NULL,
        предмет VARCHAR(100) NOT NULL,
        номер_кабинета INTEGER,
        номер_места VARCHAR(10),
        school_code VARCHAR(50),
        school_name VARCHAR(500),
        school_number_oo VARCHAR(50),
        school_name_oo VARCHAR(500),
        participant_code VARCHAR(50),
        дата_последнего_изменения TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица предметов
    await pool.query(`
      CREATE TABLE IF NOT EXISTS id_subject (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица для конфигурации рядов
    await pool.query(`
      CREATE TABLE IF NOT EXISTS classroom_layouts (
        classroom_id INTEGER PRIMARY KEY,
        row_mapping TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Инициализация дополнительных таблиц
    await initializeOOTable();
    await initializeSchoolsTable();

    // Добавляем недостающие поля в таблицу Ученики
    const studentColumns = [
      { name: 'school_code', type: 'VARCHAR(50)' },
      { name: 'school_name', type: 'VARCHAR(500)' },
      { name: 'school_number_oo', type: 'VARCHAR(50)' },
      { name: 'school_name_oo', type: 'VARCHAR(500)' },
      { name: 'participant_code', type: 'VARCHAR(50)' }
    ];

    for (const column of studentColumns) {
      await addColumnIfNotExists('Ученики', column.name, column.type);
    }

    console.log('✅ База данных инициализирована');
  } catch (error) {
    console.error('❌ Ошибка инициализации базы данных:', error);
    throw error;
  }
};

// ========== ФУНКЦИИ ДЛЯ РАБОТЫ С УЧЕНИКАМИ ==========

const importStudentsFromSubjectTable = async (students, subject) => {
  try {
    return await transaction(async () => {
      console.log(`🔄 Импорт учеников для предмета: ${subject}`);

      await pool.query('DELETE FROM Ученики WHERE предмет = $1', [subject]);

      let importedCount = 0;
      for (const student of students) {
        const surname = student.surname || student.фимилия || student.last_name;
        const name = student.name || student.имя || student.first_name;
        const patronymic = student.patronymic || student.отчество || student.middle_name;
        const parallel = student.parallel || student.паралель || student.class;

        if (surname && name && parallel) {
          await pool.query(
            `INSERT INTO Ученики (
              фимилия, имя, отчество, паралель, предмет,
              school_code, school_name, school_number_oo, school_name_oo, participant_code
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              surname,
              name,
              patronymic || '',
              parallel,
              subject,
              student.school_code || '',
              student.school_name || '',
              student.school_number_oo || '',
              student.school_name_oo || '',
              student.participant_code || ''
            ]
          );
          importedCount++;
        }
      }

      console.log(`✅ Успешно импортировано ${importedCount} учеников`);
      return true;
    });
  } catch (error) {
    console.error('❌ Ошибка импорта учеников:', error);
    throw error;
  }
};

const updateStudentFields = async (studentId, studentData) => {
  try {
    const {
      school_code, school_name, school_number_oo, school_name_oo, participant_code
    } = studentData;

    await pool.query(
      `UPDATE Ученики SET
        school_code = COALESCE($1, school_code),
        school_name = COALESCE($2, school_name),
        school_number_oo = COALESCE($3, school_number_oo),
        school_name_oo = COALESCE($4, school_name_oo),
        participant_code = COALESCE($5, participant_code),
        дата_последнего_изменения = CURRENT_TIMESTAMP
       WHERE id = $6`,
      [
        school_code || null,
        school_name || null,
        school_number_oo || null,
        school_name_oo || null,
        participant_code || null,
        studentId
      ]
    );

    console.log(`✅ Обновлены поля ученика ID=${studentId}`);
    return true;
  } catch (error) {
    console.error(`❌ Ошибка обновления полей ученика ID=${studentId}:`, error);
    throw error;
  }
};

const updateStudentPlaceWithDetails = async (studentId, classroomNumber, placeNumber, studentData = {}) => {
  try {
    return await transaction(async () => {
      // Обновляем место
      await updateStudentPlace(studentId, classroomNumber, placeNumber);

      // Обновляем дополнительные поля, если они предоставлены
      if (Object.keys(studentData).length > 0) {
        await updateStudentFields(studentId, studentData);
      }

      return true;
    });
  } catch (error) {
    console.error(`❌ Ошибка обновления ученика ID=${studentId}:`, error);
    throw error;
  }
};

// ========== ФУНКЦИИ ДЛЯ РАБОТЫ С КАБИНЕТАМИ ==========

const createClassroomTable = async (classroomNumber) => {
  try {
    return await transaction(async () => {
      const tableName = classroomTableName(classroomNumber);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${quoteIdentifier(tableName)} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
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

      await populateClassroomTable(classroomNumber, tableName);
      return true;
    });
  } catch (error) {
    console.error(`❌ Ошибка создания таблицы кабинета ${classroomNumber}:`, error);
    throw error;
  }
};

const populateClassroomTable = async (classroomNumber, tableName) => {
  try {
    if (tableName !== classroomTableName(classroomNumber)) {
      const error = new Error('Неверная таблица кабинета');
      error.status = 400;
      throw error;
    }
    return await transaction(async () => {
      const classroomResult = await pool.query(
        'SELECT количество_парт, количество_рядов_парт FROM Кабинеты WHERE номер_кабинета = $1',
        [classroomNumber]
      );

      if (classroomResult.rows.length === 0) {
        const error = new Error(`Кабинет ${classroomNumber} не найден`);
        error.status = 404;
        throw error;
      }

      const classroom = classroomResult.rows[0];
      const totalDesks = classroom.количество_парт;
      const rows = classroom.количество_рядов_парт;

      await pool.query(`DELETE FROM ${quoteIdentifier(tableName)}`);

      const desksPerRow = Math.ceil(totalDesks / rows);
      let deskCounter = 0;

      for (let row = 1; row <= rows; row++) {
        const rowLetterIndex = (row - 1) * 2;

        if (rowLetterIndex >= RUSSIAN_LETTERS.length - 1) {
          console.log(`⚠️ Превышен лимит букв для рядов`);
          break;
        }

        const leftLetter = RUSSIAN_LETTERS[rowLetterIndex];
        const rightLetter = RUSSIAN_LETTERS[rowLetterIndex + 1];

        for (let deskInRow = 1; deskInRow <= desksPerRow; deskInRow++) {
          deskCounter++;
          if (deskCounter > totalDesks) break;

          const deskNumber = deskInRow;
          const placeLeft = `${deskNumber}${leftLetter}`;
          const placeRight = `${deskNumber}${rightLetter}`;

          await pool.query(
            `INSERT INTO ${quoteIdentifier(tableName)} (номер_места, номер_парты, буква_места) VALUES ($1, $2, $3)`,
            [placeLeft, deskNumber, leftLetter]
          );

          await pool.query(
            `INSERT INTO ${quoteIdentifier(tableName)} (номер_места, номер_парты, буква_места) VALUES ($1, $2, $3)`,
            [placeRight, deskNumber, rightLetter]
          );
        }

        if (deskCounter >= totalDesks) break;
      }

      const countResult = await pool.query(`SELECT COUNT(*) FROM ${quoteIdentifier(tableName)}`);
      console.log(`✅ Таблица ${tableName} заполнена: ${countResult.rows[0].count} мест`);

      return true;
    });
  } catch (error) {
    console.error(`❌ Ошибка заполнения таблицы кабинета ${classroomNumber}:`, error);
    throw error;
  }
};

const initializeExistingClassroomTables = async () => {
  try {
    console.log('🔄 Проверка таблиц существующих кабинетов...');

    const classrooms = await pool.query('SELECT номер_кабинета FROM Кабинеты ORDER BY номер_кабинета');

    for (const classroom of classrooms.rows) {
      const tableName = classroomTableName(classroom.номер_кабинета);

      if (!(await tableExists(tableName))) {
        await createClassroomTable(classroom.номер_кабинета);
      } else {
        await addColumnIfNotExists(tableName, 'заблокировано', 'BOOLEAN', 'DEFAULT FALSE');
      }
    }

    console.log('✅ Проверка таблиц кабинетов завершена');
  } catch (error) {
    console.error('❌ Ошибка инициализации таблиц кабинетов:', error);
    throw error;
  }
};

// ========== ФУНКЦИЯ ПРОВЕРКИ ПРАВИЛ РАЗМЕЩЕНИЯ ==========

const checkPlacementRules = (student, classroomNumber, placeNumber, classmates) => {
  const place = placeNumber;
  const placeDesk = parseInt(place.slice(0, -1));
  const placeLetter = place.slice(-1);

  const currentLetterIndex = RUSSIAN_LETTERS.indexOf(placeLetter);
  if (currentLetterIndex < 0) return false;

  const forbiddenPlaces = [];

  // Место в той же парте
  if (currentLetterIndex % 2 === 0) {
    if (currentLetterIndex + 1 < RUSSIAN_LETTERS.length) {
      forbiddenPlaces.push(`${placeDesk}${RUSSIAN_LETTERS[currentLetterIndex + 1]}`);
    }
  } else {
    if (currentLetterIndex - 1 >= 0) {
      forbiddenPlaces.push(`${placeDesk}${RUSSIAN_LETTERS[currentLetterIndex - 1]}`);
    }
  }

  // Место перед и за текущим
  if (placeDesk > 1) forbiddenPlaces.push(`${placeDesk - 1}${placeLetter}`);
  forbiddenPlaces.push(`${placeDesk + 1}${placeLetter}`);

  // Проверяем запрещенные места
  for (const forbiddenPlace of forbiddenPlaces) {
    const adjacentStudent = classmates.find(s => s.номер_места === forbiddenPlace);
    if (adjacentStudent && adjacentStudent.паралель === student.паралель) {
      return false;
    }
  }

  return true;
};

// ========== ОСНОВНЫЕ ФУНКЦИИ ДЛЯ РАБОТЫ С ДАННЫМИ ==========

// Кабинеты
const getAllClassrooms = async () => {
  try {
    const result = await pool.query('SELECT * FROM Кабинеты ORDER BY номер_кабинета');
    return result.rows;
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'getAllClassrooms';
    throw error;
  }
};

const getClassroomById = async (id) => {
  try {
    const result = await pool.query('SELECT * FROM Кабинеты WHERE id = $1', [id]);
    return result.rows[0];
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'getClassroomById';
    throw error;
  }
};

const createClassroom = async (номер_кабинета, количество_парт, количество_рядов_парт, этаж) => {
  try {
    const result = await pool.query(
      'INSERT INTO Кабинеты (номер_кабинета, количество_парт, количество_рядов_парт, этаж) VALUES ($1, $2, $3, $4) RETURNING *',
      [номер_кабинета, количество_парт, количество_рядов_парт, этаж]
    );
    return result.rows[0];
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'createClassroom';
    throw error;
  }
};

const updateClassroom = async (id, номер_кабинета, количество_парт, количество_рядов_парт, этаж) => {
  try {
    const result = await pool.query(
      'UPDATE Кабинеты SET номер_кабинета = $1, количество_парт = $2, количество_рядов_парт = $3, этаж = $4 WHERE id = $5 RETURNING *',
      [номер_кабинета, количество_парт, количество_рядов_парт, этаж, id]
    );
    return result.rows[0];
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'updateClassroom';
    throw error;
  }
};

const deleteClassroom = async (id) => {
  try {
    const result = await pool.query('DELETE FROM Кабинеты WHERE id = $1 RETURNING *', [id]);
    return result.rows[0];
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'deleteClassroom';
    throw error;
  }
};

// Ученики
const getAllStudents = async () => {
  try {
    const result = await pool.query('SELECT * FROM Ученики ORDER BY паралель, фимилия');
    return result.rows;
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'getAllStudents';
    throw error;
  }
};

const getUnplacedStudents = async () => {
  try {
    const result = await pool.query(
      'SELECT * FROM Ученики WHERE номер_кабинета IS NULL OR номер_места IS NULL ORDER BY паралель, фимилия'
    );
    return result.rows;
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'getUnplacedStudents';
    throw error;
  }
};

const getStudentById = async (studentId) => {
  try {
    const result = await pool.query('SELECT * FROM Ученики WHERE id = $1', [studentId]);
    return result.rows[0];
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'getStudentById';
    throw error;
  }
};

const getStudentsByClassroom = async (classroomNumber) => {
  try {
    const result = await pool.query(
      'SELECT * FROM Ученики WHERE номер_кабинета = $1 AND номер_места IS NOT NULL ORDER BY паралель, фимилия',
      [classroomNumber]
    );
    return result.rows;
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'getStudentsByClassroom';
    throw error;
  }
};

const updateStudentPlace = async (studentId, classroomNumber, placeNumber) => {
  try {
    await pool.query(
      'UPDATE Ученики SET номер_кабинета = $1, номер_места = $2, дата_последнего_изменения = CURRENT_TIMESTAMP WHERE id = $3',
      [classroomNumber, placeNumber, studentId]
    );
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'updateStudentPlace';
    throw error;
  }
};

const clearAllSeating = async () => {
  try {
    await pool.query('UPDATE Ученики SET номер_кабинета = NULL, номер_места = NULL');
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'clearAllSeating';
    throw error;
  }
};

const clearAllStudents = async () => {
  try {
    await pool.query('DELETE FROM Ученики');
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'clearAllStudents';
    throw error;
  }
};

const getStudentsWithPlaces = async () => {
  try {
    const result = await pool.query(`
      SELECT
        Ученики.*,
        Кабинеты.этаж
      FROM Ученики
      LEFT JOIN Кабинеты ON Ученики.номер_кабинета = Кабинеты.номер_кабинета
      WHERE Ученики.номер_кабинета IS NOT NULL
      AND Ученики.номер_места IS NOT NULL
      ORDER BY Ученики.паралель, Ученики.фимилия
    `);
    return result.rows;
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'getStudentsWithPlaces';
    throw error;
  }
};

const insertStudent = async (studentData) => {
  try {
    const {
      id, фимилия, имя, отчество, паралель, предмет,
      номер_кабинета, номер_места, school_code, school_name,
      school_number_oo, school_name_oo, participant_code
    } = studentData;

    const query = id ?
      `INSERT INTO Ученики (
        id, фимилия, имя, отчество, паралель, предмет, номер_кабинета, номер_места,
        school_code, school_name, school_number_oo, school_name_oo, participant_code
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)` :
      `INSERT INTO Ученики (
        фимилия, имя, отчество, паралель, предмет, номер_кабинета, номер_места,
        school_code, school_name, school_number_oo, school_name_oo, participant_code
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;

    const params = id ?
      [id, фимилия, имя, отчество || '', паралель, предмет, номер_кабинета, номер_места,
       school_code || '', school_name || '', school_number_oo || '', school_name_oo || '', participant_code || ''] :
      [фимилия, имя, отчество || '', паралель, предмет, номер_кабинета, номер_места,
       school_code || '', school_name || '', school_number_oo || '', school_name_oo || '', participant_code || ''];

    await pool.query(query, params);
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'insertStudent';
    throw error;
  }
};

// Места в кабинетах
const getClassroomPlaces = async (classroomNumber) => {
  try {
    const tableName = classroomTableName(classroomNumber);
    const result = await pool.query(`SELECT номер_места, заблокировано FROM ${quoteIdentifier(tableName)} ORDER BY номер_парты, буква_места`);
    return result.rows;
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'getClassroomPlaces';
    throw error;
  }
};

const getOccupiedPlaces = async (classroomNumber) => {
  try {
    const result = await pool.query(
      'SELECT номер_места FROM Ученики WHERE номер_кабинета = $1 AND номер_места IS NOT NULL',
      [classroomNumber]
    );
    return result.rows.map(row => row.номер_места);
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'getOccupiedPlaces';
    throw error;
  }
};

const updatePlaceBlockStatus = async (classroomNumber, placeNumber, blocked) => {
  try {
    const tableName = classroomTableName(classroomNumber);
    await pool.query(
      `UPDATE ${quoteIdentifier(tableName)} SET заблокировано = $1 WHERE номер_места = $2`,
      [blocked, placeNumber]
    );
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'updatePlaceBlockStatus';
    throw error;
  }
};

const getBlockedPlaces = async (classroomNumber) => {
  try {
    const tableName = classroomTableName(classroomNumber);
    const result = await pool.query(
      `SELECT номер_места FROM ${quoteIdentifier(tableName)} WHERE заблокировано = true ORDER BY номер_парты, буква_места`
    );
    return result.rows.map(row => row.номер_места);
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'getBlockedPlaces';
    throw error;
  }
};

// Конфигурация рядов
const updateClassroomLayout = async (classroomId, rowMapping) => {
  try {
    await pool.query(`
      INSERT INTO classroom_layouts (classroom_id, row_mapping)
      VALUES ($1, $2)
      ON CONFLICT (classroom_id)
      DO UPDATE SET row_mapping = $2, updated_at = CURRENT_TIMESTAMP
    `, [classroomId, JSON.stringify(rowMapping)]);
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'updateClassroomLayout';
    throw error;
  }
};

const getClassroomLayout = async (classroomId) => {
  try {
    const result = await pool.query(
      'SELECT row_mapping FROM classroom_layouts WHERE classroom_id = $1',
      [classroomId]
    );
    return result.rows[0]?.row_mapping || null;
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'getClassroomLayout';
    throw error;
  }
};

const deleteClassroomLayout = async (classroomId) => {
  try {
    await pool.query('DELETE FROM classroom_layouts WHERE classroom_id = $1', [classroomId]);
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'deleteClassroomLayout';
    throw error;
  }
};

// Перемещение парт
const moveDesk = async (classroomNumber, fromRow, fromDesk, toRow, toDesk) => {
  try {
    const fromLeftLetter = RUSSIAN_LETTERS[(fromRow - 1) * 2];
    const fromRightLetter = RUSSIAN_LETTERS[(fromRow - 1) * 2 + 1];
    const toLeftLetter = RUSSIAN_LETTERS[(toRow - 1) * 2];
    const toRightLetter = RUSSIAN_LETTERS[(toRow - 1) * 2 + 1];

    const fromPlaceLeft = `${fromDesk}${fromLeftLetter}`;
    const fromPlaceRight = `${fromDesk}${fromRightLetter}`;
    const toPlaceLeft = `${toDesk}${toLeftLetter}`;
    const toPlaceRight = `${toDesk}${toRightLetter}`;

    await pool.query(
      'UPDATE Ученики SET номер_места = $1 WHERE номер_кабинета = $2 AND номер_места = $3',
      [toPlaceLeft, classroomNumber, fromPlaceLeft]
    );

    await pool.query(
      'UPDATE Ученики SET номер_места = $1 WHERE номер_кабинета = $2 AND номер_места = $3',
      [toPlaceRight, classroomNumber, fromPlaceRight]
    );
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'moveDesk';
    throw error;
  }
};

// Предметы
const getSubjects = async () => {
  try {
    const result = await pool.query('SELECT * FROM id_subject ORDER BY subject');
    return result.rows;
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'getSubjects';
    throw error;
  }
};

// Образовательные учреждения (OO)
const getAllOO = async () => {
  try {
    const result = await pool.query('SELECT * FROM oo ORDER BY id');
    return result.rows;
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'getAllOO';
    throw error;
  }
};

const createOO = async (ooData) => {
  try {
    const { code_omsu, code_oo, number_oo, name_oo, full_name } = ooData;
    const result = await pool.query(
      'INSERT INTO oo (code_omsu, code_oo, number_oo, name_oo, full_name) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [code_omsu || '', code_oo || '', number_oo || '', name_oo || '', full_name]
    );
    return result.rows[0];
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'createOO';
    throw error;
  }
};

const updateOO = async (id, ooData) => {
  try {
    const { code_omsu, code_oo, number_oo, name_oo, full_name } = ooData;

    const hasUpdatedAt = await checkColumnExists('oo', 'updated_at');
    const query = hasUpdatedAt ?
      'UPDATE oo SET code_omsu = $1, code_oo = $2, number_oo = $3, name_oo = $4, full_name = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6 RETURNING *' :
      'UPDATE oo SET code_omsu = $1, code_oo = $2, number_oo = $3, name_oo = $4, full_name = $5 WHERE id = $6 RETURNING *';

    const result = await pool.query(query, [
      code_omsu || '', code_oo || '', number_oo || '', name_oo || '', full_name, id
    ]);
    return result.rows[0];
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'updateOO';
    throw error;
  }
};

const deleteOO = async (id) => {
  try {
    const result = await pool.query('DELETE FROM oo WHERE id = $1 RETURNING *', [id]);
    return result.rows[0];
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'deleteOO';
    throw error;
  }
};

// Школы
const getSchoolByName = async (code) => {
  try {
    const result = await pool.query('SELECT * FROM schools WHERE code = $1', [code]);
    return result.rows[0] || null;
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'getSchoolByName';
    throw error;
  }
};

const getAllSchools = async () => {
  try {
    const result = await pool.query('SELECT * FROM schools ORDER BY name');
    return result.rows;
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'getAllSchools';
    throw error;
  }
};

const createSchool = async (code, name, address = '') => {
  try {
    const result = await pool.query(
      'INSERT INTO schools (code, name, address) VALUES ($1, $2, $3) RETURNING *',
      [code, name, address]
    );
    return result.rows[0];
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'createSchool';
    throw error;
  }
};

const updateSchool = async (id, code, name, address = '') => {
  try {
    const result = await pool.query(
      'UPDATE schools SET code = $1, name = $2, address = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *',
      [code, name, address, id]
    );
    return result.rows[0];
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'updateSchool';
    throw error;
  }
};

const deleteSchool = async (id) => {
  try {
    const result = await pool.query('DELETE FROM schools WHERE id = $1 RETURNING *', [id]);
    return result.rows[0];
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'deleteSchool';
    throw error;
  }
};

// Проверка здоровья
const healthCheck = async () => {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'healthCheck';
    throw error;
  }
};

// ========== ЭКСПОРТ ==========

module.exports = {
  pool,
  parallelColors: PARALLEL_COLORS,
  generateTableName,
  initializeDatabase,
  initializeExistingClassroomTables,
  importStudentsFromSubjectTable,
  createClassroomTable,
  populateClassroomTable,
  checkPlacementRules,

  // Кабинеты
  getAllClassrooms,
  getClassroomById,
  createClassroom,
  updateClassroom,
  deleteClassroom,

  // Ученики
  getAllStudents,
  getUnplacedStudents,
  getStudentById,
  getStudentsByClassroom,
  updateStudentPlace,
  updateStudentFields,
  updateStudentPlaceWithDetails,
  clearAllSeating,
  clearAllStudents,
  getStudentsWithPlaces,
  insertStudent,

  // Места в кабинетах
  getClassroomPlaces,
  getOccupiedPlaces,
  updatePlaceBlockStatus,
  getBlockedPlaces,

  // Конфигурация рядов
  updateClassroomLayout,
  getClassroomLayout,
  deleteClassroomLayout,

  // Перемещение парт
  moveDesk,

  // Предметы
  getSubjects,

  // Образовательные учреждения
  getAllOO,
  createOO,
  updateOO,
  deleteOO,

  // Школы
  getSchoolByName,
  getAllSchools,
  createSchool,
  updateSchool,
  deleteSchool,

  // Здоровье
  healthCheck
};
