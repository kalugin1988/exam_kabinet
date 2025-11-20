let draggedStudent = null;

// Функция для загрузки предметов из API
async function loadSubjects() {
    try {
        console.log('Загрузка списка предметов...');
        const response = await fetch('/api/subjects');
        const result = await response.json();
        
        if (result.success) {
            const subjectSelect = document.getElementById('subjectSelect');
            subjectSelect.innerHTML = result.subjects.map(subject => 
                `<option value="${subject.subject}">${subject.subject}</option>`
            ).join('');
            console.log(`Загружено предметов: ${result.subjects.length}`);
        } else {
            console.error('Ошибка загрузки предметов:', result.error);
        }
    } catch (error) {
        console.error('Ошибка загрузки предметов:', error);
    }
}

function renderClassrooms() {
    const container = document.getElementById('classroomsContainer');
    container.innerHTML = '';

    console.log(`Рендеринг ${classroomsData.length} кабинетов`);

    classroomsData.forEach(classroom => {
        const classroomElement = document.createElement('div');
        classroomElement.className = 'classroom';
        
        const rows = classroom.количество_рядов_парт;
        const totalDesks = classroom.количество_парт;
        
        classroomElement.innerHTML = `
            <div class="classroom-header">
                <div class="classroom-title">Кабинет №${classroom.номер_кабинета}</div>
                <div class="classroom-info">
                    Парт: ${totalDesks} | Рядов: ${rows} | Этаж: ${classroom.этаж}
                </div>
            </div>
            <div class="classroom-layout">
                ${generateDesks(classroom)}
            </div>
        `;
        
        container.appendChild(classroomElement);
    });

    attachDeskEventListeners();
    console.log('Рендеринг кабинетов завершен');
}

function generateDesks(classroom) {
  const rows = classroom.количество_рядов_парт;
  const totalDesks = classroom.количество_парт;
  
  const russianLetters = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К', 'Л', 'М'];
  let desksHTML = '';
  
  console.log(`Визуализация кабинета ${classroom.номер_кабинета}: ${rows} рядов, ${totalDesks} парт`);
  
  // Рассчитываем количество парт в одном ряду
  const desksPerRow = Math.ceil(totalDesks / rows);
  console.log(`  Парт в одном ряду: ${desksPerRow}`);
  
  // Создаем контейнер для сетки парт с заголовками
  desksHTML += `<div class="desks-grid-with-headers">`;
  
  // Заголовки столбцов (буквы) - теперь для пар
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
  
  // Содержимое сетки
  desksHTML += `<div class="grid-content">`;
  desksHTML += `<div class="desks-grid">`;
  
  // Создаем строки по количеству парт в ряду (desksPerRow)
  for (let deskInRow = 1; deskInRow <= desksPerRow; deskInRow++) {
    desksHTML += `<div class="desks-row">`;
    
    // Заголовок строки (номер парты в ряду)
    desksHTML += `<div class="row-header">${deskInRow}</div>`;
    
    // Создаем столбцы по количеству рядов (буквы)
    for (let row = 1; row <= rows; row++) {
      const rowLetterIndex = (row - 1) * 2;
      const leftLetter = russianLetters[rowLetterIndex];
      const rightLetter = russianLetters[rowLetterIndex + 1];
      
      // Рассчитываем глобальный номер парты
      const deskNumber = (row - 1) * desksPerRow + deskInRow;
      
      // Если парта существует (не превышает общее количество парт)
      if (deskNumber <= totalDesks) {
        const placeLeft = `${deskInRow}${leftLetter}`;  // Используем deskInRow вместо deskNumber
        const placeRight = `${deskInRow}${rightLetter}`; // Используем deskInRow вместо deskNumber
        
        const studentLeft = studentsData.find(s => 
          s.номер_кабинета === classroom.номер_кабинета && s.номер_места === placeLeft
        );
        const studentRight = studentsData.find(s => 
          s.номер_кабинета === classroom.номер_кабинета && s.номер_места === placeRight
        );
        
        desksHTML += `
          <div class="desk-pair">
            <div class="desk ${studentLeft ? 'occupied' : ''}" 
                 style="${getDeskStyle(studentLeft)}"
                 data-classroom="${classroom.номер_кабинета}"
                 data-place="${placeLeft}">
              <div class="desk-place">${placeLeft}</div>
              ${studentLeft ? getStudentInitials(studentLeft) : ''}
            </div>
            <div class="desk ${studentRight ? 'occupied' : ''}" 
                 style="${getDeskStyle(studentRight)}"
                 data-classroom="${classroom.номер_кабинета}"
                 data-place="${placeRight}">
              <div class="desk-place">${placeRight}</div>
              ${studentRight ? getStudentInitials(studentRight) : ''}
            </div>
          </div>
        `;
      } else {
        // Если парты не существует, добавляем пустой блок для выравнивания
        desksHTML += `
          <div class="desk-pair">
            <div class="desk empty-desk"></div>
            <div class="desk empty-desk"></div>
          </div>
        `;
      }
    }
    
    desksHTML += `</div>`; // Закрываем desks-row
  }
  
  desksHTML += `</div>`; // Закрываем desks-grid
  desksHTML += `</div>`; // Закрываем grid-content
  desksHTML += `</div>`; // Закрываем desks-grid-with-headers
  
  return desksHTML;
}

function getDeskStyle(student) {
    if (!student) {
        return 'background: #ccc;';
    }
    
    const color = parallelColors[student.паралель] || '#ccc';
    return `background: ${color};`;
}

function getStudentInitials(student) {
    return `${student.фимилия} ${student.имя.charAt(0)}.`;
}

function attachDeskEventListeners() {
    const desks = document.querySelectorAll('.desk');
    console.log(`Добавление обработчиков событий для ${desks.length} парт`);
    
    desks.forEach(desk => {
        desk.addEventListener('click', handleDeskClick);
        desk.addEventListener('dragover', handleDragOver);
        desk.addEventListener('drop', handleDrop);
        desk.addEventListener('dragenter', handleDragEnter);
        desk.addEventListener('dragleave', handleDragLeave);
    });
}

function handleDeskClick(event) {
    const desk = event.currentTarget;
    const classroom = desk.dataset.classroom;
    const place = desk.dataset.place;
    
    console.log(`Клик по парте: кабинет ${classroom}, место ${place}`);
    
    const student = studentsData.find(s => 
        s.номер_кабинета === parseInt(classroom) && s.номер_места === place
    );
    
    const studentInfo = document.getElementById('studentInfo');
    
    if (student) {
        studentInfo.innerHTML = `
            <h4>Информация об ученике</h4>
            <p><strong>ФИО:</strong> ${student.фимилия} ${student.имя} ${student.отчество || ''}</p>
            <p><strong>Параллель:</strong> ${student.паралель}</p>
            <p><strong>Предмет:</strong> ${student.предмет}</p>
            <p><strong>Место:</strong> ${student.номер_места}</p>
            <p><strong>Кабинет:</strong> ${student.номер_кабинета}</p>
            <button class="btn btn-danger" onclick="removeStudent(${student.id})">Убрать с места</button>
        `;
    } else {
        studentInfo.innerHTML = `
            <h4>Место свободно</h4>
            <p><strong>Кабинет:</strong> ${classroom}</p>
            <p><strong>Место:</strong> ${place}</p>
            ${draggedStudent ? `<button class="btn btn-success" onclick="placeStudent(${draggedStudent.id}, ${classroom}, '${place}')">Посадить сюда</button>` : ''}
        `;
    }
    
    document.getElementById('studentModal').style.display = 'block';
}

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

function showSubjectModal() {
    console.log('Открытие модального окна выбора предмета');
    
    const subjectSelect = document.getElementById('subjectSelect');
    if (subjectSelect.options.length === 0) {
        loadSubjects().then(() => {
            document.getElementById('subjectModal').style.display = 'block';
        });
    } else {
        document.getElementById('subjectModal').style.display = 'block';
    }
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

async function generateSeating() {
    const subject = document.getElementById('subjectSelect').value;
    
    if (!subject) {
        alert('Пожалуйста, выберите предмет');
        return;
    }
    
    console.log(`Запуск формирования посадки для предмета: ${subject}`);
    
    try {
        const response = await fetch('/api/generate-seating', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ subject })
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log(`Посадка успешно сформирована: ${result.stats.studentsCount} учеников, ${result.stats.seatingCount} размещений, источник: ${result.stats.source}`);
            alert(`Посадка успешно сформирована!\nУчеников: ${result.stats.studentsCount}\nРазмещено: ${result.stats.seatingCount}\nНе размещено: ${result.stats.unplacedCount || 0}\nИсточник: ${result.stats.source}`);
            location.reload();
        } else {
            console.error('Ошибка формирования посадки:', result.error);
            alert('Ошибка: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка при формировании посадки:', error);
        alert('Ошибка при формировании посадки: ' + error.message);
    }
    
    closeSubjectModal();
}

async function clearSeating() {
    if (!confirm('Вы уверены, что хотите очистить все места?')) {
        console.log('Очистка посадки отменена пользователем');
        return;
    }
    
    console.log('Запуск очистки посадки');
    
    try {
        const response = await fetch('/api/clear-seating', {
            method: 'POST'
        });
        
        const result = await response.json();
        
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
        alert('Ошибка при очистке посадки: ' + error.message);
    }
}

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
            
            const response = await fetch('/api/import-seating', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });
            
            const result = await response.json();
            
            if (result.success) {
                console.log('Данные успешно импортированы');
                alert('Данные успешно загружены!');
                location.reload();
            } else {
                console.error('Ошибка импорта:', result.error);
                alert('Ошибка: ' + result.error);
            }
        } catch (error) {
            console.error('Ошибка при загрузке файла:', error);
            alert('Ошибка при загрузке файла: ' + error.message);
        }
    };
    reader.readAsText(file);
}

document.addEventListener('DOMContentLoaded', function() {
    console.log('Документ загружен, инициализация приложения');
    
    renderClassrooms();
    
    const subjectSelect = document.getElementById('subjectSelect');
    if (subjectSelect && subjectSelect.options.length === 0) {
        loadSubjects();
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