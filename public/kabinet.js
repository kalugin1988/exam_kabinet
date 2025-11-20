// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    console.log('Страница управления кабинетами загружена');
    renderClassroomsTable();
    
    // Обработчик формы добавления кабинета
    document.getElementById('addClassroomForm').addEventListener('submit', handleAddClassroom);
});

function renderClassroomsTable() {
    const table = document.getElementById('classroomsTable');
    
    if (!classroomsData || classroomsData.length === 0) {
        table.innerHTML = '<p class="no-data">Кабинеты не найдены</p>';
        return;
    }
    
    table.innerHTML = classroomsData.map(classroom => `
        <div class="classroom-item" id="classroom-${classroom.id}">
            <div class="classroom-details">
                <strong>Кабинет №${classroom.номер_кабинета}</strong>
                <div class="classroom-info">
                    Парт: ${classroom.количество_парт} | Рядов: ${classroom.количество_рядов_парт} | Этаж: ${classroom.этаж}
                </div>
            </div>
            <div class="classroom-actions">
                <button class="btn btn-warning" onclick="editClassroom(${classroom.id})">Редактировать</button>
                <button class="btn btn-danger" onclick="deleteClassroom(${classroom.id})">Удалить</button>
            </div>
        </div>
    `).join('');
}

async function handleAddClassroom(event) {
    event.preventDefault();
    
    const form = event.target;
    const formData = new FormData(form);
    
    const data = {
        номер_кабинета: parseInt(formData.get('номер_кабинета')),
        количество_парт: parseInt(formData.get('количество_парт')),
        количество_рядов_парт: parseInt(formData.get('количество_рядов_парт')),
        этаж: parseInt(formData.get('этаж'))
    };
    
    // Валидация
    if (data.номер_кабинета < 1 || data.количество_парт < 1 || data.количество_рядов_парт < 1 || data.этаж < 1) {
        alert('Все поля должны содержать положительные числа');
        return;
    }
    
    try {
        const response = await fetch('/api/classrooms', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('Кабинет успешно добавлен!');
            form.reset();
            // Обновляем данные и перерисовываем таблицу
            classroomsData.push(result.classroom);
            renderClassroomsTable();
        } else {
            alert('Ошибка: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка при добавлении кабинета:', error);
        alert('Ошибка при добавлении кабинета: ' + error.message);
    }
}

async function editClassroom(id) {
    const classroom = classroomsData.find(c => c.id === id);
    if (!classroom) return;
    
    const newNumber = prompt('Новый номер кабинета:', classroom.номер_кабинета);
    if (newNumber === null) return;
    
    const newDesks = prompt('Новое количество парт:', classroom.количество_парт);
    if (newDesks === null) return;
    
    const newRows = prompt('Новое количество рядов:', classroom.количество_рядов_парт);
    if (newRows === null) return;
    
    const newFloor = prompt('Новый этаж:', classroom.этаж);
    if (newFloor === null) return;
    
    // Валидация
    if (newNumber < 1 || newDesks < 1 || newRows < 1 || newFloor < 1) {
        alert('Все поля должны содержать положительные числа');
        return;
    }
    
    const data = {
        номер_кабинета: parseInt(newNumber),
        количество_парт: parseInt(newDesks),
        количество_рядов_парт: parseInt(newRows),
        этаж: parseInt(newFloor)
    };
    
    try {
        const response = await fetch(`/api/classrooms/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('Кабинет успешно обновлен!');
            // Обновляем данные и перерисовываем таблицу
            const index = classroomsData.findIndex(c => c.id === id);
            classroomsData[index] = result.classroom;
            renderClassroomsTable();
        } else {
            alert('Ошибка: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка при обновлении кабинета:', error);
        alert('Ошибка при обновлении кабинета: ' + error.message);
    }
}

async function deleteClassroom(id) {
    if (!confirm('Вы уверены, что хотите удалить этот кабинет?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/classrooms/${id}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('Кабинет успешно удален!');
            // Обновляем данные и перерисовываем таблицу
            classroomsData = classroomsData.filter(c => c.id !== id);
            renderClassroomsTable();
        } else {
            alert('Ошибка: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка при удалении кабинета:', error);
        alert('Ошибка при удалении кабинета: ' + error.message);
    }
}