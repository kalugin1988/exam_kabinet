// Алгоритм рассадки учеников по кабинетами

// Вспомогательные функции
const russianLetters = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К', 'Л', 'М'];

/**
 * Рассчитывает все возможные места в кабинете
 */
function calculateClassroomPlaces(classroom, blockedPlaces = [], logFunction = console.log) {
  const log = logFunction;
  const rows = classroom.количество_рядов_парт;
  const totalDesks = classroom.количество_парт;

  const places = [];

  log(`  Расчет мест для кабинета ${classroom.номер_кабинета}: ${rows} рядов, ${totalDesks} парт`);

  // Рассчитываем количество парт в одном ряду
  const desksPerRow = Math.ceil(totalDesks / rows);

  let deskCounter = 0;

  // Проходим по всем рядам
  for (let row = 1; row <= rows; row++) {
    const rowLetterIndex = (row - 1) * 2;

    // Проверяем, что у нас достаточно букв для этого ряда
    if (rowLetterIndex >= russianLetters.length - 1) {
      log(`  ⚠️ Превышен лимит букв для рядов`);
      break;
    }

    const leftLetter = russianLetters[rowLetterIndex];
    const rightLetter = russianLetters[rowLetterIndex + 1];

    // Проходим по всем партам в ряду
    for (let deskInRow = 1; deskInRow <= desksPerRow; deskInRow++) {
      deskCounter++;

      // Если превысили общее количество парт - выходим
      if (deskCounter > totalDesks) break;

      const deskNumber = deskInRow; // Номер парты в ряду
      const placeLeft = `${deskNumber}${leftLetter}`;
      const placeRight = `${deskNumber}${rightLetter}`;

      // Добавляем только незаблокированные места
      if (!blockedPlaces.includes(placeLeft)) {
        places.push(placeLeft);
      } else {
        log(`    Место ${placeLeft} заблокировано, пропускаем`);
      }

      if (!blockedPlaces.includes(placeRight)) {
        places.push(placeRight);
      } else {
        log(`    Место ${placeRight} заблокировано, пропускаем`);
      }

      log(`    Парта ${deskNumber} (ряд ${row}): места ${placeLeft} и ${placeRight} ${blockedPlaces.includes(placeLeft) || blockedPlaces.includes(placeRight) ? '(заблокированы)' : ''}`);
    }

    if (deskCounter >= totalDesks) break;
  }

  log(`  Итого доступных мест в кабинете ${classroom.номер_кабинета}: ${places.length} (заблокировано: ${blockedPlaces.length})`);
  return places;
}

/**
 * Группирует учеников по параллелям
 */
function groupStudentsByParallel(students) {
  const studentsByParallel = Object.create(null);

  students.forEach(student => {
    const parallel = student.паралель;

    if (!studentsByParallel[parallel]) {
      studentsByParallel[parallel] = [];
    }

    studentsByParallel[parallel].push({
      id: student.id,
      parallel: parallel,
      surname: student.фимилия,
      name: student.имя,
      patronymic: student.отчество,
      subject: student.предмет
    });
  });

  return studentsByParallel;
}

/**
 * Проверяет запрещенные соседние места
 * Запрещены: сосед по парте (слева/справа) и место прямо спереди/сзади
 * Разрешены: места по диагонали
 */
function checkForbiddenAdjacentPlaces(classroomOccupancy, seating, classroom, place, parallel, classrooms, logFunction = console.log) {
  const log = logFunction;
  const occupancy = classroomOccupancy[classroom];
  const placeNumber = parseInt(place.slice(0, -1)); // номер парты в ряду
  const placeLetter = place.slice(-1); // буква места

  const russianLetters = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К', 'Л', 'М'];
  const currentLetterIndex = russianLetters.indexOf(placeLetter);

  if (currentLetterIndex < 0) return true;

  // Находим все запрещенные соседние места
  const forbiddenPlaces = [];

  // 1. ЗАПРЕЩЕНО: Место в той же парте (сосед слева/справа)
  if (currentLetterIndex % 2 === 0) {
    // Левое место (А, В, Г...) - проверяем правое
    if (currentLetterIndex + 1 < russianLetters.length) {
      forbiddenPlaces.push(`${placeNumber}${russianLetters[currentLetterIndex + 1]}`);
    }
  } else {
    // Правое место (Б, Д, Е...) - проверяем левое
    if (currentLetterIndex - 1 >= 0) {
      forbiddenPlaces.push(`${placeNumber}${russianLetters[currentLetterIndex - 1]}`);
    }
  }

  // 2. ЗАПРЕЩЕНО: Место прямо перед текущим (в предыдущем ряду с той же буквой)
  if (placeNumber > 1) {
    forbiddenPlaces.push(`${placeNumber - 1}${placeLetter}`);
  }

  // 3. ЗАПРЕЩЕНО: Место прямо за текущим (в следующем ряду с той же буквой)
  const classroomObj = classrooms.find(c => c.номер_кабинета === classroom);
  if (classroomObj && placeNumber < classroomObj.количество_парт) {
    forbiddenPlaces.push(`${placeNumber + 1}${placeLetter}`);
  }

  // Проверяем все запрещенные места на наличие учеников из той же параллели
  for (const forbiddenPlace of forbiddenPlaces) {
    if (occupancy.occupiedPlaces.has(forbiddenPlace)) {
      const adjacentStudent = seating.find(s =>
        s.classroom === classroom && s.place === forbiddenPlace
      );
      if (adjacentStudent && adjacentStudent.parallel === parallel) {
        log(`    🚫 Запрещенное соседство: место ${place} рядом с ${forbiddenPlace} (${adjacentStudent.studentInfo.surname})`);
        return false; // Найдено запрещенное соседство
      }
    }
  }

  return true; // Все проверки пройдены
}

/**
 * Распределяет учеников параллели по местам БЕЗ чередования кабинетов и приоритета первых рядов
 */
function distributeParallelStudents(students, classrooms, parallel, classroomOccupancy, seating, unplacedStudents, log) {
  log(`\nРАЗМЕЩЕНИЕ ПАРАЛЛЕЛИ ${parallel} (${students.length} учеников):`);

  let studentIndex = 0;
  const placedStudents = [];

  // Собираем все доступные места из всех кабинетов в простом порядке
  const allPlaces = [];

  // Проходим по кабинетам в исходном порядке
  for (const classroom of classrooms) {
    const occupancy = classroomOccupancy[classroom.номер_кабинета];

    // Добавляем все места из текущего кабинета
    occupancy.allPlaces.forEach(place => {
      allPlaces.push({
        classroom: classroom.номер_кабинета,
        place: place,
        deskNumber: parseInt(place.slice(0, -1))
      });
    });
  }

  log(`  Всего доступных мест: ${allPlaces.length}`);

  // Логируем распределение по кабинетам
  const distributionByClassroom = {};
  allPlaces.forEach(p => {
    if (!distributionByClassroom[p.classroom]) distributionByClassroom[p.classroom] = 0;
    distributionByClassroom[p.classroom]++;
  });

  log(`  Распределение мест по кабинетам:`);
  Object.keys(distributionByClassroom).sort((a, b) => a - b).forEach(classroom => {
    log(`    Кабинет ${classroom}: ${distributionByClassroom[classroom]} мест`);
  });

  // Проход с строгим соблюдением правил
  log(`  🔄 Размещение с проверкой соседства (простой порядок мест)...`);
  let placedCount = 0;
  let skippedDueToRules = 0;
  const placedByClassroom = {};

  // Проходим по всем местам в простом порядке (кабинет за кабинетом)
  for (const placeInfo of allPlaces) {
    if (studentIndex >= students.length) break;

    const { classroom, place, deskNumber } = placeInfo;
    const occupancy = classroomOccupancy[classroom];

    if (!occupancy.occupiedPlaces.has(place)) {
      const student = students[studentIndex];
      const validPlace = checkForbiddenAdjacentPlaces(
        classroomOccupancy, seating, classroom, place, parallel, classrooms, log
      );

      if (validPlace) {
        seating.push({
          studentId: student.id,
          classroom: classroom,
          place: place,
          parallel: parallel,
          studentInfo: student
        });

        occupancy.occupiedPlaces.add(place);
        placedStudents.push({
          student: student,
          classroom: classroom,
          place: place
        });

        // Считаем распределение по кабинетам
        if (!placedByClassroom[classroom]) placedByClassroom[classroom] = 0;
        placedByClassroom[classroom]++;

        log(`  ✅ ${student.surname} ${student.name} -> Кабинет ${classroom}, Место ${place}`);
        studentIndex++;
        placedCount++;
      } else {
        skippedDueToRules++;
      }
    }
  }

  log(`  Размещено учеников: ${placedCount}`);
  log(`  Пропущено мест из-за правил соседства: ${skippedDueToRules}`);

  // Статистика по кабинетам
  log(`  Фактическое распределение по кабинетам:`);
  Object.keys(placedByClassroom).sort((a, b) => a - b).forEach(classroom => {
    log(`    Кабинет ${classroom}: ${placedByClassroom[classroom]} учеников`);
  });

  // Статистика по рядам
  const placedByRow = {};
  placedStudents.forEach(p => {
    const deskNumber = parseInt(p.place.slice(0, -1));
    if (!placedByRow[deskNumber]) placedByRow[deskNumber] = 0;
    placedByRow[deskNumber]++;
  });

  log(`  Распределение по рядам:`);
  Object.keys(placedByRow).sort((a, b) => a - b).forEach(row => {
    log(`    Ряд ${row}: ${placedByRow[row]} учеников`);
  });

  // Обрабатываем неразмещенных учеников
  if (studentIndex < students.length) {
    const notPlacedCount = students.length - studentIndex;
    log(`  ❌ Неразмещенные ученики (${notPlacedCount}):`);

    for (let i = studentIndex; i < students.length; i++) {
      const student = students[i];
      log(`     - ${student.surname} ${student.name}`);

      unplacedStudents.push({
        student: student,
        parallel: parallel,
        reason: 'Недостаточно мест с учетом правил соседства'
      });
    }
  }

  const totalPlaced = placedStudents.length;
  log(`\n📊 ИТОГИ для параллели ${parallel}:`);
  log(`  Всего учеников: ${students.length}`);
  log(`  Успешно размещено: ${totalPlaced}`);
  log(`  Не размещено: ${students.length - totalPlaced}`);

  return placedStudents;
}

/**
 * Основная функция генерации рассадки
 */
function generateSeating(students, classrooms, blockedPlacesByClassroom = {}, logFunction = console.log) {
  const log = logFunction;

  log('=== ЗАПУСК АЛГОРИТМА РАССАДКИ ===');

  const seating = [];
  const unplacedStudents = [];

  // 1. Рассчитываем общее количество доступных мест (исключая заблокированные)
  const classroomPlaces = {};
  let totalAvailableSeats = 0;

  log('\nРАСЧЕТ КОЛИЧЕСТВА МЕСТ В КАБИНЕТАХ (с учетом заблокированных мест):');
  classrooms.forEach(classroom => {
    const blockedPlaces = blockedPlacesByClassroom[classroom.номер_кабинета] || [];
    const places = calculateClassroomPlaces(classroom, blockedPlaces, log);
    classroomPlaces[classroom.номер_кабинета] = places;
    totalAvailableSeats += places.length;

    log(`Кабинет ${classroom.номер_кабинета}: ${places.length} доступных мест (заблокировано: ${blockedPlaces.length})`);
  });

  // 2. Проверяем возможность размещения
  log(`\nОБЩАЯ ИНФОРМАЦИЯ О РАЗМЕЩЕНИИ:`);
  log(`Всего учеников: ${students.length}`);
  log(`Всего доступных мест: ${totalAvailableSeats}`);
  log(`Кабинетов: ${classrooms.length}`);

  if (students.length > totalAvailableSeats) {
    log(`❌ ВНИМАНИЕ: Учеников (${students.length}) больше чем доступных мест (${totalAvailableSeats})!`);
    log(`❌ Невозможно разместить всех учеников. Максимум можно разместить: ${totalAvailableSeats}`);
  } else {
    log(`✅ Мест достаточно для размещения всех учеников`);
  }

  // 3. Группируем учеников по параллелям
  const studentsByParallel = groupStudentsByParallel(students);

  log('\nРАСПРЕДЕЛЕНИЕ ПО ПАРАЛЛЕЛЯМ:');
  Object.keys(studentsByParallel).forEach(parallel => {
    log(`Параллель ${parallel}: ${studentsByParallel[parallel].length} учеников`);
  });

  // 4. Сортируем параллели по количеству учеников (от большего к меньшему)
  const sortedParallels = Object.keys(studentsByParallel).sort((a, b) => {
    return studentsByParallel[b].length - studentsByParallel[a].length;
  });

  log('\nПАРАЛЛЕЛИ ПО УБЫВАНИЮ:');
  sortedParallels.forEach((parallel, index) => {
    log(`${index + 1}. Параллель ${parallel}: ${studentsByParallel[parallel].length} учеников`);
  });

  // 5. Создаем карту занятости мест для каждого кабинета
  const classroomOccupancy = {};
  classrooms.forEach(classroom => {
    classroomOccupancy[classroom.номер_кабинета] = {
      occupiedPlaces: new Set(),
      allPlaces: classroomPlaces[classroom.номер_кабинета],
      totalSeats: classroomPlaces[classroom.номер_кабинета].length
    };
  });

  // 6. Основной алгоритм распределения
  let totalPlaced = 0;
  let remainingSeats = totalAvailableSeats;

  log(`\n=== НАЧАЛО РАСПРЕДЕЛЕНИЯ ===`);

  for (const parallel of sortedParallels) {
    const parallelStudents = studentsByParallel[parallel];

    log(`\n=== ОБРАБОТКА ПАРАЛЛЕЛИ ${parallel} (${parallelStudents.length} учеников) ===`);
    log(`Осталось свободных мест: ${remainingSeats}`);

    if (remainingSeats <= 0) {
      log(`❌ Нет свободных мест! Все ${parallelStudents.length} учеников параллели ${parallel} не будут размещены.`);

      parallelStudents.forEach(student => {
        unplacedStudents.push({
          student: student,
          parallel: parallel,
          reason: 'Недостаточно мест в кабинетах'
        });
      });
      continue;
    }

    // Ограничиваем количество учеников для размещения количеством оставшихся мест
    const studentsToPlace = Math.min(parallelStudents.length, remainingSeats);
    const studentsForThisParallel = parallelStudents.slice(0, studentsToPlace);

    if (studentsToPlace < parallelStudents.length) {
      log(`⚠️  Размещаем только ${studentsToPlace} из ${parallelStudents.length} учеников (по количеству оставшихся мест)`);

      parallelStudents.slice(studentsToPlace).forEach(student => {
        unplacedStudents.push({
          student: student,
          parallel: parallel,
          reason: 'Недостаточно мест в кабинетах'
        });
      });
    }

    const placed = distributeParallelStudents(
      studentsForThisParallel,
      classrooms,
      parallel,
      classroomOccupancy,
      seating,
      unplacedStudents,
      log
    );

    totalPlaced += placed.length;
    remainingSeats -= placed.length;

    log(`Размещено учеников параллели ${parallel}: ${placed.length}`);
    log(`Осталось свободных мест: ${remainingSeats}`);
  }

  // 7. Финальная статистика
  log(`\n=== ИТОГИ РАСПРЕДЕЛЕНИЯ ===`);
  log(`Всего учеников для распределения: ${students.length}`);
  log(`Успешно размещено: ${totalPlaced}`);
  log(`Не размещено: ${unplacedStudents.length}`);
  log(`Использовано мест: ${totalPlaced}/${totalAvailableSeats}`);
  log(`Загрузка мест: ${Math.round((totalPlaced / totalAvailableSeats) * 100)}%`);

  if (unplacedStudents.length > 0) {
    log('\n=== СПИСОК НЕРАЗМЕЩЕННЫХ УЧЕНИКОВ (первые 20) ===');
    unplacedStudents.slice(0, 20).forEach((item, index) => {
      log(`${index + 1}. ${item.student.surname} ${item.student.name} (${item.parallel} класс) - ${item.reason}`);
    });
    if (unplacedStudents.length > 20) {
      log(`... и еще ${unplacedStudents.length - 20} учеников`);
    }
  } else {
    log('\n✅ Все ученики успешно размещены!');
  }

  // Статистика по кабинетам
  log('\nСТАТИСТИКА ПО КАБИНЕТАМ:');
  classrooms.forEach(classroom => {
    const occupancy = classroomOccupancy[classroom.номер_кабинета];
    const totalPlaces = occupancy.allPlaces.length;
    const occupiedCount = occupancy.occupiedPlaces.size;
    const freeCount = totalPlaces - occupiedCount;
    const blockedCount = blockedPlacesByClassroom[classroom.номер_кабинета]?.length || 0;

    log(`Кабинет ${classroom.номер_кабинета}: ${occupiedCount}/${totalPlaces} мест занято (${freeCount} свободно, ${blockedCount} заблокировано)`);
  });

  return {
    seating: seating,
    unplacedStudents: unplacedStudents,
    statistics: {
      totalStudents: students.length,
      totalSeats: totalAvailableSeats,
      placedStudents: totalPlaced,
      unplacedStudents: unplacedStudents.length,
      utilization: Math.round((totalPlaced / totalAvailableSeats) * 100)
    }
  };
}

module.exports = { generateSeating };
