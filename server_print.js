const express = require('express');
const { HttpError } = require('./src/errors');
const { integer } = require('./src/seating/validation');
const {
  getAllClassrooms,
  getClassroomById,
  getStudentsByClassroom,
  getAllStudents,
  getAllOO
} = require('./bd');

const router = express.Router();

// Страница печати
router.get('/print', async (req, res, next) => {
  try {
    const classrooms = await getAllClassrooms();
    console.log(`🖨️ Загружено кабинетов для печати: ${classrooms.length}`);
    res.render('print', { classrooms });
  } catch (error) {
    console.error('❌ Ошибка загрузки страницы печати:', error);
    next(error);
  }
});

// API для печати отдельного кабинета
router.get('/api/print/classroom/:classroomId', async (req, res, next) => {
  try {
    const { classroomId } = req.params;
    const { format } = req.query;
    integer(classroomId, 'Идентификатор кабинета');
    if (format !== undefined && !['R', 'M'].includes(format)) throw new HttpError(400, 'Выберите форму Р или М');

    console.log(`🖨️ Формирование данных для печати: кабинет ${classroomId}, формат ${format}`);

    const classroom = await getClassroomById(classroomId);
    if (!classroom) {
      return res.status(404).json({ success: false, error: 'Кабинет не найден' });
    }

    const students = await getStudentsByClassroom(classroom.номер_кабинета);
    const ooData = await getAllOO();
    const oo = ooData[0] || {};

    // Группируем учеников по параллелям
    const studentsByParallel = Object.create(null);
    students.forEach(student => {
      if (!studentsByParallel[student.паралель]) {
        studentsByParallel[student.паралель] = [];
      }
      studentsByParallel[student.паралель].push(student);
    });

    const sortedParallels = Object.keys(studentsByParallel).sort((a, b) => parseInt(a) - parseInt(b));

    const printData = {
      classroom,
      oo,
      parallels: sortedParallels.map(parallel => ({
        name: parallel,
        students: studentsByParallel[parallel].map((student, index) => ({
          number: index + 1,
          school_number_oo: student.school_number_oo || student.school_code || '',
          school_name_oo: student.school_name_oo || student.school_name || '',
          participant_code: student.participant_code || '',
          parallel: student.паралель,
          full_name: `${student.фимилия} ${student.имя} ${student.отчество || ''}`.trim(),
          classroom: classroom.номер_кабинета,
          place: student.номер_места,
          предмет: student.предмет
        }))
      })),
      format,
      totalStudents: students.length
    };

    console.log(`✅ Сформированы данные для печати: ${sortedParallels.length} параллелей, ${students.length} учеников`);

    res.json({ success: true, data: printData });
  } catch (error) {
    console.error('❌ Ошибка формирования данных для печати:', error);
    next(error);
  }
});

// Массовая печать
router.get('/api/print/bulk', async (req, res, next) => {
  try {
    const { groupBy, format, selection } = req.query;

    console.log(`🖨️ Массовая печать: группировка=${groupBy}, формат=${format}, выбор=${selection}`);

    if (!groupBy || !format || !selection) {
      return res.status(400).json({ success: false, error: 'Не указаны параметры группировки' });
    }
    if (!['classroom', 'school'].includes(groupBy) || !['R', 'M'].includes(format) ||
      typeof selection !== 'string' || selection.length > 50) {
      throw new HttpError(400, 'Некорректные параметры группировки');
    }
    if (groupBy === 'classroom' && selection !== 'all') integer(selection, 'Идентификатор кабинета');

    const ooData = await getAllOO();
    const oo = ooData[0] || {};

    let printData = [];

    if (groupBy === 'classroom') {
      // Группировка по кабинетам
      if (selection === 'all') {
        const classrooms = await getAllClassrooms();

        for (const classroom of classrooms) {
          const students = await getStudentsByClassroom(classroom.номер_кабинета);
          if (students.length > 0) {
            const classroomData = await generateClassroomPrintData(classroom, students, oo, format);
            printData.push(classroomData);
          }
        }
      } else {
        const classroom = await getClassroomById(selection);
        if (!classroom) {
          return res.status(404).json({ success: false, error: 'Кабинет не найден' });
        }
        const students = await getStudentsByClassroom(classroom.номер_кабинета);
        if (students.length > 0) {
          const classroomData = await generateClassroomPrintData(classroom, students, oo, format);
          printData.push(classroomData);
        }
      }
    } else if (groupBy === 'school') {
      // Группировка по школам
      const allStudents = await getAllStudents();
      const studentsWithPlaces = allStudents.filter(student => student.номер_кабинета && student.номер_места);

      if (selection === 'all') {
        const schools = Object.create(null);

        studentsWithPlaces.forEach(student => {
          const schoolCode = student.school_number_oo || student.school_code || 'unknown';
          if (!schools[schoolCode]) {
            schools[schoolCode] = {
              code: schoolCode,
              name: student.school_name_oo || student.school_name || `Школа ${schoolCode}`,
              students: []
            };
          }
          schools[schoolCode].students.push(student);
        });

        for (const [schoolCode, schoolData] of Object.entries(schools)) {
          if (schoolData.students.length > 0) {
            const schoolPrintData = await generateSchoolPrintData(schoolData, schoolData.students, oo, format);
            printData.push(schoolPrintData);
          }
        }
      } else {
        const schoolStudents = studentsWithPlaces.filter(student =>
          (student.school_number_oo === selection) || (student.school_code === selection)
        );
        if (schoolStudents.length > 0) {
          const schoolData = {
            code: selection,
            name: schoolStudents[0]?.school_name_oo || schoolStudents[0]?.school_name || `Школа ${selection}`,
            students: schoolStudents
          };
          const schoolPrintData = await generateSchoolPrintData(schoolData, schoolStudents, oo, format);
          printData.push(schoolPrintData);
        }
      }
    }

    console.log(`✅ Сформированы данные для массовой печати: ${printData.length} групп`);

    res.json({
      success: true,
      data: printData,
      stats: {
        totalGroups: printData.length,
        totalStudents: printData.reduce((sum, group) => sum + group.totalStudents, 0)
      }
    });

  } catch (error) {
    console.error('❌ Ошибка формирования данных для массовой печати:', error);
    next(error);
  }
});

// Получение опций для печати
router.get('/api/print/options', async (req, res, next) => {
  try {
    console.log('📋 Получение опций для печати');

    const classrooms = await getAllClassrooms();
    const students = await getAllStudents();
    const studentsWithPlaces = students.filter(student => student.номер_кабинета && student.номер_места);

    // Получаем уникальные школы из данных учеников
    const schoolsMap = Object.create(null);
    studentsWithPlaces.forEach(student => {
      const schoolCode = student.school_number_oo || student.school_code;
      if (schoolCode) {
        schoolsMap[schoolCode] = {
          code: schoolCode,
          name: student.school_name_oo || student.school_name || `Школа ${schoolCode}`
        };
      }
    });

    const schools = Object.values(schoolsMap);

    const options = {
      classrooms: classrooms.map(classroom => ({
        id: classroom.id,
        name: `Кабинет ${classroom.номер_кабинета} (этаж ${classroom.этаж})`,
        studentCount: studentsWithPlaces.filter(s => s.номер_кабинета === classroom.номер_кабинета).length
      })).filter(classroom => classroom.studentCount > 0),
      schools: schools.map(school => ({
        id: school.code,
        name: `${school.name} (${school.code})`,
        studentCount: studentsWithPlaces.filter(s =>
          (s.school_number_oo === school.code) || (s.school_code === school.code)
        ).length
      })).filter(school => school.studentCount > 0)
    };

    console.log(`✅ Опции загружены: ${options.classrooms.length} кабинетов, ${options.schools.length} школ`);

    res.json({ success: true, options });
  } catch (error) {
    console.error('❌ Ошибка получения опций:', error);
    next(error);
  }
});

// Вспомогательные функции
async function generateClassroomPrintData(classroom, students, oo, format) {
  const studentsByParallel = Object.create(null);
  students.forEach(student => {
    if (!studentsByParallel[student.паралель]) {
      studentsByParallel[student.паралель] = [];
    }
    studentsByParallel[student.паралель].push(student);
  });

  const sortedParallels = Object.keys(studentsByParallel).sort((a, b) => parseInt(a) - parseInt(b));

  return {
    type: 'classroom',
    title: `Кабинет ${classroom.номер_кабинета}`,
    classroom: classroom,
    oo: oo,
    parallels: sortedParallels.map(parallel => ({
      name: parallel,
      students: studentsByParallel[parallel].map((student, index) => ({
        number: index + 1,
        school_number_oo: student.school_number_oo || student.school_code || '',
        school_name_oo: student.school_name_oo || student.school_name || '',
        participant_code: student.participant_code || '',
        parallel: student.паралель,
        full_name: `${student.фимилия} ${student.имя} ${student.отчество || ''}`.trim(),
        classroom: classroom.номер_кабинета,
        place: student.номер_места,
        предмет: student.предмет
      }))
    })),
    format: format,
    totalStudents: students.length
  };
}

async function generateSchoolPrintData(schoolData, students, oo, format) {
  const studentsByParallel = Object.create(null);
  students.forEach(student => {
    if (!studentsByParallel[student.паралель]) {
      studentsByParallel[student.паралель] = [];
    }
    studentsByParallel[student.паралель].push(student);
  });

  const sortedParallels = Object.keys(studentsByParallel).sort((a, b) => parseInt(a) - parseInt(b));

  return {
    type: 'school',
    title: `Школа: ${schoolData.name} (${schoolData.code})`,
    schoolData: schoolData,
    oo: oo,
    parallels: sortedParallels.map(parallel => ({
      name: parallel,
      students: studentsByParallel[parallel].map((student, index) => ({
        number: index + 1,
        school_number_oo: student.school_number_oo || student.school_code || '',
        school_name_oo: student.school_name_oo || student.school_name || '',
        participant_code: student.participant_code || '',
        parallel: student.паралель,
        full_name: `${student.фимилия} ${student.имя} ${student.отчество || ''}`.trim(),
        classroom: student.номер_кабинета,
        place: student.номер_места,
        предмет: student.предмет
      }))
    })),
    format: format,
    totalStudents: students.length
  };
}

module.exports = router;
