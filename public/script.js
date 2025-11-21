let draggedStudent = null;
let selectedStudent = null;
let selectedPlace = null;

// Функция для загрузки предметов из API
async function loadSubjects() {
    try {
        console.log('Загрузка списка предметов...');
        const response = await fetch('/api/subjects');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            const subjectSelect = document.getElementById('subjectSelect');
            subjectSelect.innerHTML = result.subjects.map(subject => 
                `<option value="${subject.subject}">${subject.subject}</option>`
            ).join('');
            console.log(`Загружено предметов: ${result.subjects.length}`);
        } else {
            console.error('Ошибка загрузки предметов:', result.error);
            alert('Ошибка загрузки предметов: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка загрузки предметов:', error);
        alert('Ошибка загрузки предметов: ' + error.message);
    }
}

// Функция для загрузки учеников
async function loadStudents() {
    try {
        console.log('Загрузка списка учеников...');
        const response = await fetch('/api/students');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            window.studentsData = result.students;
            console.log(`Загружено учеников: ${studentsData.length}`);
            return true;
        } else {
            console.error('Ошибка загрузки учеников:', result.error);
            return false;
        }
    } catch (error) {
        console.error('Ошибка загрузки учеников:', error);
        return false;
    }
}

// Функция для загрузки заблокированных мест
async function loadBlockedPlaces(classroomId) {
    try {
        const response = await fetch(`/api/classrooms/${classroomId}/blocked-places`);
        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                return result.blockedPlaces || [];
            }
        }
        return [];
    } catch (error) {
        console.error('Ошибка загрузки заблокированных мест:', error);
        return [];
    }
}

async function renderClassrooms() {
    const container = document.getElementById('classroomsContainer');
    container.innerHTML = '';

    console.log(`Рендеринг ${classroomsData.length} кабинетов`);

    // Загружаем учеников перед рендерингом
    const studentsLoaded = await loadStudents();
    if (!studentsLoaded) {
        alert('Ошибка загрузки данных учеников');
        return;
    }

    for (const classroom of classroomsData) {
        const classroomElement = document.createElement('div');
        classroomElement.className = 'classroom';
        classroomElement.setAttribute('data-classroom-id', classroom.id);
        classroomElement.setAttribute('data-classroom-number', classroom.номер_кабинета);
        
        const rows = classroom.количество_рядов_парт;
        const totalDesks = classroom.количество_парт;
        
        // Загружаем заблокированные места для этого кабинета
        const blockedPlaces = await loadBlockedPlaces(classroom.id);
        
        classroomElement.innerHTML = `
            <div class="classroom-header">
                <div class="classroom-title">Кабинет №${classroom.номер_кабинета}</div>
                <div class="classroom-info">
                    Парт: ${totalDesks} | Рядов: ${rows} | Этаж: ${classroom.этаж}
                    ${blockedPlaces.length > 0 ? `<span class="blocked-count">🚫 ${blockedPlaces.length}</span>` : ''}
                </div>
            </div>
            <div class="classroom-layout">
                ${generateDesks(classroom, blockedPlaces)}
            </div>
        `;
        
        container.appendChild(classroomElement);
    }

    attachDeskEventListeners();
    console.log('Рендеринг кабинетов завершен');
}

function generateDesks(classroom, blockedPlaces = []) {
  const rows = classroom.количество_рядов_парт;
  const totalDesks = classroom.количество_парт;
  
  const russianLetters = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К', 'Л', 'М'];
  let desksHTML = '';
  
  const desksPerRow = Math.ceil(totalDesks / rows);
  
  desksHTML += `<div class="desks-grid-with-headers">`;
  
  // Заголовки столбцов (буквы)
  desksHTML += `<div class="column-headers">`;
  for (let row = 1; row <= rows; row++) {
    const rowLetterIndex = (row - 1) * 2;
    const leftLetter = russianLetters[rowLetterIndex];
    const rightLetter = russianLetters[rowLetterIndex + 1];
    
    desksHTML += `
      <div class="column-header">
        <span>${leftLetter}</span>
        <span>${rightLetter}</span>
      </div>
    `;
  }
  desksHTML += `</div>`;
  
  desksHTML += `<div class="grid-content">`;
  desksHTML += `<div class="desks-grid">`;
  
  for (let deskInRow = 1; deskInRow <= desksPerRow; deskInRow++) {
    desksHTML += `<div class="desks-row">`;
    desksHTML += `<div class="row-header">${deskInRow}</div>`;
    
    for (let row = 1; row <= rows; row++) {
      const rowLetterIndex = (row - 1) * 2;
      const leftLetter = russianLetters[rowLetterIndex];
      const rightLetter = russianLetters[rowLetterIndex + 1];
      
      const deskNumber = (row - 1) * desksPerRow + deskInRow;
      
      if (deskNumber <= totalDesks) {
        const placeLeft = `${deskInRow}${leftLetter}`;
        const placeRight = `${deskInRow}${rightLetter}`;
        
        const studentLeft = studentsData.find(s => 
          s.номер_кабинета === classroom.номер_кабинета && s.номер_места === placeLeft
        );
        const studentRight = studentsData.find(s => 
          s.номер_кабинета === classroom.номер_кабинета && s.номер_места === placeRight
        );
        
        const isLeftBlocked = blockedPlaces.includes(placeLeft);
        const isRightBlocked = blockedPlaces.includes(placeRight);
        
        desksHTML += `
          <div class="desk-pair" data-row="${row}" data-desk="${deskInRow}">
            <div class="desk ${studentLeft ? 'occupied' : ''} ${isLeftBlocked ? 'blocked' : ''}" 
                 style="${getDeskStyle(studentLeft, isLeftBlocked)}"
                 data-classroom="${classroom.номер_кабинета}"
                 data-classroom-id="${classroom.id}"
                 data-place="${placeLeft}"
                 data-row="${row}"
                 data-desk="${deskInRow}"
                 data-blocked="${isLeftBlocked}">
              <div class="desk-place">${placeLeft}</div>
              ${isLeftBlocked ? '<div class="blocked-overlay"></div>' : ''}
              ${studentLeft && !isLeftBlocked ? getStudentInitials(studentLeft) : ''}
              ${isLeftBlocked ? '🚫' : ''}
            </div>
            <div class="desk ${studentRight ? 'occupied' : ''} ${isRightBlocked ? 'blocked' : ''}" 
                 style="${getDeskStyle(studentRight, isRightBlocked)}"
                 data-classroom="${classroom.номер_кабинета}"
                 data-classroom-id="${classroom.id}"
                 data-place="${placeRight}"
                 data-row="${row}"
                 data-desk="${deskInRow}"
                 data-blocked="${isRightBlocked}">
              <div class="desk-place">${placeRight}</div>
              ${isRightBlocked ? '<div class="blocked-overlay"></div>' : ''}
              ${studentRight && !isRightBlocked ? getStudentInitials(studentRight) : ''}
              ${isRightBlocked ? '🚫' : ''}
            </div>
          </div>
        `;
      } else {
        desksHTML += `
          <div class="desk-pair" data-row="${row}" data-desk="${deskInRow}">
            <div class="desk empty-desk"></div>
            <div class="desk empty-desk"></div>
          </div>
        `;
      }
    }
    
    desksHTML += `</div>`;
  }
  
  desksHTML += `</div>`;
  desksHTML += `</div>`;
  desksHTML += `</div>`;
  
  return desksHTML;
}

function getDeskStyle(student, isBlocked = false) {
    if (isBlocked) {
        return 'background: #6c757d; cursor: not-allowed;';
    }
    
    if (!student) {
        return 'background: #ccc; cursor: pointer;';
    }
    
    const color = parallelColors[student.паралель] || '#ccc';
    return `background: ${color}; cursor: pointer;`;
}

function getStudentInitials(student) {
    return `${student.фимилия} ${student.имя.charAt(0)}.`;
}

function attachDeskEventListeners() {
    const desks = document.querySelectorAll('.desk:not(.empty-desk)');
    console.log(`Добавление обработчиков событий для ${desks.length} парт`);
    
    desks.forEach(desk => {
        desk.removeEventListener('click', handleDeskClick);
        desk.removeEventListener('dragover', handleDragOver);
        desk.removeEventListener('drop', handleDrop);
        desk.removeEventListener('dragenter', handleDragEnter);
        desk.removeEventListener('dragleave', handleDragLeave);
        
        desk.addEventListener('click', handleDeskClick);
        
        // Для заблокированных парт не добавляем drag & drop события
        if (!desk.dataset.blocked || desk.dataset.blocked === 'false') {
            desk.addEventListener('dragover', handleDragOver);
            desk.addEventListener('drop', handleDrop);
            desk.addEventListener('dragenter', handleDragEnter);
            desk.addEventListener('dragleave', handleDragLeave);
        }
    });
}

// Функция для обработки клика по парте
function handleDeskClick(event) {
    const desk = event.currentTarget;
    const isBlocked = desk.dataset.blocked === 'true';
    const classroom = desk.dataset.classroom;
    const classroomId = desk.dataset.classroomId;
    const place = desk.dataset.place;
    const row = desk.dataset.row;
    const deskNumber = desk.dataset.desk;
    
    console.log(`Клик по парте: кабинет ${classroom}, место ${place}, ряд ${row}, парта ${deskNumber}, заблокировано: ${isBlocked}`);
    
    if (isBlocked) {
        // Показываем опции для заблокированного места
        showBlockedPlaceOptions(classroomId, classroom, place, row, deskNumber);
        return;
    }
    
    const student = studentsData.find(s => 
        s.номер_кабинета === parseInt(classroom) && s.номер_места === place
    );
    
    if (student) {
        // Показываем информацию об ученике и опции перемещения
        showStudentOptions(student, classroomId, classroom, place);
    } else {
        // Предлагаем либо переместить парту, либо посадить ученика
        showEmptyPlaceOptions(classroomId, classroom, place, row, deskNumber);
    }
}

// Функция для показа опций для заблокированного места
function showBlockedPlaceOptions(classroomId, classroomNumber, place, row, deskNumber) {
    selectedPlace = { classroomId, classroomNumber, place, row, deskNumber };
    
    const studentInfo = document.getElementById('studentInfo');
    studentInfo.innerHTML = `
        <h4>🚫 Заблокированное место</h4>
        <div class="place-details">
            <p><strong>Кабинет:</strong> ${classroomNumber}</p>
            <p><strong>Место:</strong> ${place}</p>
            <p><strong>Ряд:</strong> ${row}, Парта: ${deskNumber}</p>
            <p><em>Это место заблокировано и недоступно для автоматической рассадки</em></p>
        </div>
        <div class="action-buttons" style="margin-top: 20px;">
            <button class="btn btn-success" onclick="unblockPlace(${classroomId}, '${place}')">
                🔓 Разблокировать место
            </button>
            <button class="btn btn-secondary" onclick="closeStudentModal()" style="margin-left: 10px;">
                Отмена
            </button>
        </div>
    `;
    
    document.getElementById('studentModal').style.display = 'block';
}

// Функция для показа опций для занятого места
function showStudentOptions(student, classroomId, classroomNumber, place) {
    selectedStudent = student;
    
    const studentInfo = document.getElementById('studentInfo');
    studentInfo.innerHTML = `
        <h4>👤 Информация об ученике</h4>
        <div class="student-details">
            <p><strong>ФИО:</strong> ${student.фимилия} ${student.имя} ${student.отчество || ''}</p>
            <p><strong>Параллель:</strong> ${student.паралель}</p>
            <p><strong>Предмет:</strong> ${student.предмет}</p>
            <p><strong>Текущее место:</strong> ${student.номер_места}</p>
            <p><strong>Кабинет:</strong> ${student.номер_кабинета}</p>
        </div>
        <div class="action-buttons" style="margin-top: 20px;">
            <button class="btn btn-warning" onclick="showMoveStudentModal(${student.id}, ${classroomId}, '${place}')">
                📦 Переместить ученика
            </button>
            <button class="btn btn-danger" onclick="removeStudent(${student.id})" style="margin-left: 10px;">
                ❌ Убрать с места
            </button>
            <button class="btn btn-info" onclick="blockPlace(${classroomId}, '${place}')" style="margin-left: 10px;">
                🚫 Заблокировать место
            </button>
        </div>
    `;
    
    document.getElementById('studentModal').style.display = 'block';
}

// Функция для показа опций для пустого места
function showEmptyPlaceOptions(classroomId, classroomNumber, place, row, deskNumber) {
    selectedPlace = { classroomId, classroomNumber, place, row, deskNumber };
    
    const studentInfo = document.getElementById('studentInfo');
    studentInfo.innerHTML = `
        <h4>🪑 Свободное место</h4>
        <div class="place-details">
            <p><strong>Кабинет:</strong> ${classroomNumber}</p>
            <p><strong>Место:</strong> ${place}</p>
            <p><strong>Ряд:</strong> ${row}, Парта: ${deskNumber}</p>
        </div>
        <div class="action-buttons" style="margin-top: 20px;">
            <button class="btn btn-success" onclick="showPlaceStudentModal(${classroomId}, '${place}')">
                👨‍🎓 Посадить ученика
            </button>
            <button class="btn btn-info" onclick="showMoveDeskModal(${classroomId}, ${row}, ${deskNumber})" style="margin-left: 10px;">
                🔄 Переместить парту
            </button>
            <button class="btn btn-warning" onclick="blockPlace(${classroomId}, '${place}')" style="margin-left: 10px;">
                🚫 Заблокировать место
            </button>
        </div>
    `;
    
    document.getElementById('studentModal').style.display = 'block';
}

// Функция для блокировки места
async function blockPlace(classroomId, placeNumber) {
    try {
        console.log(`Блокировка места: кабинет ${classroomId}, место ${placeNumber}`);
        
        const response = await fetch(`/api/classrooms/${classroomId}/block-place`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                placeNumber: placeNumber,
                blocked: true
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification(`✅ Место ${placeNumber} заблокировано`, 'success');
            closeStudentModal();
            setTimeout(() => location.reload(), 1000);
        } else {
            alert('Ошибка блокировки места: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка блокировки места:', error);
        alert('Ошибка блокировки места: ' + error.message);
    }
}

// Функция для разблокировки места
async function unblockPlace(classroomId, placeNumber) {
    try {
        console.log(`Разблокировка места: кабинет ${classroomId}, место ${placeNumber}`);
        
        const response = await fetch(`/api/classrooms/${classroomId}/block-place`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                placeNumber: placeNumber,
                blocked: false
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification(`✅ Место ${placeNumber} разблокировано`, 'success');
            closeStudentModal();
            setTimeout(() => location.reload(), 1000);
        } else {
            alert('Ошибка разблокировки места: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка разблокировки места:', error);
        alert('Ошибка разблокировки места: ' + error.message);
    }
}

// Функция для показа модального окна перемещения ученика
async function showMoveStudentModal(studentId, currentClassroomId, currentPlace) {
    try {
        const student = studentsData.find(s => s.id === studentId);
        if (!student) return;
        
        const classrooms = classroomsData;
        
        let modalContent = `
            <h4>📦 Перемещение ученика</h4>
            <div class="student-info">
                <p><strong>Ученик:</strong> ${student.фимилия} ${student.имя}</p>
                <p><strong>Параллель:</strong> ${student.паралель}</p>
                <p><strong>Текущее место:</strong> ${currentPlace}</p>
            </div>
            <div class="move-options">
                <h5>Выберите новое место:</h5>
        `;
        
        for (const classroom of classrooms) {
            const response = await fetch(`/api/classrooms/${classroom.id}/free-places`);
            const result = await response.json();
            
            if (result.success && result.freePlaces.length > 0) {
                modalContent += `
                    <div class="classroom-section">
                        <h6>Кабинет №${classroom.номер_кабинета}</h6>
                        <div class="free-places">
                `;
                
                for (const place of result.freePlaces) {
                    modalContent += `
                        <button class="btn btn-outline-primary place-option" 
                                onclick="moveStudentWithCheck(${studentId}, ${classroom.id}, ${classroom.номер_кабинета}, '${place}', '${currentPlace}')">
                            ${place}
                        </button>
                    `;
                }
                
                modalContent += `
                        </div>
                    </div>
                `;
            }
        }
        
        modalContent += `
                <button class="btn btn-secondary" onclick="closeStudentModal()" style="margin-top: 15px; width: 100%;">
                    Отмена
                </button>
            </div>
        `;
        
        document.getElementById('moveDeskModalContent').innerHTML = modalContent;
        document.getElementById('moveDeskModal').style.display = 'block';
        document.getElementById('studentModal').style.display = 'none';
        
    } catch (error) {
        console.error('Ошибка загрузки свободных мест:', error);
        alert('Ошибка загрузки свободных мест: ' + error.message);
    }
}

// Функция для показа модального окна посадки ученика на пустое место
async function showPlaceStudentModal(classroomId, place) {
    try {
        const response = await fetch('/api/students/unplaced');
        const result = await response.json();
        
        if (!result.success) {
            alert('Ошибка загрузки учеников: ' + result.error);
            return;
        }
        
        const unplacedStudents = result.students;
        
        if (unplacedStudents.length === 0) {
            alert('Нет учеников без мест для посадки');
            return;
        }
        
        const classroom = classroomsData.find(c => c.id === classroomId);
        
        let modalContent = `
            <h4>👨‍🎓 Посадка ученика</h4>
            <div class="place-info">
                <p><strong>Кабинет:</strong> №${classroom.номер_кабинета}</p>
                <p><strong>Место:</strong> ${place}</p>
            </div>
            <div class="students-list">
                <h5>Выберите ученика:</h5>
                <div class="students-grid">
        `;
        
        for (const student of unplacedStudents) {
            modalContent += `
                <div class="student-option">
                    <button class="btn btn-outline-success student-btn" 
                            onclick="placeStudentWithCheck(${student.id}, ${classroomId}, ${classroom.номер_кабинета}, '${place}')">
                        <div class="student-name">${student.фимилия} ${student.имя}</div>
                        <div class="student-details">${student.паралель} класс, ${student.предмет}</div>
                    </button>
                </div>
            `;
        }
        
        modalContent += `
                </div>
                <button class="btn btn-secondary" onclick="closeMoveDeskModal()" style="margin-top: 15px; width: 100%;">
                    Отмена
                </button>
            </div>
        `;
        
        document.getElementById('moveDeskModalContent').innerHTML = modalContent;
        document.getElementById('moveDeskModal').style.display = 'block';
        document.getElementById('studentModal').style.display = 'none';
        
    } catch (error) {
        console.error('Ошибка загрузки учеников без мест:', error);
        alert('Ошибка загрузки учеников без мест: ' + error.message);
    }
}

// Функция для перемещения ученика с проверкой
async function moveStudentWithCheck(studentId, classroomId, classroomNumber, newPlace, oldPlace) {
    try {
        console.log(`Проверка перемещения ученика ${studentId} в кабинет ${classroomNumber} на место ${newPlace}`);
        
        const checkResponse = await fetch('/api/check-placement', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                studentId: studentId,
                classroomNumber: classroomNumber,
                placeNumber: newPlace
            })
        });
        
        const checkResult = await checkResponse.json();
        
        if (checkResult.success && checkResult.canPlace) {
            const student = studentsData.find(s => s.id === studentId);
            
            const moveResponse = await fetch('/api/students/place', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    studentId: studentId,
                    classroomNumber: classroomNumber,
                    placeNumber: newPlace,
                    studentData: student ? {
                        school_code: student.school_code,
                        school_name: student.school_name,
                        school_number_oo: student.school_number_oo,
                        school_name_oo: student.school_name_oo,
                        participant_code: student.participant_code
                    } : null
                })
            });
            
            const moveResult = await moveResponse.json();
            
            if (moveResult.success) {
                showNotification(`✅ Ученик ${student.фимилия} ${student.имя} успешно перемещен с места ${oldPlace} на место ${newPlace}`, 'success');
                closeMoveDeskModal();
                closeStudentModal();
                setTimeout(() => location.reload(), 1500);
            } else {
                alert('Ошибка перемещения: ' + moveResult.error);
            }
        } else {
            alert(`❌ Невозможно переместить ученика: ${checkResult.error || 'Нарушены правила соседства'}`);
        }
        
    } catch (error) {
        console.error('Ошибка перемещения ученика:', error);
        alert('Ошибка перемещения ученика: ' + error.message);
    }
}

// Функция для посадки ученика с проверкой
async function placeStudentWithCheck(studentId, classroomId, classroomNumber, place) {
    try {
        console.log(`Проверка посадки ученика ${studentId} в кабинет ${classroomNumber} на место ${place}`);
        
        const checkResponse = await fetch('/api/check-placement', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                studentId: studentId,
                classroomNumber: classroomNumber,
                placeNumber: place
            })
        });
        
        const checkResult = await checkResponse.json();
        
        if (checkResult.success && checkResult.canPlace) {
            const student = studentsData.find(s => s.id === studentId);
            
            const placeResponse = await fetch('/api/students/place', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    studentId: studentId,
                    classroomNumber: classroomNumber,
                    placeNumber: place,
                    studentData: student ? {
                        school_code: student.school_code,
                        school_name: student.school_name,
                        school_number_oo: student.school_number_oo,
                        school_name_oo: student.school_name_oo,
                        participant_code: student.participant_code
                    } : null
                })
            });
            
            const placeResult = await placeResponse.json();
            
            if (placeResult.success) {
                showNotification(`✅ Ученик ${student.фимилия} ${student.имя} успешно посажен на место ${place}`, 'success');
                closeMoveDeskModal();
                closeStudentModal();
                setTimeout(() => location.reload(), 1500);
            } else {
                alert('Ошибка посадки: ' + placeResult.error);
            }
        } else {
            alert(`❌ Невозможно посадить ученика: ${checkResult.error || 'Нарушены правила соседства'}`);
        }
        
    } catch (error) {
        console.error('Ошибка посадки ученика:', error);
        alert('Ошибка посадки ученика: ' + error.message);
    }
}

// Функции для drag & drop учеников
function handleDragOver(event) {
    event.preventDefault();
}

function handleDrop(event) {
    event.preventDefault();
    const desk = event.currentTarget;
    desk.classList.remove('drop-zone');
    
    console.log(`Drop на парту: кабинет ${desk.dataset.classroom}, место ${desk.dataset.place}`);
    
    if (draggedStudent) {
        placeStudent(draggedStudent.id, desk.dataset.classroom, desk.dataset.place);
    }
}

function handleDragEnter(event) {
    event.preventDefault();
    event.currentTarget.classList.add('drop-zone');
}

function handleDragLeave(event) {
    event.currentTarget.classList.remove('drop-zone');
}

// Функции для модальных окон
function showSubjectModal() {
    console.log('Открытие модального окна выбора предмета');
    document.getElementById('subjectModal').style.display = 'block';
}

function closeSubjectModal() {
    console.log('Закрытие модального окна выбора предмета');
    document.getElementById('subjectModal').style.display = 'none';
}

function closeStudentModal() {
    console.log('Закрытие модального окна информации об ученике');
    document.getElementById('studentModal').style.display = 'none';
    draggedStudent = null;
}

function closeMoveDeskModal() {
    document.getElementById('moveDeskModal').style.display = 'none';
    selectedStudent = null;
    selectedPlace = null;
}

// Основные функции управления
async function generateSeating() {
    const subject = document.getElementById('subjectSelect').value;
    
    if (!subject) {
        alert('Пожалуйста, выберите предмет');
        return;
    }
    
    console.log(`Запуск формирования посадки для предмета: ${subject}`);
    
    try {
        const generateBtn = document.querySelector('.btn-success');
        const originalText = generateBtn.textContent;
        generateBtn.textContent = 'Формирование...';
        generateBtn.disabled = true;
        
        const response = await fetch('/api/generate-seating', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ subject })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        generateBtn.textContent = originalText;
        generateBtn.disabled = false;
        
        if (result.success) {
            console.log(`Посадка успешно сформирована: ${result.stats.studentsCount} учеников, ${result.stats.seatingCount} размещений`);
            alert(`Посадка успешно сформирована!\nУчеников: ${result.stats.studentsCount}\nРазмещено: ${result.stats.seatingCount}\nНе размещено: ${result.stats.unplacedCount || 0}`);
            location.reload();
        } else {
            console.error('Ошибка формирования посадки:', result.error);
            alert('Ошибка: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка при формировании посадки:', error);
        
        const generateBtn = document.querySelector('.btn-success');
        generateBtn.textContent = 'Сформировать посадку';
        generateBtn.disabled = false;
        
        alert('Ошибка при формировании посадки: ' + error.message);
    }
    
    closeSubjectModal();
}

async function clearSeating() {
    if (!confirm('Вы уверены, что хотите очистить все места? Ученики останутся в системе, но будут убраны с мест.')) {
        console.log('Очистка посадки отменена пользователем');
        return;
    }
    
    console.log('Запуск очистки посадки');
    
    try {
        const clearBtn = document.querySelector('.btn-warning');
        const originalText = clearBtn.textContent;
        clearBtn.textContent = 'Очистка...';
        clearBtn.disabled = true;
        
        const response = await fetch('/api/clear-seating', {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        clearBtn.textContent = originalText;
        clearBtn.disabled = false;
        
        if (result.success) {
            console.log('Посадка успешно очищена');
            alert('Посадка очищена!');
            location.reload();
        } else {
            console.error('Ошибка очистки посадки:', result.error);
            alert('Ошибка: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка при очистке посадки:', error);
        
        const clearBtn = document.querySelector('.btn-warning');
        clearBtn.textContent = 'Очистить посадку';
        clearBtn.disabled = false;
        
        alert('Ошибка при очистке посадки: ' + error.message);
    }
}

async function clearAllData() {
    if (!confirm('ВНИМАНИЕ: Вы уверены, что хотите удалить ВСЕХ учеников из системы? Это действие нельзя отменить.')) {
        console.log('Очистка всех данных отменена пользователем');
        return;
    }
    
    console.log('Запуск очистки всех данных');
    
    try {
        const response = await fetch('/api/clear-all-data', {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            console.log('Все данные успешно очищены');
            alert('Все данные учеников удалены!');
            location.reload();
        } else {
            console.error('Ошибка очистки всех данных:', result.error);
            alert('Ошибка: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка при очистке всех данных:', error);
        alert('Ошибка при очистке всех данных: ' + error.message);
    }
}

// Функции для работы с учениками
async function placeStudent(studentId, classroomNumber, placeNumber) {
    console.log(`Размещение ученика ID=${studentId} в кабинете ${classroomNumber} на месте ${placeNumber}`);
    
    try {
        const response = await fetch('/api/students/place', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                studentId: parseInt(studentId),
                classroomNumber: parseInt(classroomNumber),
                placeNumber: placeNumber
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            console.log('Ученик успешно размещен');
            location.reload();
        } else {
            console.error('Ошибка размещения ученика:', result.error);
            alert('Ошибка: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка при размещении ученика:', error);
        alert('Ошибка при размещении ученика: ' + error.message);
    }
}

async function removeStudent(studentId) {
    console.log(`Удаление ученика ID=${studentId} с места`);
    
    try {
        const response = await fetch('/api/students/place', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                studentId: parseInt(studentId),
                classroomNumber: null,
                placeNumber: null
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            console.log('Ученик успешно удален с места');
            location.reload();
        } else {
            console.error('Ошибка удаления ученика:', result.error);
            alert('Ошибка: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка при удалении ученика:', error);
        alert('Ошибка при удалении ученика: ' + error.message);
    }
}

function exportToJson() {
    console.log('Экспорт данных в JSON');
    window.open('/api/export-seating', '_blank');
}

async function importFromJson(file) {
    if (!file) {
        console.log('Импорт отменен: файл не выбран');
        return;
    }
    
    console.log(`Импорт данных из файла: ${file.name}`);
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            console.log(`Загружено данных: ${data.students ? data.students.length : 0} учеников`);
            
            if (!data.students || data.students.length === 0) {
                alert('Файл не содержит данных об учениках');
                return;
            }
            
            const importBtn = document.querySelector('.btn-info');
            const originalText = importBtn.textContent;
            importBtn.textContent = 'Импорт...';
            importBtn.disabled = true;
            
            const response = await fetch('/api/import-seating', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ data })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            importBtn.textContent = originalText;
            importBtn.disabled = false;
            
            if (result.success) {
                console.log('Данные успешно импортированы');
                alert(`Данные успешно загружены!\nОбработано: ${result.stats.total} учеников\nУспешно: ${result.stats.success}\nОшибок: ${result.stats.errors}`);
                location.reload();
            } else {
                console.error('Ошибка импорта:', result.error);
                alert('Ошибка: ' + result.error);
            }
        } catch (error) {
            console.error('Ошибка при загрузке файла:', error);
            
            const importBtn = document.querySelector('.btn-info');
            importBtn.textContent = 'Импорт из JSON';
            importBtn.disabled = false;
            
            if (error.message.includes('Unexpected token')) {
                alert('Ошибка: Неверный формат файла. Убедитесь, что файл содержит валидный JSON.');
            } else {
                alert('Ошибка при загрузке файла: ' + error.message);
            }
        }
    };
    
    reader.onerror = function() {
        console.error('Ошибка чтения файла');
        alert('Ошибка чтения файла');
        
        const importBtn = document.querySelector('.btn-info');
        importBtn.textContent = 'Импорт из JSON';
        importBtn.disabled = false;
    };
    
    reader.readAsText(file);
}

// Валидация JSON файла
function validateJsonFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = JSON.parse(e.target.result);
                
                if (!data.students || !Array.isArray(data.students)) {
                    reject(new Error('Файл должен содержать массив students'));
                    return;
                }
                
                if (data.students.length > 0) {
                    const firstStudent = data.students[0];
                    if (!firstStudent.id || !firstStudent.фимилия || !firstStudent.имя) {
                        reject(new Error('Файл должен содержать поля: id, фимилия, имя'));
                        return;
                    }
                }
                
                resolve(data);
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = () => reject(new Error('Ошибка чтения файла'));
        reader.readAsText(file);
    });
}

// Функция для показа модального окна перемещения парты
async function showMoveDeskModal(classroomId, currentRow, currentDesk) {
    try {
        console.log(`Запрос доступных мест для перемещения: кабинет ${classroomId}, ряд ${currentRow}, парта ${currentDesk}`);
        
        const response = await fetch(`/api/classrooms/${classroomId}/available-desks?currentRow=${currentRow}&currentDesk=${currentDesk}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            const modalContent = document.getElementById('moveDeskModalContent');
            modalContent.innerHTML = `
                <h4>Переместить парту</h4>
                <p>Текущее положение: Ряд ${currentRow}, Парта ${currentDesk}</p>
                <p>Выберите новое положение:</p>
                <div class="available-desks">
                    ${result.availableDesks.map(desk => `
                        <button class="btn btn-outline-primary desk-option" 
                                data-row="${desk.row}" 
                                data-desk="${desk.desk}"
                                onclick="moveDesk(${classroomId}, ${currentRow}, ${currentDesk}, ${desk.row}, ${desk.desk})">
                            ${desk.display}
                        </button>
                    `).join('')}
                </div>
                <button class="btn btn-secondary" onclick="closeMoveDeskModal()" style="margin-top: 15px;">Отмена</button>
            `;
            document.getElementById('moveDeskModal').style.display = 'block';
        } else {
            alert('Ошибка: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка получения доступных мест:', error);
        alert('Ошибка получения доступных мест: ' + error.message);
    }
}

// Функция для перемещения парты
async function moveDesk(classroomId, fromRow, fromDesk, toRow, toDesk) {
    try {
        console.log(`Перемещение парты: из ряда ${fromRow} парта ${fromDesk} -> в ряд ${toRow} парта ${toDesk}`);
        
        const response = await fetch(`/api/classrooms/${classroomId}/move-desk`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fromRow: parseInt(fromRow),
                fromDesk: parseInt(fromDesk),
                toRow: parseInt(toRow),
                toDesk: parseInt(toDesk)
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            console.log('Парта успешно перемещена');
            closeMoveDeskModal();
            showNotification('Парта успешно перемещена!', 'success');
            await renderClassrooms();
        } else {
            alert('Ошибка: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка перемещения парты:', error);
        alert('Ошибка перемещения парты: ' + error.message);
    }
}

// Функция для показа уведомлений
function showNotification(message, type = 'info') {
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(notification => notification.remove());
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 10px 20px;
        background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
        color: white;
        border-radius: 5px;
        z-index: 10000;
        animation: slideIn 0.3s ease-out;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    console.log('Документ загружен, инициализация приложения');
    
    loadSubjects();
    renderClassrooms();
    
    const importFileInput = document.getElementById('importFile');
    if (importFileInput) {
        importFileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                validateJsonFile(file)
                    .then(data => {
                        console.log('Файл прошел валидацию');
                        importFromJson(file);
                    })
                    .catch(error => {
                        console.error('Ошибка валидации файла:', error);
                        alert('Ошибка валидации файла: ' + error.message);
                        e.target.value = '';
                    });
            }
        });
    }
    
    window.addEventListener('click', function(event) {
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        });
    });
    
    console.log('Инициализация приложения завершена');
});

// Добавляем CSS для уведомлений и модальных окон
const additionalCSS = `
@keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
}

.student-details, .place-details {
    background: #f8f9fa;
    padding: 15px;
    border-radius: 8px;
    margin: 15px 0;
}

.action-buttons {
    display: flex;
    gap: 10px;
    justify-content: center;
}

.classroom-section {
    margin: 15px 0;
    padding: 15px;
    border: 1px solid #e9ecef;
    border-radius: 8px;
}

.classroom-section h6 {
    margin-bottom: 10px;
    color: #495057;
    font-size: 16px;
}

.free-places {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
    gap: 8px;
}

.place-option {
    padding: 8px 12px;
    font-size: 12px;
}

.students-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
    max-height: 400px;
    overflow-y: auto;
    margin: 15px 0;
}

.student-option {
    margin-bottom: 8px;
}

.student-btn {
    width: 100%;
    text-align: left;
    padding: 12px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
}

.student-name {
    font-weight: bold;
    font-size: 14px;
}

.student-details {
    font-size: 12px;
    color: #666;
    margin-top: 4px;
}

.move-options {
    max-height: 500px;
    overflow-y: auto;
}

.available-desks {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
    margin: 15px 0;
    max-height: 300px;
    overflow-y: auto;
}

.desk-option {
    padding: 8px 12px;
    font-size: 14px;
}

.notification {
    animation: slideIn 0.3s ease-out;
}

/* Стили для заблокированных мест */
.desk.blocked {
    background: #6c757d !important;
    color: white;
    cursor: not-allowed;
    position: relative;
    opacity: 0.7;
}

.desk.blocked::before {
    content: "🚫";
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 16px;
    z-index: 2;
}

.blocked-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    z-index: 1;
}

.desk.blocked .desk-place {
    background: rgba(255, 255, 255, 0.3);
    color: white;
}

/* Стили для счетчика заблокированных мест */
.blocked-count {
    font-size: 14px;
    font-weight: bold;
}

@media (max-width: 768px) {
    .action-buttons {
        flex-direction: column;
    }
    
    .free-places {
        grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
    }
    
    .students-grid {
        grid-template-columns: 1fr;
    }
    
    .available-desks {
        grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    }
    
    .desk.blocked::before {
        font-size: 14px;
    }
}
`;

const style = document.createElement('style');
style.textContent = additionalCSS;
document.head.appendChild(style);